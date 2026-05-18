-- Isolamento do modulo financeiro por owner_id

-- 1) owner_id nas tabelas do financeiro
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.categorias_compra ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.compras ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.compra_itens ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.contas_pagar ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 2) backfill para dados legados
DO $$
DECLARE
  v_default_owner uuid;
BEGIN
  SELECT p.id INTO v_default_owner
  FROM public.profiles p
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF v_default_owner IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.fornecedores
  SET owner_id = COALESCE(owner_id, v_default_owner);

  UPDATE public.categorias_compra
  SET owner_id = COALESCE(owner_id, v_default_owner);

  UPDATE public.compras c
  SET owner_id = COALESCE(c.owner_id, f.owner_id, v_default_owner)
  FROM public.fornecedores f
  WHERE f.id = c.fornecedor_id;

  UPDATE public.compras c
  SET owner_id = COALESCE(c.owner_id, cc.owner_id, v_default_owner)
  FROM public.categorias_compra cc
  WHERE cc.id = c.categoria_compra_id;

  UPDATE public.compras
  SET owner_id = COALESCE(owner_id, v_default_owner)
  WHERE owner_id IS NULL;

  UPDATE public.compra_itens ci
  SET owner_id = COALESCE(ci.owner_id, c.owner_id, v_default_owner)
  FROM public.compras c
  WHERE c.id = ci.compra_id;

  UPDATE public.compra_itens
  SET owner_id = COALESCE(owner_id, v_default_owner)
  WHERE owner_id IS NULL;

  UPDATE public.contas_pagar cp
  SET owner_id = COALESCE(cp.owner_id, c.owner_id, v_default_owner)
  FROM public.compras c
  WHERE c.id = cp.compra_id;

  UPDATE public.contas_pagar cp
  SET owner_id = COALESCE(cp.owner_id, f.owner_id, v_default_owner)
  FROM public.fornecedores f
  WHERE f.id = cp.fornecedor_id;

  UPDATE public.contas_pagar
  SET owner_id = COALESCE(owner_id, v_default_owner)
  WHERE owner_id IS NULL;
END;
$$;

-- 3) default owner para operacoes autenticadas
ALTER TABLE public.fornecedores ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.categorias_compra ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.compras ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.compra_itens ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.contas_pagar ALTER COLUMN owner_id SET DEFAULT auth.uid();

-- 4) constraints/indices por tenant
ALTER TABLE public.categorias_compra DROP CONSTRAINT IF EXISTS categorias_compra_nome_unico;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_compra_owner_nome_unique
  ON public.categorias_compra (owner_id, lower(nome))
  WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fornecedores_owner_nome
  ON public.fornecedores (owner_id, nome);

CREATE INDEX IF NOT EXISTS idx_compras_owner_data_status
  ON public.compras (owner_id, data_compra DESC, status_pagamento);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_owner_status_vencimento
  ON public.contas_pagar (owner_id, status, data_vencimento);

-- 5) trigger para propagar owner nas tabelas filhas
CREATE OR REPLACE FUNCTION public.set_owner_financeiro_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'compras' THEN
    IF NEW.owner_id IS NULL AND NEW.fornecedor_id IS NOT NULL THEN
      SELECT f.owner_id INTO NEW.owner_id FROM public.fornecedores f WHERE f.id = NEW.fornecedor_id;
    END IF;

    IF NEW.owner_id IS NULL AND NEW.categoria_compra_id IS NOT NULL THEN
      SELECT cc.owner_id INTO NEW.owner_id FROM public.categorias_compra cc WHERE cc.id = NEW.categoria_compra_id;
    END IF;

  ELSIF TG_TABLE_NAME = 'compra_itens' THEN
    IF NEW.owner_id IS NULL THEN
      SELECT c.owner_id INTO NEW.owner_id FROM public.compras c WHERE c.id = NEW.compra_id;
    END IF;

  ELSIF TG_TABLE_NAME = 'contas_pagar' THEN
    IF NEW.owner_id IS NULL AND NEW.compra_id IS NOT NULL THEN
      SELECT c.owner_id INTO NEW.owner_id FROM public.compras c WHERE c.id = NEW.compra_id;
    END IF;

    IF NEW.owner_id IS NULL AND NEW.fornecedor_id IS NOT NULL THEN
      SELECT f.owner_id INTO NEW.owner_id FROM public.fornecedores f WHERE f.id = NEW.fornecedor_id;
    END IF;
  END IF;

  IF NEW.owner_id IS NULL AND auth.role() = 'authenticated' THEN
    NEW.owner_id := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compras_set_owner_from_parent ON public.compras;
CREATE TRIGGER compras_set_owner_from_parent
BEFORE INSERT ON public.compras
FOR EACH ROW EXECUTE FUNCTION public.set_owner_financeiro_from_parent();

