DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'categoria_compra_tipo'
  ) THEN
    CREATE TYPE public.categoria_compra_tipo AS ENUM ('ingrediente', 'embalagem');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'compra_status_pagamento'
  ) THEN
    CREATE TYPE public.compra_status_pagamento AS ENUM ('pago', 'pendente', 'vencido');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'compra_forma_pagamento'
  ) THEN
    CREATE TYPE public.compra_forma_pagamento AS ENUM ('pix', 'boleto', 'cartao', 'dinheiro');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'compra_unidade'
  ) THEN
    CREATE TYPE public.compra_unidade AS ENUM ('kg', 'g', 'un', 'cx', 'pct', 'l');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'conta_pagar_status'
  ) THEN
    CREATE TYPE public.conta_pagar_status AS ENUM ('pendente', 'pago', 'vencido');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj text,
  telefone text,
  email text,
  contato_responsavel text,
  observacoes text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedores_cnpj_formato_check CHECK (
    cnpj IS NULL OR cnpj ~ '^\\d{2}\\.\\d{3}\\.\\d{3}/\\d{4}-\\d{2}$'
  )
);

CREATE TABLE IF NOT EXISTS public.categorias_compra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  tipo public.categoria_compra_tipo NOT NULL,
  cor text NOT NULL DEFAULT '#16a34a',
  icone text,
  CONSTRAINT categorias_compra_cor_check CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT categorias_compra_nome_unico UNIQUE (nome)
);

CREATE TABLE IF NOT EXISTS public.compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  categoria_compra_id uuid REFERENCES public.categorias_compra(id) ON DELETE SET NULL,
  descricao text NOT NULL,
  valor_total numeric(12,2) NOT NULL DEFAULT 0,
  data_compra date NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento date,
  status_pagamento public.compra_status_pagamento NOT NULL DEFAULT 'pago',
  forma_pagamento public.compra_forma_pagamento NOT NULL DEFAULT 'dinheiro',
  nota_fiscal text,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compras_valor_total_check CHECK (valor_total >= 0)
);

CREATE TABLE IF NOT EXISTS public.compra_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id uuid NOT NULL REFERENCES public.compras(id) ON DELETE CASCADE,
  nome text NOT NULL,
  quantidade numeric(12,3) NOT NULL DEFAULT 1,
  unidade public.compra_unidade NOT NULL,
  preco_unitario numeric(12,2) NOT NULL DEFAULT 0,
  preco_total numeric(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT compra_itens_quantidade_check CHECK (quantidade > 0),
  CONSTRAINT compra_itens_preco_unitario_check CHECK (preco_unitario >= 0),
  CONSTRAINT compra_itens_preco_total_check CHECK (preco_total >= 0)
);

