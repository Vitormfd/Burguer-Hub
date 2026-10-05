-- Ficha técnica (insumos por produto/adicional), estoque com baixa automática nas vendas
-- e relatório de lucro real (CMV) por produto.
--
-- Segurança operacional: os gatilhos de baixa de estoque NUNCA bloqueiam um pedido.
-- Qualquer erro dentro deles vira WARNING e o pedido segue normalmente.

-- 1) Insumos ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.insumos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL,
  unidade text NOT NULL DEFAULT 'un',
  custo_unitario numeric(12,4) NOT NULL DEFAULT 0,
  estoque_atual numeric(14,4) NOT NULL DEFAULT 0,
  estoque_minimo numeric(14,4) NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insumos_unidade_check CHECK (unidade IN ('un', 'g', 'kg', 'ml', 'l', 'fatia', 'pct')),
  CONSTRAINT insumos_custo_check CHECK (custo_unitario >= 0),
  CONSTRAINT insumos_minimo_check CHECK (estoque_minimo >= 0)
);

CREATE INDEX IF NOT EXISTS idx_insumos_owner_nome ON public.insumos (owner_id, nome);

-- 2) Ficha técnica do produto ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.produto_insumos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  insumo_id uuid NOT NULL REFERENCES public.insumos(id) ON DELETE CASCADE,
  quantidade numeric(12,4) NOT NULL,
  CONSTRAINT produto_insumos_qtd_check CHECK (quantidade > 0),
  CONSTRAINT produto_insumos_unico UNIQUE (produto_id, insumo_id)
);

CREATE INDEX IF NOT EXISTS idx_produto_insumos_produto ON public.produto_insumos (produto_id);

-- 3) Ficha técnica do adicional (ex.: "Bacon extra" consome 30 g de bacon) -------
CREATE TABLE IF NOT EXISTS public.adicional_insumos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  adicional_id uuid NOT NULL REFERENCES public.adicionais(id) ON DELETE CASCADE,
  insumo_id uuid NOT NULL REFERENCES public.insumos(id) ON DELETE CASCADE,
  quantidade numeric(12,4) NOT NULL,
  CONSTRAINT adicional_insumos_qtd_check CHECK (quantidade > 0),
  CONSTRAINT adicional_insumos_unico UNIQUE (adicional_id, insumo_id)
);

CREATE INDEX IF NOT EXISTS idx_adicional_insumos_adicional ON public.adicional_insumos (adicional_id);

-- 4) Movimentações de estoque ----------------------------------------------------
-- quantidade é assinada: entrada (+), venda/perda (-), ajuste (+/-).
CREATE TABLE IF NOT EXISTS public.estoque_movimentacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  insumo_id uuid NOT NULL REFERENCES public.insumos(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  quantidade numeric(14,4) NOT NULL,
  custo_unitario numeric(12,4) NOT NULL DEFAULT 0,
  pedido_item_id uuid REFERENCES public.pedido_itens(id) ON DELETE CASCADE,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estoque_mov_tipo_check CHECK (tipo IN ('entrada', 'venda', 'ajuste', 'perda'))
);

CREATE INDEX IF NOT EXISTS idx_estoque_mov_owner_data ON public.estoque_movimentacoes (owner_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_estoque_mov_insumo ON public.estoque_movimentacoes (insumo_id);
CREATE INDEX IF NOT EXISTS idx_estoque_mov_pedido_item ON public.estoque_movimentacoes (pedido_item_id)
  WHERE pedido_item_id IS NOT NULL;

-- 5) RLS: cada loja só vê o que é seu -----------------------------------------------
ALTER TABLE public.insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produto_insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adicional_insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_movimentacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insumos_owner_all" ON public.insumos;
CREATE POLICY "insumos_owner_all" ON public.insumos FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "produto_insumos_owner_all" ON public.produto_insumos;
CREATE POLICY "produto_insumos_owner_all" ON public.produto_insumos FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "adicional_insumos_owner_all" ON public.adicional_insumos;
CREATE POLICY "adicional_insumos_owner_all" ON public.adicional_insumos FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Movimentações: o dono lê e lança entradas/ajustes/perdas. Vendas só pelo gatilho.
DROP POLICY IF EXISTS "estoque_mov_owner_select" ON public.estoque_movimentacoes;
CREATE POLICY "estoque_mov_owner_select" ON public.estoque_movimentacoes FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "estoque_mov_owner_insert" ON public.estoque_movimentacoes;
CREATE POLICY "estoque_mov_owner_insert" ON public.estoque_movimentacoes FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND tipo <> 'venda' AND pedido_item_id IS NULL);

DROP POLICY IF EXISTS "estoque_mov_owner_delete" ON public.estoque_movimentacoes;
CREATE POLICY "estoque_mov_owner_delete" ON public.estoque_movimentacoes FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND tipo <> 'venda');

