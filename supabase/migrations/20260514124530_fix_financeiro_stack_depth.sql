CREATE OR REPLACE FUNCTION public.sync_conta_pagar_from_compra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.conta_pagar_status;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.status_pagamento = 'pago' THEN
    UPDATE public.contas_pagar
    SET fornecedor_id = NEW.fornecedor_id,
        descricao = NEW.descricao,
        valor = NEW.valor_total,
        data_vencimento = COALESCE(NEW.data_vencimento, NEW.data_compra),
        data_pagamento = COALESCE(data_pagamento, CURRENT_DATE),
        status = 'pago',
        observacoes = NEW.observacoes
    WHERE compra_id = NEW.id
      AND (
        fornecedor_id IS DISTINCT FROM NEW.fornecedor_id
        OR descricao IS DISTINCT FROM NEW.descricao
        OR valor IS DISTINCT FROM NEW.valor_total
        OR data_vencimento IS DISTINCT FROM COALESCE(NEW.data_vencimento, NEW.data_compra)
        OR status IS DISTINCT FROM 'pago'::public.conta_pagar_status
        OR observacoes IS DISTINCT FROM NEW.observacoes
      );

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
  ON CONFLICT (compra_id) WHERE compra_id IS NOT NULL DO UPDATE
  SET fornecedor_id = EXCLUDED.fornecedor_id,
      descricao = EXCLUDED.descricao,
      valor = EXCLUDED.valor,
      data_vencimento = EXCLUDED.data_vencimento,
      status = EXCLUDED.status,
      data_pagamento = CASE
        WHEN EXCLUDED.status = 'pago' THEN COALESCE(public.contas_pagar.data_pagamento, CURRENT_DATE)
        ELSE NULL
      END,
      observacoes = EXCLUDED.observacoes
  WHERE public.contas_pagar.fornecedor_id IS DISTINCT FROM EXCLUDED.fornecedor_id
     OR public.contas_pagar.descricao IS DISTINCT FROM EXCLUDED.descricao
     OR public.contas_pagar.valor IS DISTINCT FROM EXCLUDED.valor
     OR public.contas_pagar.data_vencimento IS DISTINCT FROM EXCLUDED.data_vencimento
     OR public.contas_pagar.status IS DISTINCT FROM EXCLUDED.status
     OR public.contas_pagar.observacoes IS DISTINCT FROM EXCLUDED.observacoes
     OR public.contas_pagar.data_pagamento IS DISTINCT FROM CASE
       WHEN EXCLUDED.status = 'pago' THEN COALESCE(public.contas_pagar.data_pagamento, CURRENT_DATE)
       ELSE NULL
     END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_compra_from_conta_pagar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.compra_status_pagamento;
  v_data_vencimento date;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.compra_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_status := CASE
    WHEN NEW.status = 'pago' THEN 'pago'::public.compra_status_pagamento
    WHEN NEW.status = 'vencido' THEN 'vencido'::public.compra_status_pagamento
    ELSE 'pendente'::public.compra_status_pagamento
  END;

  v_data_vencimento := CASE
    WHEN v_status = 'pago' THEN NULL
    ELSE NEW.data_vencimento
  END;

  UPDATE public.compras
  SET status_pagamento = v_status,
      data_vencimento = v_data_vencimento
  WHERE id = NEW.compra_id
    AND (
      status_pagamento IS DISTINCT FROM v_status
      OR data_vencimento IS DISTINCT FROM v_data_vencimento
    );

  RETURN NEW;
END;
$$;