CREATE TABLE IF NOT EXISTS public.contas_pagar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id uuid REFERENCES public.compras(id) ON DELETE SET NULL,
  fornecedor_id uuid REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  descricao text NOT NULL,
  valor numeric(12,2) NOT NULL,
  data_vencimento date NOT NULL,
  data_pagamento date,
  status public.conta_pagar_status NOT NULL DEFAULT 'pendente',
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contas_pagar_valor_check CHECK (valor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_pagar_compra_unica
  ON public.contas_pagar(compra_id)
  WHERE compra_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fornecedores_nome_ativo
  ON public.fornecedores(ativo, nome);

CREATE INDEX IF NOT EXISTS idx_compras_data_status
  ON public.compras(data_compra DESC, status_pagamento);

CREATE INDEX IF NOT EXISTS idx_compras_fornecedor
  ON public.compras(fornecedor_id);

CREATE INDEX IF NOT EXISTS idx_compras_categoria
  ON public.compras(categoria_compra_id);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_status_vencimento
  ON public.contas_pagar(status, data_vencimento);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_fornecedor
  ON public.contas_pagar(fornecedor_id);

CREATE OR REPLACE FUNCTION public.normalize_financeiro_status_compra()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status_pagamento = 'pago' THEN
    NEW.data_vencimento := NULL;
  ELSIF NEW.data_vencimento IS NULL THEN
    NEW.data_vencimento := NEW.data_compra;
  END IF;

  IF NEW.status_pagamento = 'pendente'
     AND NEW.data_vencimento IS NOT NULL
     AND NEW.data_vencimento < CURRENT_DATE THEN
    NEW.status_pagamento := 'vencido';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compras_normalize_status ON public.compras;
CREATE TRIGGER compras_normalize_status
BEFORE INSERT OR UPDATE OF status_pagamento, data_vencimento, data_compra
ON public.compras
FOR EACH ROW EXECUTE FUNCTION public.normalize_financeiro_status_compra();

CREATE OR REPLACE FUNCTION public.normalize_financeiro_status_conta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pago' AND NEW.data_pagamento IS NULL THEN
    NEW.data_pagamento := CURRENT_DATE;
  END IF;

  IF NEW.status <> 'pago' THEN
    NEW.data_pagamento := NULL;
    IF NEW.data_vencimento < CURRENT_DATE THEN
      NEW.status := 'vencido';
    ELSIF NEW.status = 'vencido' THEN
      NEW.status := 'pendente';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contas_pagar_normalize_status ON public.contas_pagar;
CREATE TRIGGER contas_pagar_normalize_status
BEFORE INSERT OR UPDATE OF status, data_pagamento, data_vencimento
ON public.contas_pagar
FOR EACH ROW EXECUTE FUNCTION public.normalize_financeiro_status_conta();

CREATE OR REPLACE FUNCTION public.set_compra_item_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.preco_total := ROUND((COALESCE(NEW.quantidade, 0) * COALESCE(NEW.preco_unitario, 0))::numeric, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compra_itens_set_total ON public.compra_itens;
CREATE TRIGGER compra_itens_set_total
BEFORE INSERT OR UPDATE OF quantidade, preco_unitario
ON public.compra_itens
FOR EACH ROW EXECUTE FUNCTION public.set_compra_item_total();

CREATE OR REPLACE FUNCTION public.refresh_compra_total(p_compra_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_compra_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.compras c
  SET valor_total = COALESCE((
    SELECT SUM(ci.preco_total)::numeric(12,2)
    FROM public.compra_itens ci
    WHERE ci.compra_id = c.id
  ), 0)
  WHERE c.id = p_compra_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_compra_total_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_compra_total(COALESCE(NEW.compra_id, OLD.compra_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS compra_itens_refresh_total ON public.compra_itens;
CREATE TRIGGER compra_itens_refresh_total
AFTER INSERT OR UPDATE OR DELETE ON public.compra_itens
FOR EACH ROW EXECUTE FUNCTION public.refresh_compra_total_from_item();

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
    SET fornecedor_id = NEW.fornecedor_id,
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
    compra_id,
    fornecedor_id,
    descricao,
    valor,
    data_vencimento,
    status,
    observacoes
  ) VALUES (
    NEW.id,
    NEW.fornecedor_id,
    NEW.descricao,
    NEW.valor_total,
    COALESCE(NEW.data_vencimento, NEW.data_compra),
    v_status,
    NEW.observacoes
  )
  ON CONFLICT (compra_id) DO UPDATE
  SET fornecedor_id = EXCLUDED.fornecedor_id,
      descricao = EXCLUDED.descricao,
      valor = EXCLUDED.valor,
      data_vencimento = EXCLUDED.data_vencimento,
      status = EXCLUDED.status,
      data_pagamento = CASE WHEN EXCLUDED.status = 'pago' THEN COALESCE(public.contas_pagar.data_pagamento, CURRENT_DATE) ELSE NULL END,
      observacoes = EXCLUDED.observacoes;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compras_sync_conta_pagar ON public.compras;
CREATE TRIGGER compras_sync_conta_pagar
AFTER INSERT OR UPDATE OF fornecedor_id, descricao, valor_total, data_vencimento, status_pagamento, observacoes
ON public.compras
FOR EACH ROW EXECUTE FUNCTION public.sync_conta_pagar_from_compra();

CREATE OR REPLACE FUNCTION public.sync_compra_from_conta_pagar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.compra_status_pagamento;
BEGIN
  IF NEW.compra_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_status := CASE
    WHEN NEW.status = 'pago' THEN 'pago'
    WHEN NEW.status = 'vencido' THEN 'vencido'
    ELSE 'pendente'
  END;

  UPDATE public.compras
  SET status_pagamento = v_status,
      data_vencimento = CASE WHEN v_status = 'pago' THEN NULL ELSE NEW.data_vencimento END
  WHERE id = NEW.compra_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contas_pagar_sync_compra ON public.contas_pagar;
CREATE TRIGGER contas_pagar_sync_compra
AFTER INSERT OR UPDATE OF status, data_pagamento, data_vencimento
ON public.contas_pagar
FOR EACH ROW EXECUTE FUNCTION public.sync_compra_from_conta_pagar();

CREATE OR REPLACE FUNCTION public.atualizar_contas_pagar_vencidas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
BEGIN
  UPDATE public.contas_pagar
  SET status = 'vencido'
  WHERE status = 'pendente'
    AND data_vencimento < CURRENT_DATE;

  GET DIAGNOSTICS v_total = ROW_COUNT;

  UPDATE public.compras c
  SET status_pagamento = 'vencido'
  FROM public.contas_pagar cp
  WHERE cp.compra_id = c.id
    AND cp.status = 'vencido'
    AND c.status_pagamento <> 'pago';

  RETURN v_total;
END;
$$;

INSERT INTO public.categorias_compra (nome, tipo, cor, icone)
SELECT *
FROM (
  VALUES
    ('Ingredientes', 'ingrediente'::public.categoria_compra_tipo, '#16a34a', 'leaf'),
    ('Embalagens', 'embalagem'::public.categoria_compra_tipo, '#2563eb', 'package')
) AS seed(nome, tipo, cor, icone)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categorias_compra c WHERE lower(c.nome) = lower(seed.nome)
);

ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compra_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas_pagar ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['fornecedores','categorias_compra','compras','compra_itens','contas_pagar']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'Autenticados gerenciam ' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Autenticados gerenciam %1$s" ON public.%1$I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.fornecedores;
ALTER PUBLICATION supabase_realtime ADD TABLE public.categorias_compra;
ALTER PUBLICATION supabase_realtime ADD TABLE public.compras;
ALTER PUBLICATION supabase_realtime ADD TABLE public.compra_itens;
ALTER PUBLICATION supabase_realtime ADD TABLE public.contas_pagar;