-- 6) Saldo do insumo acompanha as movimentações ----------------------------------------
CREATE OR REPLACE FUNCTION public.estoque_mov_aplicar_saldo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.insumos SET estoque_atual = estoque_atual - OLD.quantidade WHERE id = OLD.insumo_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.insumos SET estoque_atual = estoque_atual + NEW.quantidade WHERE id = NEW.insumo_id;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS estoque_mov_saldo ON public.estoque_movimentacoes;
CREATE TRIGGER estoque_mov_saldo
AFTER INSERT OR UPDATE OR DELETE ON public.estoque_movimentacoes
FOR EACH ROW EXECUTE FUNCTION public.estoque_mov_aplicar_saldo();

-- Entrada de mercadoria: soma ao estoque e atualiza o custo por média ponderada.
CREATE OR REPLACE FUNCTION public.estoque_registrar_entrada(
  p_insumo_id uuid,
  p_quantidade numeric,
  p_custo_total numeric,
  p_observacao text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_insumo public.insumos%ROWTYPE;
  v_custo_unit numeric;
  v_saldo_valido numeric;
BEGIN
  SELECT * INTO v_insumo FROM public.insumos WHERE id = p_insumo_id AND owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insumo não encontrado';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero';
  END IF;

  v_custo_unit := CASE WHEN COALESCE(p_custo_total, 0) > 0 THEN p_custo_total / p_quantidade ELSE v_insumo.custo_unitario END;
  v_saldo_valido := GREATEST(v_insumo.estoque_atual, 0);

  UPDATE public.insumos
  SET custo_unitario = CASE
    WHEN v_saldo_valido + p_quantidade > 0
      THEN ROUND(((v_saldo_valido * custo_unitario) + (p_quantidade * v_custo_unit)) / (v_saldo_valido + p_quantidade), 4)
    ELSE v_custo_unit
  END
  WHERE id = p_insumo_id;

  INSERT INTO public.estoque_movimentacoes (owner_id, insumo_id, tipo, quantidade, custo_unitario, observacao)
  VALUES (v_insumo.owner_id, p_insumo_id, 'entrada', p_quantidade, v_custo_unit, NULLIF(BTRIM(COALESCE(p_observacao, '')), ''));
END;
$fn$;

REVOKE ALL ON FUNCTION public.estoque_registrar_entrada(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estoque_registrar_entrada(uuid, numeric, numeric, text) TO authenticated;

-- 7) Baixa automática nas vendas ------------------------------------------------------
-- Recalcula (apaga e refaz) as saídas de um item de pedido. Idempotente: pode ser
-- chamado quantas vezes for preciso (inclusão, edição, cancelamento).
CREATE OR REPLACE FUNCTION public.estoque_recalcular_item(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_owner uuid;
  v_produto uuid;
  v_qtd numeric;
  v_cancelado boolean;
  v_status text;
BEGIN
  DELETE FROM public.estoque_movimentacoes WHERE pedido_item_id = p_item_id AND tipo = 'venda';

  SELECT COALESCE(pi.owner_id, p.owner_id), pi.produto_id, pi.quantidade, COALESCE(pi.cancelado, false), p.status::text
    INTO v_owner, v_produto, v_qtd, v_cancelado, v_status
  FROM public.pedido_itens pi
  JOIN public.pedidos p ON p.id = pi.pedido_id
  WHERE pi.id = p_item_id;

  IF NOT FOUND OR v_owner IS NULL OR v_cancelado OR v_status = 'cancelado' OR COALESCE(v_qtd, 0) <= 0 THEN
    RETURN;
  END IF;

  -- Insumos do produto
  IF v_produto IS NOT NULL THEN
    INSERT INTO public.estoque_movimentacoes (owner_id, insumo_id, tipo, quantidade, custo_unitario, pedido_item_id)
    SELECT v_owner, f.insumo_id, 'venda', -(f.quantidade * v_qtd), i.custo_unitario, p_item_id
    FROM public.produto_insumos f
    JOIN public.insumos i ON i.id = f.insumo_id
    WHERE f.produto_id = v_produto
      AND i.owner_id = v_owner;
  END IF;

  -- Insumos dos adicionais (quantidade do adicional é por unidade do item)
  INSERT INTO public.estoque_movimentacoes (owner_id, insumo_id, tipo, quantidade, custo_unitario, pedido_item_id)
  SELECT v_owner, f.insumo_id, 'venda', -(f.quantidade * pia.quantidade * v_qtd), i.custo_unitario, p_item_id
  FROM public.pedido_item_adicionais pia
  JOIN public.adicional_insumos f ON f.adicional_id = pia.adicional_id
  JOIN public.insumos i ON i.id = f.insumo_id
  WHERE pia.pedido_item_id = p_item_id
    AND i.owner_id = v_owner;
END;
$fn$;

REVOKE ALL ON FUNCTION public.estoque_recalcular_item(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.estoque_trg_pedido_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade
       AND NEW.produto_id IS NOT DISTINCT FROM OLD.produto_id
       AND NEW.cancelado IS NOT DISTINCT FROM OLD.cancelado THEN
      RETURN NEW;
    END IF;
    PERFORM public.estoque_recalcular_item(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'estoque: falha ao baixar item %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS estoque_pedido_item ON public.pedido_itens;
CREATE TRIGGER estoque_pedido_item
AFTER INSERT OR UPDATE ON public.pedido_itens
FOR EACH ROW EXECUTE FUNCTION public.estoque_trg_pedido_item();

CREATE OR REPLACE FUNCTION public.estoque_trg_item_adicional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_item uuid;
BEGIN
  v_item := CASE WHEN TG_OP = 'DELETE' THEN OLD.pedido_item_id ELSE NEW.pedido_item_id END;
  BEGIN
    PERFORM public.estoque_recalcular_item(v_item);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'estoque: falha ao baixar adicionais do item %: %', v_item, SQLERRM;
  END;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS estoque_item_adicional ON public.pedido_item_adicionais;
CREATE TRIGGER estoque_item_adicional
AFTER INSERT OR UPDATE OR DELETE ON public.pedido_item_adicionais
FOR EACH ROW EXECUTE FUNCTION public.estoque_trg_item_adicional();

-- Pedido cancelado (ou reaberto) devolve/retira o estoque de todos os itens.
CREATE OR REPLACE FUNCTION public.estoque_trg_pedido_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_item uuid;
BEGIN
  IF (OLD.status::text = 'cancelado') IS NOT DISTINCT FROM (NEW.status::text = 'cancelado') THEN
    RETURN NEW;
  END IF;
  BEGIN
    FOR v_item IN SELECT id FROM public.pedido_itens WHERE pedido_id = NEW.id LOOP
      PERFORM public.estoque_recalcular_item(v_item);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'estoque: falha ao recalcular pedido %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS estoque_pedido_status ON public.pedidos;
CREATE TRIGGER estoque_pedido_status
AFTER UPDATE OF status ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.estoque_trg_pedido_status();

-- 8) Relatório de lucro real por produto -----------------------------------------------
-- Receita = quantidade x preço praticado (preco_unitario já inclui adicionais).
-- Custo   = ficha técnica atual do produto + ficha dos adicionais escolhidos.
CREATE OR REPLACE FUNCTION public.relatorio_lucro_produtos(p_ini timestamptz, p_fim timestamptz)
RETURNS TABLE (
  produto_id uuid,
  produto_nome text,
  quantidade numeric,
  receita numeric,
  custo numeric,
  tem_ficha boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH itens AS (
    SELECT pi.id, pi.produto_id, pi.quantidade::numeric AS qtd, pi.preco_unitario
    FROM public.pedido_itens pi
    JOIN public.pedidos p ON p.id = pi.pedido_id
    WHERE p.owner_id = auth.uid()
      AND p.criado_em >= p_ini
      AND p.criado_em <= p_fim
      AND p.status::text <> 'cancelado'
      AND COALESCE(pi.cancelado, false) = false
  ),
  custo_produto AS (
    SELECT f.produto_id, SUM(f.quantidade * i.custo_unitario) AS custo
    FROM public.produto_insumos f
    JOIN public.insumos i ON i.id = f.insumo_id
    WHERE f.owner_id = auth.uid()
    GROUP BY f.produto_id
  ),
  custo_adicionais AS (
    SELECT pia.pedido_item_id, SUM(f.quantidade * i.custo_unitario * pia.quantidade) AS custo
    FROM public.pedido_item_adicionais pia
    JOIN public.adicional_insumos f ON f.adicional_id = pia.adicional_id
    JOIN public.insumos i ON i.id = f.insumo_id
    WHERE pia.pedido_item_id IN (SELECT id FROM itens)
    GROUP BY pia.pedido_item_id
  )
  SELECT
    it.produto_id,
    COALESCE(pr.nome, 'Produto removido') AS produto_nome,
    SUM(it.qtd) AS quantidade,
    ROUND(SUM(it.qtd * it.preco_unitario), 2) AS receita,
    ROUND(SUM(it.qtd * (COALESCE(cp.custo, 0) + COALESCE(ca.custo, 0))), 2) AS custo,
    BOOL_OR(cp.produto_id IS NOT NULL) AS tem_ficha
  FROM itens it
  LEFT JOIN public.produtos pr ON pr.id = it.produto_id
  LEFT JOIN custo_produto cp ON cp.produto_id = it.produto_id
  LEFT JOIN custo_adicionais ca ON ca.pedido_item_id = it.id
  GROUP BY it.produto_id, pr.nome
  ORDER BY receita DESC;
$fn$;

REVOKE ALL ON FUNCTION public.relatorio_lucro_produtos(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_lucro_produtos(timestamptz, timestamptz) TO authenticated;
