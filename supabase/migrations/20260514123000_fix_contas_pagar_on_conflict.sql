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
  ON CONFLICT (compra_id) WHERE compra_id IS NOT NULL DO UPDATE
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
