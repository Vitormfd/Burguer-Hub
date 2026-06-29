-- Corrige dupla contagem de adicionais: preco_unitario em pedido_itens já inclui os adicionais.

CREATE OR REPLACE FUNCTION public.register_cliente_mesa_pedido(
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

  SELECT COALESCE(p.owner_id, auth.uid()),
    COALESCE(
      NULLIF(p.subtotal, 0),
      NULLIF(p.total, 0),
      (
        SELECT COALESCE(SUM(pi.quantidade * pi.preco_unitario), 0)
        FROM public.pedido_itens pi
        WHERE pi.pedido_id = p.id
          AND pi.cancelado = false
      ),
      0
    )
    INTO v_owner_id, v_pedido_subtotal
  FROM public.pedidos p
  WHERE p.id = p_pedido_id;

  IF v_owner_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.pedidos
  SET owner_id = v_owner_id
  WHERE id = p_pedido_id
    AND owner_id IS NULL;

  INSERT INTO public.clientes (owner_id, nome, telefone)
  VALUES (v_owner_id, COALESCE(v_nome, 'Cliente'), v_phone)
  ON CONFLICT (owner_id, telefone) WHERE owner_id IS NOT NULL
  DO UPDATE SET nome = COALESCE(EXCLUDED.nome, public.clientes.nome)
  RETURNING id INTO v_cliente_id;

  SELECT COALESCE(c.fidelidade_pedido_minimo, 0)
    INTO v_fidelidade_pedido_minimo
  FROM public.configuracoes c
  WHERE c.owner_id = v_owner_id
  ORDER BY c.updated_at DESC
  LIMIT 1;

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

CREATE OR REPLACE FUNCTION public.sync_pedido_subtotal_from_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_subtotal numeric(10,2);
BEGIN
  SELECT COALESCE(SUM(pi.quantidade * pi.preco_unitario), 0)
    INTO v_pedido_subtotal
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = COALESCE(NEW.pedido_id, OLD.pedido_id)
    AND pi.cancelado = false;

  UPDATE public.pedidos
  SET subtotal = v_pedido_subtotal
  WHERE id = COALESCE(NEW.pedido_id, OLD.pedido_id)
    AND tipo = 'mesa';

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_pedido_subtotal_from_adicionais()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id uuid;
  v_pedido_subtotal numeric(10,2);
BEGIN
  SELECT pi.pedido_id INTO v_pedido_id
  FROM public.pedido_itens pi
  WHERE pi.id = COALESCE(NEW.pedido_item_id, OLD.pedido_item_id);

  IF v_pedido_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(pi.quantidade * pi.preco_unitario), 0)
    INTO v_pedido_subtotal
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = v_pedido_id
    AND pi.cancelado = false;

  UPDATE public.pedidos
  SET subtotal = v_pedido_subtotal
  WHERE id = v_pedido_id
    AND tipo = 'mesa';

  RETURN COALESCE(NEW, OLD);
END;
$$;

UPDATE public.pedidos p
SET subtotal = COALESCE(calc.total, 0)
FROM (
  SELECT pi.pedido_id, SUM(pi.quantidade * pi.preco_unitario) AS total
  FROM public.pedido_itens pi
  WHERE pi.cancelado = false
  GROUP BY pi.pedido_id
) calc
WHERE p.id = calc.pedido_id
  AND p.tipo = 'mesa'
  AND p.status <> 'cancelado';

UPDATE contas c
SET total = COALESCE(calc.total, 0)
FROM (
  SELECT
    p.conta_id,
    COALESCE(SUM(
      CASE
        WHEN pi.cancelado THEN 0
        ELSE pi.preco_unitario * pi.quantidade
      END
    ), 0) AS total
  FROM pedidos p
  JOIN pedido_itens pi ON pi.pedido_id = p.id
  WHERE p.conta_id IS NOT NULL
    AND p.status <> 'cancelado'
    AND p.cancelado_em IS NULL
  GROUP BY p.conta_id
) calc
WHERE c.id = calc.conta_id;

UPDATE contas c
SET total = 0
WHERE NOT EXISTS (
  SELECT 1
  FROM pedidos p
  WHERE p.conta_id = c.id
    AND p.status <> 'cancelado'
    AND p.cancelado_em IS NULL
);
