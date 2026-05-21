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

CREATE OR REPLACE FUNCTION public.gerar_contas_fixas_recorrentes(p_data_referencia date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mes_base date;
  v_ultimo_dia smallint;
  v_data_vencimento date;
  v_total integer := 0;
  v_origem record;
BEGIN
  v_mes_base := date_trunc('month', COALESCE(p_data_referencia, CURRENT_DATE))::date;
  v_ultimo_dia := EXTRACT(day FROM (v_mes_base + INTERVAL '1 month - 1 day'))::smallint;

  FOR v_origem IN
    SELECT cp.*
    FROM public.contas_pagar cp
    WHERE cp.compra_id IS NULL
      AND cp.recorrente_mensal = true
      AND cp.dia_vencimento IS NOT NULL
      AND (
        cp.recorrencia_origem_id = cp.id
        OR cp.recorrencia_origem_id IS NULL
      )
  LOOP
    v_data_vencimento := make_date(
      EXTRACT(year FROM v_mes_base)::int,
      EXTRACT(month FROM v_mes_base)::int,
      LEAST(v_origem.dia_vencimento, v_ultimo_dia)
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.contas_pagar cpx
      WHERE cpx.compra_id IS NULL
        AND cpx.recorrencia_origem_id = COALESCE(v_origem.recorrencia_origem_id, v_origem.id)
        AND cpx.data_vencimento = v_data_vencimento
    ) THEN
      INSERT INTO public.contas_pagar (
        owner_id,
        compra_id,
        fornecedor_id,
        descricao,
        valor,
        data_vencimento,
        status,
        observacoes,
        recorrente_mensal,
        dia_vencimento,
        recorrencia_origem_id
      ) VALUES (
        v_origem.owner_id,
        NULL,
        v_origem.fornecedor_id,
        v_origem.descricao,
        v_origem.valor,
        v_data_vencimento,
        'pendente',
        v_origem.observacoes,
        true,
        v_origem.dia_vencimento,
        COALESCE(v_origem.recorrencia_origem_id, v_origem.id)
      );

      v_total := v_total + 1;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.atualizar_contas_pagar_vencidas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_geradas integer;
BEGIN
  v_geradas := public.gerar_contas_fixas_recorrentes(CURRENT_DATE);

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

  RETURN COALESCE(v_total, 0) + COALESCE(v_geradas, 0);
END;
$$;