DROP TRIGGER IF EXISTS compra_itens_set_owner_from_parent ON public.compra_itens;
CREATE TRIGGER compra_itens_set_owner_from_parent
BEFORE INSERT ON public.compra_itens
FOR EACH ROW EXECUTE FUNCTION public.set_owner_financeiro_from_parent();

DROP TRIGGER IF EXISTS contas_pagar_set_owner_from_parent ON public.contas_pagar;
CREATE TRIGGER contas_pagar_set_owner_from_parent
BEFORE INSERT ON public.contas_pagar
FOR EACH ROW EXECUTE FUNCTION public.set_owner_financeiro_from_parent();

-- 6) sincronismo de contas a pagar preservando owner
CREATE OR REPLACE FUNCTION public.sync_conta_pagar_from_compra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.conta_pagar_status;
BEGIN
  IF NEW.status_pagamento = 'pago' THEN
    UPDATE public.contas_pagar
    SET owner_id = COALESCE(public.contas_pagar.owner_id, NEW.owner_id),
        fornecedor_id = NEW.fornecedor_id,
        descricao = NEW.descricao,
        valor = NEW.valor_total,
        data_vencimento = COALESCE(NEW.data_vencimento, NEW.data_compra),
        data_pagamento = COALESCE(data_pagamento, CURRENT_DATE),
        status = 'pago',
        observacoes = NEW.observacoes
    WHERE compra_id = NEW.id;

    RETURN NEW;
  END IF;

  v_status := CASE
    WHEN NEW.status_pagamento = 'vencido' THEN 'vencido'
    ELSE 'pendente'
  END;

  INSERT INTO public.contas_pagar (
    owner_id,
    compra_id,
    fornecedor_id,
    descricao,
    valor,
    data_vencimento,
    status,
    observacoes
  ) VALUES (
    NEW.owner_id,
    NEW.id,
    NEW.fornecedor_id,
    NEW.descricao,
    NEW.valor_total,
    COALESCE(NEW.data_vencimento, NEW.data_compra),
    v_status,
    NEW.observacoes
  )
  ON CONFLICT (compra_id) WHERE compra_id IS NOT NULL DO UPDATE
  SET owner_id = COALESCE(public.contas_pagar.owner_id, EXCLUDED.owner_id),
      fornecedor_id = EXCLUDED.fornecedor_id,
      descricao = EXCLUDED.descricao,
      valor = EXCLUDED.valor,
      data_vencimento = EXCLUDED.data_vencimento,
      status = EXCLUDED.status,
      data_pagamento = CASE WHEN EXCLUDED.status = 'pago' THEN COALESCE(public.contas_pagar.data_pagamento, CURRENT_DATE) ELSE NULL END,
      observacoes = EXCLUDED.observacoes;

  RETURN NEW;
END;
$$;

-- 7) RLS owner-only no financeiro autenticado
DROP POLICY IF EXISTS "Autenticados gerenciam fornecedores" ON public.fornecedores;
DROP POLICY IF EXISTS "Autenticados gerenciam categorias_compra" ON public.categorias_compra;
DROP POLICY IF EXISTS "Autenticados gerenciam compras" ON public.compras;
DROP POLICY IF EXISTS "Autenticados gerenciam compra_itens" ON public.compra_itens;
DROP POLICY IF EXISTS "Autenticados gerenciam contas_pagar" ON public.contas_pagar;
DROP POLICY IF EXISTS "fornecedores_owner_all" ON public.fornecedores;
DROP POLICY IF EXISTS "categorias_compra_owner_all" ON public.categorias_compra;
DROP POLICY IF EXISTS "compras_owner_all" ON public.compras;
DROP POLICY IF EXISTS "compra_itens_owner_all" ON public.compra_itens;
DROP POLICY IF EXISTS "contas_pagar_owner_all" ON public.contas_pagar;

CREATE POLICY "fornecedores_owner_all"
  ON public.fornecedores FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "categorias_compra_owner_all"
  ON public.categorias_compra FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "compras_owner_all"
  ON public.compras FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "compra_itens_owner_all"
  ON public.compra_itens FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "contas_pagar_owner_all"
  ON public.contas_pagar FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- 8) Seed de categorias de compra por owner existente (evita vazio na conta antiga)
INSERT INTO public.categorias_compra (owner_id, nome, tipo, cor, icone)
SELECT p.id, seed.nome, seed.tipo, seed.cor, seed.icone
FROM public.profiles p
CROSS JOIN (
  VALUES
    ('Ingredientes', 'ingrediente'::public.categoria_compra_tipo, '#16a34a', 'leaf'),
    ('Embalagens', 'embalagem'::public.categoria_compra_tipo, '#2563eb', 'package')
) AS seed(nome, tipo, cor, icone)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.categorias_compra c
  WHERE c.owner_id = p.id
    AND lower(c.nome) = lower(seed.nome)
);
