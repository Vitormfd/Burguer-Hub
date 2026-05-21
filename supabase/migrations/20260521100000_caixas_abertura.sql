DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'caixa_status'
  ) THEN
    CREATE TYPE public.caixa_status AS ENUM ('aberto', 'fechado');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.caixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  status public.caixa_status NOT NULL DEFAULT 'aberto',
  valor_inicial numeric(12,2) NOT NULL DEFAULT 0,
  valor_final numeric(12,2),
  observacoes text,
  aberto_em timestamptz NOT NULL DEFAULT now(),
  fechado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixas_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT caixas_valor_inicial_check CHECK (valor_inicial >= 0),
  CONSTRAINT caixas_valor_final_check CHECK (valor_final IS NULL OR valor_final >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_caixas_owner_aberto_unique
  ON public.caixas (owner_id)
  WHERE status = 'aberto';

CREATE INDEX IF NOT EXISTS idx_caixas_owner_aberto_em
  ON public.caixas (owner_id, aberto_em DESC);

CREATE OR REPLACE FUNCTION public.normalize_caixa_fechamento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'fechado' AND NEW.fechado_em IS NULL THEN
    NEW.fechado_em := CURRENT_TIMESTAMP;
  END IF;

  IF NEW.status = 'aberto' THEN
    NEW.fechado_em := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS caixas_normalize_fechamento ON public.caixas;
CREATE TRIGGER caixas_normalize_fechamento
BEFORE INSERT OR UPDATE OF status, fechado_em
ON public.caixas
FOR EACH ROW EXECUTE FUNCTION public.normalize_caixa_fechamento();

CREATE OR REPLACE FUNCTION public.abrir_caixa(p_valor_inicial numeric DEFAULT 0, p_observacoes text DEFAULT NULL)
RETURNS public.caixas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caixa public.caixas;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.caixas c
    WHERE c.owner_id = auth.uid()
      AND c.status = 'aberto'
  ) THEN
    RAISE EXCEPTION 'Já existe um caixa aberto';
  END IF;

  INSERT INTO public.caixas (owner_id, valor_inicial, observacoes)
  VALUES (auth.uid(), COALESCE(p_valor_inicial, 0), p_observacoes)
  RETURNING * INTO v_caixa;

  RETURN v_caixa;
END;
$$;

CREATE OR REPLACE FUNCTION public.fechar_caixa(p_caixa_id uuid, p_valor_final numeric, p_observacoes text DEFAULT NULL)
RETURNS public.caixas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caixa public.caixas;
BEGIN
  UPDATE public.caixas
  SET status = 'fechado',
      valor_final = COALESCE(p_valor_final, valor_final),
      observacoes = COALESCE(NULLIF(p_observacoes, ''), observacoes),
      fechado_em = COALESCE(fechado_em, CURRENT_TIMESTAMP)
  WHERE id = p_caixa_id
    AND owner_id = auth.uid()
    AND status = 'aberto'
  RETURNING * INTO v_caixa;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado ou já está fechado';
  END IF;

  RETURN v_caixa;
END;
$$;

ALTER TABLE public.caixas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "caixas_owner_all" ON public.caixas;
CREATE POLICY "caixas_owner_all"
  ON public.caixas FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());