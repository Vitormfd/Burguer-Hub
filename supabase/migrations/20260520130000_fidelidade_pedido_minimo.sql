ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS fidelidade_pedido_minimo numeric(10,2) NOT NULL DEFAULT 0;

UPDATE public.configuracoes
SET fidelidade_pedido_minimo = 0
WHERE fidelidade_pedido_minimo IS NULL OR fidelidade_pedido_minimo < 0;

CREATE OR REPLACE FUNCTION public.register_cliente_pedido(
  p_pedido_id uuid,
  p_nome text,
  p_telefone text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid;
  v_phone text;
  v_nome text;
  v_owner_id uuid;
  v_pedido_subtotal numeric(10,2) := 0;
  v_fidelidade_pedido_minimo numeric(10,2) := 0;
BEGIN
  v_phone := public.normalize_phone(p_telefone);
  v_nome := NULLIF(BTRIM(COALESCE(p_nome, '')), '');

  IF v_phone = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.clientes (nome, telefone)
  VALUES (COALESCE(v_nome, 'Cliente'), v_phone)
  ON CONFLICT (telefone)
  DO UPDATE SET nome = COALESCE(EXCLUDED.nome, public.clientes.nome)
  RETURNING id INTO v_cliente_id;

  SELECT p.owner_id, COALESCE(p.subtotal, p.total, 0)
    INTO v_owner_id, v_pedido_subtotal
  FROM public.pedidos p
  WHERE p.id = p_pedido_id;

  IF v_owner_id IS NOT NULL THEN
    SELECT COALESCE(c.fidelidade_pedido_minimo, 0)
      INTO v_fidelidade_pedido_minimo
    FROM public.configuracoes c
    WHERE c.owner_id = v_owner_id
    ORDER BY c.updated_at DESC
    LIMIT 1;
  END IF;

  UPDATE public.pedidos
  SET cliente_id = v_cliente_id
  WHERE id = p_pedido_id;

  IF COALESCE(v_pedido_subtotal, 0) >= GREATEST(COALESCE(v_fidelidade_pedido_minimo, 0), 0) THEN
    INSERT INTO public.cliente_pedidos (cliente_id, pedido_id)
    VALUES (v_cliente_id, p_pedido_id)
    ON CONFLICT (pedido_id) DO UPDATE SET cliente_id = EXCLUDED.cliente_id;
  END IF;

  PERFORM public.refresh_cliente_totals(v_cliente_id);

  RETURN v_cliente_id;
END;
$$;
