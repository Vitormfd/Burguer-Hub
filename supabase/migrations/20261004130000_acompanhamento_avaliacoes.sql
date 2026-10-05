-- Link público de acompanhamento do pedido (/pedido/:id) e avaliação pós-entrega.
-- O id do pedido (uuid aleatório) funciona como token; a RPC expõe só dados mínimos
-- e apenas de pedidos delivery/retirada recentes.

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS acompanhamento_link_ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS avaliacao_ativa boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.configuracoes.acompanhamento_link_ativo IS
  'Inclui o link de acompanhamento na mensagem de pedido confirmado do WhatsApp';
COMMENT ON COLUMN public.configuracoes.avaliacao_ativa IS
  'Pede avaliação (1 a 5 estrelas) ao cliente depois da entrega';

CREATE TABLE IF NOT EXISTS public.avaliacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  nota smallint NOT NULL,
  comentario text,
  cliente_nome text,
  cliente_telefone text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avaliacoes_nota_check CHECK (nota BETWEEN 1 AND 5),
  CONSTRAINT avaliacoes_comentario_tamanho CHECK (comentario IS NULL OR length(comentario) <= 600),
  CONSTRAINT avaliacoes_pedido_unico UNIQUE (pedido_id)
);

CREATE INDEX IF NOT EXISTS idx_avaliacoes_owner_data ON public.avaliacoes (owner_id, criado_em DESC);

ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "avaliacoes_owner_select" ON public.avaliacoes;
CREATE POLICY "avaliacoes_owner_select" ON public.avaliacoes FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "avaliacoes_owner_delete" ON public.avaliacoes;
CREATE POLICY "avaliacoes_owner_delete" ON public.avaliacoes FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- Dados públicos do pedido para a página de acompanhamento.
CREATE OR REPLACE FUNCTION public.get_pedido_acompanhamento(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pedido record;
  v_entrega record;
  v_cfg record;
  v_itens jsonb;
  v_avaliacao jsonb;
BEGIN
  IF p_pedido_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.id, p.owner_id, p.status::text AS status, p.criado_em, p.subtotal, p.total,
         COALESCE(p.tipo_entrega::text, 'delivery') AS tipo_entrega
    INTO v_pedido
  FROM public.pedidos p
  WHERE p.id = p_pedido_id
    AND p.criado_em >= now() - interval '15 days';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT e.status::text AS status, e.cliente_nome, e.taxa_entrega, e.forma_pagamento, e.pago, e.bairro
    INTO v_entrega
  FROM public.entregas e
  WHERE e.pedido_id = v_pedido.id
  LIMIT 1;

  -- Pedidos de mesa não têm página pública.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT c.nome_loja, c.logo_url, c.cor_primaria, c.referencia, c.tempo_entrega_min,
         c.tempo_estimado_retirada, c.endereco_estabelecimento, COALESCE(c.avaliacao_ativa, true) AS avaliacao_ativa
    INTO v_cfg
  FROM public.configuracoes c
  WHERE c.owner_id = v_pedido.owner_id
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome', COALESCE(pr.nome, 'Item'),
           'quantidade', pi.quantidade,
           'total', ROUND(pi.quantidade * pi.preco_unitario, 2),
           'cancelado', COALESCE(pi.cancelado, false),
           'adicionais', COALESCE((
             SELECT jsonb_agg(COALESCE(a.nome, 'Adicional') || CASE WHEN pia.quantidade > 1 THEN ' x' || pia.quantidade ELSE '' END)
             FROM public.pedido_item_adicionais pia
             LEFT JOIN public.adicionais a ON a.id = pia.adicional_id
             WHERE pia.pedido_item_id = pi.id
           ), '[]'::jsonb)
         ) ORDER BY pr.nome), '[]'::jsonb)
    INTO v_itens
  FROM public.pedido_itens pi
  LEFT JOIN public.produtos pr ON pr.id = pi.produto_id
  WHERE pi.pedido_id = v_pedido.id;

  SELECT jsonb_build_object('nota', a.nota, 'comentario', a.comentario)
    INTO v_avaliacao
  FROM public.avaliacoes a
  WHERE a.pedido_id = v_pedido.id;

  RETURN jsonb_build_object(
    'id', v_pedido.id,
    'codigo', upper(substring(v_pedido.id::text from 1 for 8)),
    'status', v_pedido.status,
    'entrega_status', v_entrega.status,
    'tipo_entrega', v_pedido.tipo_entrega,
    'criado_em', v_pedido.criado_em,
    'cliente_nome', split_part(COALESCE(v_entrega.cliente_nome, ''), ' ', 1),
    'itens', v_itens,
    'subtotal', v_pedido.subtotal,
    'taxa_entrega', v_entrega.taxa_entrega,
    'total', v_pedido.total,
    'forma_pagamento', v_entrega.forma_pagamento,
    'pago', v_entrega.pago,
    'avaliacao', v_avaliacao,
    'loja', jsonb_build_object(
      'nome', v_cfg.nome_loja,
      'logo_url', v_cfg.logo_url,
      'cor_primaria', v_cfg.cor_primaria,
      'referencia', v_cfg.referencia,
      'tempo_entrega', v_cfg.tempo_entrega_min,
      'tempo_retirada', v_cfg.tempo_estimado_retirada,
      'endereco', v_cfg.endereco_estabelecimento,
      'avaliacao_ativa', COALESCE(v_cfg.avaliacao_ativa, true)
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_pedido_acompanhamento(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pedido_acompanhamento(uuid) TO anon, authenticated;

-- Avaliação feita pelo cliente na página do pedido (uma por pedido, só após a entrega).
CREATE OR REPLACE FUNCTION public.avaliar_pedido(p_pedido_id uuid, p_nota smallint, p_comentario text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_owner uuid;
  v_status text;
  v_entrega_status text;
  v_nome text;
  v_tel text;
BEGIN
  IF p_pedido_id IS NULL OR p_nota IS NULL OR p_nota NOT BETWEEN 1 AND 5 THEN
    RETURN false;
  END IF;

  SELECT p.owner_id, p.status::text, e.status::text, e.cliente_nome, e.cliente_telefone
    INTO v_owner, v_status, v_entrega_status, v_nome, v_tel
  FROM public.pedidos p
  JOIN public.entregas e ON e.pedido_id = p.id
  WHERE p.id = p_pedido_id
    AND p.criado_em >= now() - interval '15 days'
  LIMIT 1;

  IF NOT FOUND OR v_owner IS NULL OR v_status = 'cancelado' THEN
    RETURN false;
  END IF;

  IF v_status <> 'entregue' AND v_entrega_status <> 'entregue' THEN
    RETURN false;
  END IF;

  INSERT INTO public.avaliacoes (owner_id, pedido_id, nota, comentario, cliente_nome, cliente_telefone)
  VALUES (v_owner, p_pedido_id, p_nota, NULLIF(left(BTRIM(COALESCE(p_comentario, '')), 600), ''), v_nome, v_tel)
  ON CONFLICT (pedido_id) DO NOTHING;

  RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION public.avaliar_pedido(uuid, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.avaliar_pedido(uuid, smallint, text) TO anon, authenticated;
