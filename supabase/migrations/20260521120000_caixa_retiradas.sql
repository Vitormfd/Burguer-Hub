DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'caixa_movimentacao_tipo'
  ) THEN
    CREATE TYPE public.caixa_movimentacao_tipo AS ENUM ('retirada', 'suprimento');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.caixa_movimentacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caixa_id uuid NOT NULL REFERENCES public.caixas(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo public.caixa_movimentacao_tipo NOT NULL DEFAULT 'retirada',
  valor numeric(12,2) NOT NULL,
  descricao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixa_movimentacoes_valor_check CHECK (valor > 0)
);

CREATE INDEX IF NOT EXISTS idx_caixa_movimentacoes_owner_criado
  ON public.caixa_movimentacoes(owner_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_caixa_movimentacoes_caixa
  ON public.caixa_movimentacoes(caixa_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.set_owner_caixa_movimentacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT c.owner_id
  INTO v_owner_id
  FROM public.caixas c
  WHERE c.id = NEW.caixa_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Caixa não encontrado';
  END IF;

  NEW.owner_id := v_owner_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS caixa_movimentacoes_set_owner ON public.caixa_movimentacoes;
CREATE TRIGGER caixa_movimentacoes_set_owner
BEFORE INSERT ON public.caixa_movimentacoes
FOR EACH ROW EXECUTE FUNCTION public.set_owner_caixa_movimentacao();

CREATE OR REPLACE FUNCTION public.registrar_retirada_caixa(
  p_caixa_id uuid,
  p_valor numeric,
  p_descricao text DEFAULT NULL
)
RETURNS public.caixa_movimentacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.caixa_movimentacoes;
BEGIN
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor da retirada deve ser maior que zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.caixas c
    WHERE c.id = p_caixa_id
      AND c.owner_id = auth.uid()
      AND c.status = 'aberto'
  ) THEN
    RAISE EXCEPTION 'Caixa não encontrado ou não está aberto';
  END IF;

  INSERT INTO public.caixa_movimentacoes (caixa_id, tipo, valor, descricao)
  VALUES (p_caixa_id, 'retirada', p_valor, NULLIF(trim(COALESCE(p_descricao, '')), ''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER TABLE public.caixa_movimentacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "caixa_movimentacoes_owner_all" ON public.caixa_movimentacoes;
CREATE POLICY "caixa_movimentacoes_owner_all"
  ON public.caixa_movimentacoes FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE schemaname = 'public'
      AND tablename = 'caixa_movimentacoes'
      AND pubname = 'supabase_realtime'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.caixa_movimentacoes';
  END IF;
END
$$;
