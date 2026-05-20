CREATE OR REPLACE FUNCTION public.refresh_cliente_totals(p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pedidos_validos integer;
  resgates_aplicados integer;
  v_owner_id uuid;
  v_meta_ciclo integer;
  v_saldo_pedidos integer := 0;
BEGIN
  IF p_cliente_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.owner_id
    INTO v_owner_id
  FROM public.clientes c
  WHERE c.id = p_cliente_id;

  IF v_owner_id IS NOT NULL THEN
    SELECT MIN(r.pedidos_necessarios)
      INTO v_meta_ciclo
    FROM public.recompensas r
    WHERE r.ativo = true
      AND (r.owner_id = v_owner_id OR r.owner_id IS NULL);
  END IF;

  IF v_meta_ciclo IS NULL THEN
    SELECT MIN(r.pedidos_necessarios)
      INTO v_meta_ciclo
    FROM public.recompensas r
    WHERE r.ativo = true;
  END IF;

  v_meta_ciclo := GREATEST(COALESCE(v_meta_ciclo, 1), 1);

  SELECT COUNT(*)::integer
    INTO pedidos_validos
  FROM public.cliente_pedidos cp
  JOIN public.pedidos p ON p.id = cp.pedido_id
  WHERE cp.cliente_id = p_cliente_id
    AND p.status::text <> 'cancelado';

  SELECT COUNT(*)::integer
    INTO resgates_aplicados
  FROM public.resgates r
  WHERE r.cliente_id = p_cliente_id
    AND r.status = 'aplicado';

  v_saldo_pedidos := GREATEST(
    COALESCE(pedidos_validos, 0) - (COALESCE(resgates_aplicados, 0) * v_meta_ciclo),
    0
  );

  UPDATE public.clientes
  SET total_pedidos = COALESCE(pedidos_validos, 0),
      pontos = MOD(v_saldo_pedidos, v_meta_ciclo)
  WHERE id = p_cliente_id;
END;
$$;

DO $$
DECLARE
  v_cliente_id uuid;
BEGIN
  FOR v_cliente_id IN
    SELECT id FROM public.clientes
  LOOP
    PERFORM public.refresh_cliente_totals(v_cliente_id);
  END LOOP;
END;
$$;
