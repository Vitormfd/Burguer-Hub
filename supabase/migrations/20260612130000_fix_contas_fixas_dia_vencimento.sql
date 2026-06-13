-- Garante colunas de contas fixas recorrentes (caso 20260521113000 não tenha sido aplicada)
ALTER TABLE public.contas_pagar
  ADD COLUMN IF NOT EXISTS recorrente_mensal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dia_vencimento smallint,
  ADD COLUMN IF NOT EXISTS recorrencia_origem_id uuid;

ALTER TABLE public.contas_pagar
  DROP CONSTRAINT IF EXISTS contas_pagar_dia_vencimento_check;

ALTER TABLE public.contas_pagar
  ADD CONSTRAINT contas_pagar_dia_vencimento_check
  CHECK (dia_vencimento IS NULL OR (dia_vencimento BETWEEN 1 AND 31));

CREATE INDEX IF NOT EXISTS idx_contas_pagar_recorrencia_origem_data
  ON public.contas_pagar (recorrencia_origem_id, data_vencimento)
  WHERE compra_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_conta_fixa_recorrencia_origem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.compra_id IS NULL
     AND NEW.recorrente_mensal = true
     AND NEW.recorrencia_origem_id IS NULL THEN
    UPDATE public.contas_pagar
    SET recorrencia_origem_id = NEW.id
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contas_pagar_set_recorrencia_origem ON public.contas_pagar;
CREATE TRIGGER contas_pagar_set_recorrencia_origem
AFTER INSERT ON public.contas_pagar
FOR EACH ROW EXECUTE FUNCTION public.set_conta_fixa_recorrencia_origem();
