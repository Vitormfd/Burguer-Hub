CREATE OR REPLACE FUNCTION public.create_public_delivery_order(
  p_owner_id uuid,
  p_tipo_entrega text,
  p_cliente_nome text,
  p_cliente_telefone text,
  p_endereco text,
  p_numero text,
  p_complemento text,
  p_bairro text,
  p_taxa_entrega numeric,
  p_forma_pagamento text,
  p_troco_para numeric DEFAULT NULL,
  p_subtotal numeric DEFAULT 0,
  p_desconto numeric DEFAULT 0,
  p_total numeric DEFAULT 0,
  p_cupom_id uuid DEFAULT NULL,
  p_valor_desconto numeric DEFAULT 0,
  p_cliente_id uuid DEFAULT NULL,
  p_selected_reward_id uuid DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id uuid;
  v_cliente_id uuid := p_cliente_id;
  v_resgate_id uuid := NULL;
  v_item jsonb;
  v_adicional jsonb;
  v_item_id uuid;
  v_phone text := public.normalize_phone(p_cliente_telefone);
  v_tipo_entrega public.tipo_entrega;
  v_produto_id_text text;
  v_produto_id uuid;
  v_adicional_id_text text;
  v_adicional_id uuid;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Loja inválida';
  END IF;

  IF COALESCE(jsonb_typeof(p_items), '') <> 'array' OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Carrinho vazio';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.configuracoes c
    WHERE c.owner_id = p_owner_id
      AND c.ativo = true
  ) THEN
    RAISE EXCEPTION 'Loja indisponível';
  END IF;

  BEGIN
    v_tipo_entrega := p_tipo_entrega::public.tipo_entrega;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'Tipo de entrega inválido';
  END;

  INSERT INTO public.pedidos (
    owner_id,
    tipo,
    tipo_entrega,
    status,
    cliente_id,
    subtotal,
    desconto,
    cupom_id,
    valor_desconto,
    total
  ) VALUES (
    p_owner_id,
    'delivery',
    v_tipo_entrega,
    'pendente',
    v_cliente_id,
    COALESCE(p_subtotal, 0),
    COALESCE(p_desconto, 0),
    p_cupom_id,
    COALESCE(p_valor_desconto, 0),
    COALESCE(p_total, 0)
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_item_id := gen_random_uuid();

    v_produto_id_text := COALESCE(
      NULLIF(v_item->>'produto_id', ''),
      NULLIF(v_item->>'produtoId', ''),
      NULLIF(v_item#>>'{produto,id}', '')
    );

    IF v_produto_id_text IS NULL THEN
      RAISE EXCEPTION 'Item sem produto_id no payload';
    END IF;

    BEGIN
      v_produto_id := v_produto_id_text::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'produto_id inválido no payload: %', v_produto_id_text;
    END;

    INSERT INTO public.pedido_itens (
      id,
      owner_id,
      pedido_id,
      produto_id,
      quantidade,
      preco_unitario,
      observacao
    ) VALUES (
      v_item_id,
      p_owner_id,
      v_pedido_id,
      v_produto_id,
      GREATEST(COALESCE((COALESCE(v_item->>'quantidade', v_item->>'qty'))::integer, 1), 1),
      GREATEST(COALESCE((COALESCE(v_item->>'preco_unitario', v_item->>'precoUnitario', v_item->>'price'))::numeric, 0), 0),
      NULLIF(BTRIM(COALESCE(v_item->>'observacao', v_item->>'observation', '')), '')
    );

    FOR v_adicional IN SELECT value FROM jsonb_array_elements(COALESCE(v_item->'adicionais', '[]'::jsonb))
    LOOP
      v_adicional_id_text := COALESCE(
        NULLIF(v_adicional->>'adicional_id', ''),
        NULLIF(v_adicional->>'adicionalId', '')
      );

      IF v_adicional_id_text IS NULL THEN
        CONTINUE;
      END IF;

      BEGIN
        v_adicional_id := v_adicional_id_text::uuid;
      EXCEPTION
        WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'adicional_id inválido no payload: %', v_adicional_id_text;
      END;

      INSERT INTO public.pedido_item_adicionais (
        pedido_item_id,
        adicional_id,
        quantidade,
        preco_unitario
      ) VALUES (
        v_item_id,
        v_adicional_id,
        GREATEST(COALESCE((COALESCE(v_adicional->>'quantidade', v_adicional->>'qty'))::integer, 1), 1),
        GREATEST(COALESCE((COALESCE(v_adicional->>'preco_unitario', v_adicional->>'precoUnitario', v_adicional->>'price'))::numeric, 0), 0)
      );
    END LOOP;
  END LOOP;

  INSERT INTO public.entregas (
    owner_id,
    pedido_id,
    cliente_nome,
    cliente_telefone,
    endereco,
    bairro,
    taxa_entrega,
    status,
    origem,
    numero,
    complemento,
    forma_pagamento,
    troco_para
  ) VALUES (
    p_owner_id,
    v_pedido_id,
    BTRIM(COALESCE(p_cliente_nome, '')),
    BTRIM(COALESCE(p_cliente_telefone, '')),
    COALESCE(p_endereco, 'Retirada no balcão'),
    p_bairro,
    GREATEST(COALESCE(p_taxa_entrega, 0), 0),
    'aguardando',
    'online',
    NULLIF(BTRIM(COALESCE(p_numero, '')), ''),
    NULLIF(BTRIM(COALESCE(p_complemento, '')), ''),
    p_forma_pagamento,
    p_troco_para
  );

  IF v_phone <> '' THEN
    v_cliente_id := public.register_cliente_pedido(v_pedido_id, p_cliente_nome, v_phone);
  ELSIF v_cliente_id IS NOT NULL THEN
    UPDATE public.pedidos
    SET cliente_id = v_cliente_id
    WHERE id = v_pedido_id;
  END IF;

  IF v_cliente_id IS NOT NULL AND v_tipo_entrega = 'delivery' THEN
    UPDATE public.clientes
    SET nome = COALESCE(NULLIF(BTRIM(COALESCE(p_cliente_nome, '')), ''), nome),
        telefone = COALESCE(NULLIF(v_phone, ''), telefone),
        endereco = COALESCE(NULLIF(BTRIM(COALESCE(p_endereco, '')), ''), endereco),
        numero = COALESCE(NULLIF(BTRIM(COALESCE(p_numero, '')), ''), numero),
        complemento = COALESCE(NULLIF(BTRIM(COALESCE(p_complemento, '')), ''), complemento),
        bairro = COALESCE(NULLIF(BTRIM(COALESCE(p_bairro, '')), ''), bairro)
    WHERE id = v_cliente_id;
  END IF;

  IF p_selected_reward_id IS NOT NULL AND v_cliente_id IS NOT NULL THEN
    INSERT INTO public.resgates (
      cliente_id,
      recompensa_id,
      pedido_id,
      status
    ) VALUES (
      v_cliente_id,
      p_selected_reward_id,
      v_pedido_id,
      'pendente'
    )
    RETURNING id INTO v_resgate_id;
  END IF;

  UPDATE public.pedidos
  SET cliente_id = COALESCE(v_cliente_id, cliente_id),
      recompensa_resgatada_id = COALESCE(v_resgate_id, recompensa_resgatada_id),
      cupom_id = COALESCE(p_cupom_id, cupom_id),
      valor_desconto = COALESCE(p_valor_desconto, valor_desconto)
  WHERE id = v_pedido_id;

  IF p_cupom_id IS NOT NULL THEN
    PERFORM public.registrar_uso_cupom(
      p_cupom_id,
      v_pedido_id,
      v_cliente_id,
      NULLIF(v_phone, ''),
      COALESCE(p_valor_desconto, 0)
    );
  END IF;

  RETURN jsonb_build_object(
    'pedido_id', v_pedido_id,
    'cliente_id', v_cliente_id,
    'recompensa_resgatada_id', v_resgate_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_public_delivery_order(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  uuid,
  numeric,
  uuid,
  uuid,
  jsonb
) TO anon, authenticated;
