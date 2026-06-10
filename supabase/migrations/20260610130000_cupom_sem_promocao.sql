CREATE OR REPLACE FUNCTION public.tem_produto_em_promocao(p_produto_ids uuid[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.produtos p
    WHERE p.id = ANY(COALESCE(p_produto_ids, ARRAY[]::uuid[]))
      AND p.promocao = true
      AND p.preco_promocional IS NOT NULL
  );
$$;

DROP FUNCTION IF EXISTS public.aplicar_cupom_checkout(text, text, numeric, numeric, boolean, uuid, uuid);

CREATE OR REPLACE FUNCTION public.aplicar_cupom_checkout(
  p_codigo text,
  p_telefone_cliente text DEFAULT NULL,
  p_subtotal numeric DEFAULT 0,
  p_taxa_entrega numeric DEFAULT 0,
  p_commit boolean DEFAULT false,
  p_pedido_id uuid DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL,
  p_produto_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom public.cupons%ROWTYPE;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_telefone text := NULLIF(regexp_replace(COALESCE(p_telefone_cliente, ''), '\D', '', 'g'), '');
  v_valor_desconto numeric := 0;
BEGIN
  IF public.tem_produto_em_promocao(p_produto_ids) THEN
    RAISE EXCEPTION 'Não é possível usar cupom com produtos em promoção';
  END IF;

  SELECT *
    INTO v_cupom
  FROM public.cupons
  WHERE codigo = upper(trim(COALESCE(p_codigo, '')))
  LIMIT 1;

  IF NOT FOUND OR NOT v_cupom.ativo THEN
    RAISE EXCEPTION 'Cupom inválido ou inexistente';
  END IF;

  IF (v_cupom.data_inicio IS NOT NULL AND v_hoje < v_cupom.data_inicio)
     OR (v_cupom.data_expiracao IS NOT NULL AND v_hoje > v_cupom.data_expiracao) THEN
    RAISE EXCEPTION 'Esse cupom expirou';
  END IF;

  IF v_cupom.limite_usos_total IS NOT NULL AND v_cupom.usos_realizados >= v_cupom.limite_usos_total THEN
    RAISE EXCEPTION 'Esse cupom atingiu o limite de usos';
  END IF;

  IF v_cupom.uso_unico_por_cliente AND v_telefone IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.cupom_usos
      WHERE cupom_id = v_cupom.id
        AND telefone_cliente = v_telefone
    ) THEN
      RAISE EXCEPTION 'Você já utilizou esse cupom';
    END IF;
  END IF;

  IF COALESCE(p_subtotal, 0) < COALESCE(v_cupom.valor_minimo_pedido, 0) THEN
    RAISE EXCEPTION 'Pedido mínimo de R$% para usar esse cupom', to_char(COALESCE(v_cupom.valor_minimo_pedido, 0), 'FM999999990D00');
  END IF;

  v_valor_desconto := CASE
    WHEN v_cupom.tipo = 'percentual' THEN COALESCE(p_subtotal, 0) * (COALESCE(v_cupom.valor, 0) / 100)
    WHEN v_cupom.tipo = 'fixo' THEN COALESCE(v_cupom.valor, 0)
    ELSE COALESCE(p_taxa_entrega, 0)
  END;

  v_valor_desconto := LEAST(GREATEST(v_valor_desconto, 0), GREATEST(COALESCE(p_subtotal, 0) + GREATEST(COALESCE(p_taxa_entrega, 0), 0) - 0.01, 0));

  IF p_commit THEN
    IF p_pedido_id IS NULL THEN
      RAISE EXCEPTION 'Pedido inválido para registrar cupom';
    END IF;

    PERFORM public.registrar_uso_cupom(
      v_cupom.id,
      p_pedido_id,
      p_cliente_id,
      v_telefone,
      v_valor_desconto
    );
  END IF;

  RETURN jsonb_build_object(
    'cupom', jsonb_build_object(
      'id', v_cupom.id,
      'codigo', v_cupom.codigo,
      'descricao', v_cupom.descricao,
      'tipo', v_cupom.tipo,
      'valor', v_cupom.valor,
      'valor_minimo_pedido', v_cupom.valor_minimo_pedido
    ),
    'valor_desconto_aplicado', ROUND(v_valor_desconto::numeric, 2),
    'taxa_entrega_zerada', v_cupom.tipo = 'frete_gratis'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_cupom_checkout(text, text, numeric, numeric, boolean, uuid, uuid, uuid[]) TO anon, authenticated;

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
  v_produto_ids uuid[] := ARRAY[]::uuid[];
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

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_produto_id_text := COALESCE(
      NULLIF(v_item->>'produto_id', ''),
      NULLIF(v_item->>'produtoId', ''),
      NULLIF(v_item#>>'{produto,id}', '')
    );

    IF v_produto_id_text IS NOT NULL THEN
      BEGIN
        v_produto_id := v_produto_id_text::uuid;
        v_produto_ids := array_append(v_produto_ids, v_produto_id);
      EXCEPTION
        WHEN invalid_text_representation THEN
          NULL;
      END;
    END IF;
  END LOOP;

  IF p_cupom_id IS NOT NULL AND public.tem_produto_em_promocao(v_produto_ids) THEN
    RAISE EXCEPTION 'Não é possível usar cupom com produtos em promoção';
  END IF;

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
