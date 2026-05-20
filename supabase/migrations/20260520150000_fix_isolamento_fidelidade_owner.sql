-- Corrige isolamento de fidelidade por owner para evitar vazamento entre lojas.

ALTER TABLE public.clientes
  DROP CONSTRAINT IF EXISTS clientes_telefone_key;

DROP INDEX IF EXISTS public.idx_clientes_telefone;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_owner_telefone_unique
  ON public.clientes (owner_id, telefone)
  WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_owner_telefone_lookup
  ON public.clientes (owner_id, telefone);

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

  SELECT p.owner_id, COALESCE(p.subtotal, p.total, 0)
    INTO v_owner_id, v_pedido_subtotal
  FROM public.pedidos p
  WHERE p.id = p_pedido_id;

  IF v_owner_id IS NULL THEN
    RETURN NULL;
  END IF;

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

CREATE OR REPLACE FUNCTION public.get_cliente_fidelidade(
  p_owner_id uuid,
  p_telefone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_cliente public.clientes%ROWTYPE;
BEGIN
  v_phone := public.normalize_phone(p_telefone);

  IF p_owner_id IS NULL OR v_phone = '' THEN
    RETURN jsonb_build_object('cliente', NULL, 'recompensas', '[]'::jsonb, 'resgates_pendentes', '[]'::jsonb);
  END IF;

  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE owner_id = p_owner_id
    AND telefone = v_phone;

  RETURN jsonb_build_object(
    'cliente', CASE WHEN v_cliente.id IS NULL THEN NULL ELSE to_jsonb(v_cliente) END,
    'recompensas', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.ordem, r.pedidos_necessarios, r.nome), '[]'::jsonb)
      FROM public.recompensas r
      WHERE r.ativo = true
        AND (r.owner_id = p_owner_id OR r.owner_id IS NULL)
    ),
    'resgates_pendentes', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', rg.id,
          'recompensa_id', rg.recompensa_id,
          'pedido_id', rg.pedido_id,
          'status', rg.status,
          'nome', rc.nome,
          'descricao', rc.descricao,
          'tipo', rc.tipo,
          'valor', rc.valor,
          'produto_id', rc.produto_id
        )
        ORDER BY rg.resgatado_em DESC
      ), '[]'::jsonb)
      FROM public.resgates rg
      JOIN public.recompensas rc ON rc.id = rg.recompensa_id
      WHERE rg.cliente_id = v_cliente.id
        AND rg.status = 'pendente'
        AND (rc.owner_id = p_owner_id OR rc.owner_id IS NULL)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cliente_fidelidade(uuid, text) TO anon, authenticated;
