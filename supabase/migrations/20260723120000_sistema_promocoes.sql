-- Sistema de Promoções (campanhas delivery) — desacoplado de cupons legados

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'promocao_tipo'
  ) THEN
    CREATE TYPE public.promocao_tipo AS ENUM (
      'desconto_percentual',
      'desconto_fixo',
      'frete_gratis',
      'compre_x_leve_y',
      'brinde',
      'combo',
      'desconto_categoria',
      'desconto_produto',
      'leve_mais_pague_menos',
      'pontos',
      'cupom'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.promocoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  nome text NOT NULL,
  descricao text,
  tipo public.promocao_tipo NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  prioridade integer NOT NULL DEFAULT 0,
  aplica_automaticamente boolean NOT NULL DEFAULT true,
  necessita_cupom boolean NOT NULL DEFAULT false,
  codigo_cupom text,
  data_inicio date,
  data_fim date,
  hora_inicio time,
  hora_fim time,
  dias_semana integer[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  limite_usos_total integer,
  usos_realizados integer NOT NULL DEFAULT 0,
  limite_por_cliente integer,
  condicoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  acao jsonb NOT NULL DEFAULT '{}'::jsonb,
  escopo_produtos jsonb NOT NULL DEFAULT '{"modo":"todos","categoria_ids":[],"produto_ids":[],"excluir_produto_ids":[]}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promocoes_nome_check CHECK (char_length(BTRIM(nome)) > 0),
  CONSTRAINT promocoes_usos_check CHECK (usos_realizados >= 0),
  CONSTRAINT promocoes_limite_total_check CHECK (limite_usos_total IS NULL OR limite_usos_total > 0),
  CONSTRAINT promocoes_limite_cliente_check CHECK (limite_por_cliente IS NULL OR limite_por_cliente > 0),
  CONSTRAINT promocoes_cupom_check CHECK (
    (necessita_cupom = false AND codigo_cupom IS NULL)
    OR (necessita_cupom = true AND codigo_cupom IS NOT NULL AND char_length(BTRIM(codigo_cupom)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promocoes_owner_codigo
  ON public.promocoes (owner_id, upper(codigo_cupom))
  WHERE codigo_cupom IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promocoes_owner_ativo_prioridade
  ON public.promocoes (owner_id, ativo, prioridade DESC);

CREATE INDEX IF NOT EXISTS idx_promocoes_owner_datas
  ON public.promocoes (owner_id, data_inicio, data_fim);

CREATE OR REPLACE FUNCTION public.normalize_promocao_codigo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.codigo_cupom IS NOT NULL THEN
    NEW.codigo_cupom := upper(trim(NEW.codigo_cupom));
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promocoes_normalize_codigo ON public.promocoes;
CREATE TRIGGER promocoes_normalize_codigo
BEFORE INSERT OR UPDATE ON public.promocoes
FOR EACH ROW EXECUTE FUNCTION public.normalize_promocao_codigo();

CREATE TABLE IF NOT EXISTS public.promocao_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE DEFAULT auth.uid(),
  promocao_id uuid NOT NULL REFERENCES public.promocoes(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  telefone_cliente text,
  valor_desconto_aplicado numeric(10,2) NOT NULL DEFAULT 0,
  pontos_extra integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  usado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promocao_usos_pedido_unico UNIQUE (pedido_id)
);

CREATE INDEX IF NOT EXISTS idx_promocao_usos_promocao
  ON public.promocao_usos (promocao_id, usado_em DESC);

CREATE INDEX IF NOT EXISTS idx_promocao_usos_telefone
  ON public.promocao_usos (telefone_cliente, usado_em DESC);

CREATE OR REPLACE FUNCTION public.set_owner_from_promocao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL AND NEW.promocao_id IS NOT NULL THEN
    SELECT p.owner_id INTO NEW.owner_id FROM public.promocoes p WHERE p.id = NEW.promocao_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promocao_usos_set_owner ON public.promocao_usos;
CREATE TRIGGER promocao_usos_set_owner
BEFORE INSERT ON public.promocao_usos
FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_promocao();

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS promocao_id uuid REFERENCES public.promocoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS valor_desconto_promocao numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.promocoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocao_usos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promocoes_owner_all" ON public.promocoes;
CREATE POLICY "promocoes_owner_all" ON public.promocoes
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "promocoes_select_ativas_public" ON public.promocoes;
CREATE POLICY "promocoes_select_ativas_public" ON public.promocoes
  FOR SELECT TO anon, authenticated
  USING (ativo = true);

DROP POLICY IF EXISTS "promocao_usos_owner_select" ON public.promocao_usos;
CREATE POLICY "promocao_usos_owner_select" ON public.promocao_usos
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.registrar_uso_promocao(
  p_promocao_id uuid,
  p_pedido_id uuid,
  p_cliente_id uuid DEFAULT NULL,
  p_telefone_cliente text DEFAULT NULL,
  p_valor_desconto_aplicado numeric DEFAULT 0,
  p_pontos_extra integer DEFAULT 0,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo public.promocoes%ROWTYPE;
  v_telefone text := NULLIF(regexp_replace(COALESCE(p_telefone_cliente, ''), '\D', '', 'g'), '');
  v_usos_cliente integer := 0;
BEGIN
  SELECT * INTO v_promo
  FROM public.promocoes
  WHERE id = p_promocao_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_promo.ativo THEN
    RAISE EXCEPTION 'Promoção inválida ou inexistente';
  END IF;

  IF v_promo.limite_usos_total IS NOT NULL AND v_promo.usos_realizados >= v_promo.limite_usos_total THEN
    RAISE EXCEPTION 'Essa promoção atingiu o limite de usos';
  END IF;

  IF v_promo.limite_por_cliente IS NOT NULL AND v_telefone IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO v_usos_cliente
    FROM public.promocao_usos
    WHERE promocao_id = p_promocao_id
      AND telefone_cliente = v_telefone;

    IF v_usos_cliente >= v_promo.limite_por_cliente THEN
      RAISE EXCEPTION 'Você já utilizou essa promoção o máximo de vezes permitido';
    END IF;
  END IF;

  INSERT INTO public.promocao_usos (
    owner_id,
    promocao_id,
    cliente_id,
    pedido_id,
    telefone_cliente,
    valor_desconto_aplicado,
    pontos_extra,
    meta
  ) VALUES (
    v_promo.owner_id,
    p_promocao_id,
    p_cliente_id,
    p_pedido_id,
    v_telefone,
    GREATEST(COALESCE(p_valor_desconto_aplicado, 0), 0),
    GREATEST(COALESCE(p_pontos_extra, 0), 0),
    COALESCE(p_meta, '{}'::jsonb)
  );

  UPDATE public.promocoes
  SET usos_realizados = usos_realizados + 1,
      atualizado_em = now()
  WHERE id = p_promocao_id;

  IF COALESCE(p_pontos_extra, 0) > 0 AND p_cliente_id IS NOT NULL THEN
    UPDATE public.clientes
    SET pontos = COALESCE(pontos, 0) + GREATEST(p_pontos_extra, 0)
    WHERE id = p_cliente_id;
  END IF;
END;
$$;

-- Remove overload antigo (assinatura sem campos de promoção)
DROP FUNCTION IF EXISTS public.create_public_delivery_order(
  uuid, text, text, text, text, text, text, text, numeric, text,
  numeric, numeric, numeric, numeric, uuid, numeric, uuid, uuid, jsonb
);

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
  p_items jsonb DEFAULT '[]'::jsonb,
  p_promocao_id uuid DEFAULT NULL,
  p_valor_desconto_promocao numeric DEFAULT 0,
  p_pontos_extra_promocao integer DEFAULT 0,
  p_promocao_meta jsonb DEFAULT '{}'::jsonb,
  p_promo_zera_frete boolean DEFAULT false
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
  v_taxa_bairro numeric;
  v_taxa_efetiva numeric;
  v_cupom_zera_frete boolean := false;
  v_promo_ok boolean := false;
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

  IF p_cupom_id IS NOT NULL THEN
    SELECT c.tipo = 'frete_gratis'
    INTO v_cupom_zera_frete
    FROM public.cupons c
    WHERE c.id = p_cupom_id;
  END IF;

  IF p_cupom_id IS NOT NULL AND public.tem_produto_em_promocao(v_produto_ids) THEN
    RAISE EXCEPTION 'Não é possível usar cupom com produtos em promoção';
  END IF;

  IF p_promocao_id IS NOT NULL THEN
    SELECT true INTO v_promo_ok
    FROM public.promocoes pr
    WHERE pr.id = p_promocao_id
      AND pr.owner_id = p_owner_id
      AND pr.ativo = true;

    IF NOT COALESCE(v_promo_ok, false) THEN
      RAISE EXCEPTION 'Promoção inválida';
    END IF;
  END IF;

  v_taxa_bairro := public.resolver_taxa_bairro(p_owner_id, p_bairro, p_taxa_entrega);
  v_taxa_efetiva := public.calcular_taxa_entrega_efetiva(
    p_owner_id,
    v_tipo_entrega,
    v_taxa_bairro,
    COALESCE(p_subtotal, 0),
    COALESCE(v_cupom_zera_frete, false) OR COALESCE(p_promo_zera_frete, false),
    p_bairro,
    v_produto_ids
  );

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
    promocao_id,
    valor_desconto_promocao,
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
    p_promocao_id,
    COALESCE(p_valor_desconto_promocao, 0),
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
    v_taxa_efetiva,
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
      valor_desconto = COALESCE(p_valor_desconto, valor_desconto),
      promocao_id = COALESCE(p_promocao_id, promocao_id),
      valor_desconto_promocao = COALESCE(p_valor_desconto_promocao, valor_desconto_promocao)
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

  IF p_promocao_id IS NOT NULL AND v_tipo_entrega = 'delivery' THEN
    PERFORM public.registrar_uso_promocao(
      p_promocao_id,
      v_pedido_id,
      v_cliente_id,
      NULLIF(v_phone, ''),
      COALESCE(p_valor_desconto_promocao, 0),
      COALESCE(p_pontos_extra_promocao, 0),
      COALESCE(p_promocao_meta, '{}'::jsonb)
    );
  END IF;

  RETURN jsonb_build_object(
    'pedido_id', v_pedido_id,
    'cliente_id', v_cliente_id,
    'recompensa_resgatada_id', v_resgate_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_uso_promocao(uuid, uuid, uuid, text, numeric, integer, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_delivery_order(
  uuid, text, text, text, text, text, text, text, numeric, text,
  numeric, numeric, numeric, numeric, uuid, numeric, uuid, uuid, jsonb,
  uuid, numeric, integer, jsonb, boolean
) TO anon, authenticated;
