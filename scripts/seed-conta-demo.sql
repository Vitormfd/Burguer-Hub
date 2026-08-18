-- =============================================================================
-- Conta de demonstração — Easy Food Hub
-- Cole este script no SQL Editor do Supabase (role postgres) e execute.
-- Idempotente: se o e-mail já existir, reaproveita o login e recria os dados.
--
-- Login do painel:  demo@easyfoodhub.com.br
-- Senha:            Demo@123456
-- Cardápio público: https://easyfoodhub.com.br/burger-house-demo/cardapio
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE IF NOT EXISTS seed_demo_ids (
  k text PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid()
);

TRUNCATE seed_demo_ids;
INSERT INTO seed_demo_ids (k) VALUES
  ('cat_combos'), ('cat_smash'), ('cat_classicos'), ('cat_acomp'),
  ('cat_bebidas'), ('cat_sobremesas'), ('cat_cervejas'),
  ('p_combo_smash'), ('p_combo_bacon'), ('p_combo_kids'),
  ('p_smash'), ('p_smash_duplo'), ('p_smash_bacon'), ('p_smash_costela'),
  ('p_cheese'), ('p_house'), ('p_chicken'), ('p_veggie'),
  ('p_batata'), ('p_batata_cheddar'), ('p_onion'), ('p_nuggets'),
  ('p_coca'), ('p_guarana'), ('p_agua'), ('p_suco'),
  ('p_shake_choco'), ('p_shake_morango'),
  ('p_brownie'), ('p_petit'),
  ('p_heineken'), ('p_original'),
  ('g_ponto'), ('g_queijo'), ('g_extras'), ('g_refri'),
  ('a_mal'), ('a_ponto'), ('a_bem'),
  ('a_cheddar'), ('a_mussarela'), ('a_gorgonzola'),
  ('a_bacon'), ('a_ovo'), ('a_cebola'), ('a_molho'), ('a_bbq'),
  ('a_coca'), ('a_guarana'), ('a_sprite'),
  ('mesa_1'), ('mesa_2'), ('mesa_3'), ('mesa_4'), ('mesa_5'),
  ('mesa_6'), ('mesa_7'), ('mesa_8'), ('mesa_9'), ('mesa_10'),
  ('mesa_11'), ('mesa_12'),
  ('cli_ana'), ('cli_bruno'), ('cli_carla'), ('cli_diego'),
  ('cli_elena'), ('cli_fabio'), ('cli_gabi'), ('cli_hugo'),
  ('cup_bemvindo'), ('cup_frete'),
  ('rec_burger'), ('rec_10off'), ('rec_milkshake'),
  ('promo_combo'), ('promo_10off'), ('promo_frete'), ('promo_shake'),
  ('forn_frigo'), ('forn_bebidas'), ('forn_embalagens'),
  ('cc_carne'), ('cc_pao'), ('cc_embalagem'), ('cc_bebida'),
  ('caixa_aberto'),
  ('conta_m1'), ('conta_m2'), ('conta_m3'),
  ('ped_m1'), ('ped_m2'), ('ped_m3'),
  ('ped_del_pendente'), ('ped_del_preparo'), ('ped_del_saiu'),
  ('ped_del_entregue'), ('ped_ret_pronto'), ('ped_hist_1'), ('ped_hist_2'),
  ('item_m1a'), ('item_m1b'), ('item_m2a'), ('item_m3a'),
  ('item_d1a'), ('item_d1b'), ('item_d2a'), ('item_d3a'),
  ('item_d4a'), ('item_r1a'), ('item_h1a'), ('item_h2a');

CREATE OR REPLACE FUNCTION pg_temp.sid(p_key text)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM seed_demo_ids WHERE k = p_key
$$;

DO $$
DECLARE
  v_email      text := 'demo@easyfoodhub.com.br';
  v_password   text := 'Demo@123456';
  v_loja       text := 'Burger House';
  v_referencia text := 'burger-house-demo';
  v_user_id    uuid;
  v_instance   uuid;
  v_grupo_ids  uuid[];
  v_has_provider_id boolean;
  v_logo text := 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=400&q=80';
  v_banner text := 'https://images.unsplash.com/photo-1551782450-17144efb9c50?auto=format&fit=crop&w=1600&q=80';
  v_img_smash text := 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=800&q=80';
  v_img_bacon text := 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?auto=format&fit=crop&w=800&q=80';
  v_img_double text := 'https://images.unsplash.com/photo-1572802419224-296b0aeee0d9?auto=format&fit=crop&w=800&q=80';
  v_img_classic text := 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80';
  v_img_chicken text := 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=800&q=80';
  v_img_veggie text := 'https://images.unsplash.com/photo-1520072959219-c595dc870360?auto=format&fit=crop&w=800&q=80';
  v_img_fries text := 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=800&q=80';
  v_img_onion text := 'https://images.unsplash.com/photo-1639024471283-03518883512d?auto=format&fit=crop&w=800&q=80';
  v_img_nuggets text := 'https://images.unsplash.com/photo-1562967914-608f82629710?auto=format&fit=crop&w=800&q=80';
  v_img_soda text := 'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=800&q=80';
  v_img_shake text := 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=800&q=80';
  v_img_brownie text := 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=800&q=80';
  v_img_beer text := 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=800&q=80';
  v_img_combo text := 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?auto=format&fit=crop&w=800&q=80';
  v_img_costela text := 'https://images.unsplash.com/photo-1596662951482-0c4ba74a6df6?auto=format&fit=crop&w=800&q=80';
  v_img_cheddar text := 'https://images.unsplash.com/photo-1576107232684-1279f390859f?auto=format&fit=crop&w=800&q=80';
  v_img_petit text := 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=800&q=80';
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1) Usuário de autenticação
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_instance FROM auth.instances LIMIT 1;
  IF v_instance IS NULL THEN
    v_instance := '00000000-0000-0000-0000-000000000000';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change, email_change_token_new
    ) VALUES (
      v_instance, v_user_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt(v_password, extensions.gen_salt('bf')),
      now(), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('nome', v_loja),
      now(), now(),
      '', '', '', ''
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nome', v_loja),
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
  ) INTO v_has_provider_id;

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities WHERE user_id = v_user_id AND provider = 'email'
  ) THEN
    IF v_has_provider_id THEN
      INSERT INTO auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_user_id, v_user_id::text,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
        'email', now(), now(), now()
      );
    ELSE
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
        'email', now(), now(), now()
      );
    END IF;
  END IF;

  INSERT INTO public.profiles (id, nome)
  VALUES (v_user_id, v_loja)
  ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, updated_at = now();

  -- ---------------------------------------------------------------------------
  -- 2) Limpa dados anteriores desta conta (para poder reexecutar)
  -- ---------------------------------------------------------------------------
  SELECT array_agg(DISTINCT pga.grupo_id)
    INTO v_grupo_ids
  FROM public.produto_grupos_adicionais pga
  JOIN public.produtos p ON p.id = pga.produto_id
  WHERE p.owner_id = v_user_id;

  UPDATE public.pedidos
  SET recompensa_resgatada_id = NULL, cliente_id = NULL, cupom_id = NULL, promocao_id = NULL
  WHERE owner_id = v_user_id;

  DELETE FROM public.resgates
  WHERE cliente_id IN (SELECT id FROM public.clientes WHERE owner_id = v_user_id);

  DELETE FROM public.whatsapp_pedido_sessions WHERE owner_id = v_user_id;
  DELETE FROM public.whatsapp_logs
  WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE owner_id = v_user_id);

  DELETE FROM public.contas WHERE owner_id = v_user_id;
  DELETE FROM public.pedidos WHERE owner_id = v_user_id;
  DELETE FROM public.caixa_movimentacoes WHERE owner_id = v_user_id;
  DELETE FROM public.caixas WHERE owner_id = v_user_id;
  DELETE FROM public.compra_itens WHERE owner_id = v_user_id;
  DELETE FROM public.contas_pagar WHERE owner_id = v_user_id;
  DELETE FROM public.compras WHERE owner_id = v_user_id;
  DELETE FROM public.fornecedores WHERE owner_id = v_user_id;
  DELETE FROM public.categorias_compra WHERE owner_id = v_user_id;
  DELETE FROM public.produtos WHERE owner_id = v_user_id;
  DELETE FROM public.categorias WHERE owner_id = v_user_id;
  DELETE FROM public.mesas WHERE owner_id = v_user_id;
  DELETE FROM public.bairros_taxas WHERE owner_id = v_user_id;
  DELETE FROM public.cupons WHERE owner_id = v_user_id;
  DELETE FROM public.promocoes WHERE owner_id = v_user_id;
  DELETE FROM public.recompensas WHERE owner_id = v_user_id;
  DELETE FROM public.clientes WHERE owner_id = v_user_id;

  IF v_grupo_ids IS NOT NULL THEN
    DELETE FROM public.grupos_adicionais WHERE id = ANY(v_grupo_ids);
  END IF;

  IF EXISTS (SELECT 1 FROM public.configuracoes WHERE referencia = v_referencia AND owner_id IS DISTINCT FROM v_user_id) THEN
    v_referencia := v_referencia || '-' || substring(v_user_id::text, 1, 6);
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3) Configurações da loja
  -- ---------------------------------------------------------------------------
  INSERT INTO public.configuracoes (owner_id, nome_loja, referencia)
  VALUES (v_user_id, v_loja, v_referencia)
  ON CONFLICT DO NOTHING;

  UPDATE public.configuracoes SET
    nome_loja = v_loja,
    referencia = v_referencia,
    logo_url = v_logo,
    banner_url = v_banner,
    cor_primaria = '#DC2626',
    ativo = true,
    hora_abertura = '18:00',
    hora_fechamento = '23:00',
    horario_funcionamento = jsonb_build_array(
      jsonb_build_object('dia', 0, 'ativo', true,  'abertura', '18:00:00', 'fechamento', '23:00:00'),
      jsonb_build_object('dia', 1, 'ativo', false, 'abertura', '18:00:00', 'fechamento', '23:00:00'),
      jsonb_build_object('dia', 2, 'ativo', true,  'abertura', '18:00:00', 'fechamento', '23:00:00'),
      jsonb_build_object('dia', 3, 'ativo', true,  'abertura', '18:00:00', 'fechamento', '23:00:00'),
      jsonb_build_object('dia', 4, 'ativo', true,  'abertura', '18:00:00', 'fechamento', '23:00:00'),
      jsonb_build_object('dia', 5, 'ativo', true,  'abertura', '18:00:00', 'fechamento', '00:00:00'),
      jsonb_build_object('dia', 6, 'ativo', true,  'abertura', '18:00:00', 'fechamento', '00:00:00')
    ),
    seo_titulo = 'Burger House | Smash burgers artesanais',
    seo_descricao = 'Smash burgers, combos, milkshakes e delivery rápido. Peça online na Burger House.',
    tempo_entrega_min = '30-45 min',
    retirada_ativa = true,
    tempo_estimado_retirada = 20,
    endereco_estabelecimento = 'Rua das Palmeiras, 120 - Centro, São Paulo - SP',
    fidelidade_ativa = true,
    fidelidade_texto = 'A cada 10 pedidos, ganhe um Smash Burger grátis!',
    fidelidade_cor = '#DC2626',
    fidelidade_pedido_minimo = 25,
    frete_gratis_ativo = false,
    frete_gratis_minimo = 80,
    site_url = 'https://easyfoodhub.com.br',
    zapi_ativo = false,
    whatsapp_pedido_ativo = false,
    whatsapp_msg_boas_vindas =
      'Olá! 👋 Bem-vindo(a) à *{{loja}}*!' || chr(10) || chr(10) ||
      'Faça seu pedido pelo WhatsApp — é rápido e fácil! 🍔' || chr(10) || chr(10) ||
      'Digite *menu* para ver o cardápio' || chr(10) ||
      'Digite *carrinho* para ver seu pedido' || chr(10) ||
      'Digite *link* para o cardápio online' || chr(10) ||
      'Digite *cancelar* para desistir' || chr(10) ||
      'Digite *ajuda* para ver os comandos' || chr(10) || chr(10) ||
      '🌐 Ou peça pelo site: {{cardapio}}',
    whatsapp_msg_confirmado =
      'Olá {{nome}}! 🍔 Seu pedido #{{pedido_id}} foi confirmado e já está na fila!' || chr(10) || chr(10) ||
      '📋 *Itens:*' || chr(10) || '{{itens}}' || chr(10) || chr(10) ||
      '💰 *Total:* {{total}}' || chr(10) || chr(10) ||
      'Em breve começamos o preparo! 🔥',
    whatsapp_msg_em_preparo = '{{nome}}, seu pedido #{{pedido_id}} entrou em preparo agora! 👨‍🍳 Já já fica pronto!',
    whatsapp_msg_saiu_entrega = 'Seu pedido saiu para entrega! 🛵 Em aproximadamente {{tempo_estimado}} minutos chega aí, {{nome}}!',
    whatsapp_msg_entregue = 'Pedido entregue! ✅ Obrigado pela preferência, {{nome}}! Volte sempre 🍔❤️',
    whatsapp_msg_retirada_pronto = '{{nome}}, seu pedido #{{pedido_id}} está pronto para retirada no balcão! 🏃 Pode vir buscar!',
    whatsapp_msg_confirmado_ativo = true,
    whatsapp_msg_em_preparo_ativo = true,
    whatsapp_msg_saiu_entrega_ativo = true,
    whatsapp_msg_entregue_ativo = true,
    whatsapp_msg_retirada_pronto_ativo = true,
    carrossel_imagens = ARRAY[v_banner, v_img_smash, v_img_combo],
    carrossel_slides = jsonb_build_array(
      jsonb_build_object('url', v_banner, 'produto_id', pg_temp.sid('p_house'), 'promocao_id', null),
      jsonb_build_object('url', v_img_smash, 'produto_id', pg_temp.sid('p_smash_duplo'), 'promocao_id', null),
      jsonb_build_object('url', v_img_combo, 'produto_id', null, 'promocao_id', pg_temp.sid('promo_combo'))
    )
  WHERE owner_id = v_user_id;

  -- ---------------------------------------------------------------------------
  -- 4) Categorias e produtos
  -- ---------------------------------------------------------------------------
  INSERT INTO public.categorias (id, owner_id, nome, ativo, destaque, emoji, ordem) VALUES
    (pg_temp.sid('cat_combos'),     v_user_id, 'Combos',            true, true,  '🔥', 0),
    (pg_temp.sid('cat_smash'),      v_user_id, 'Smash Burgers',     true, true,  '🍔', 1),
    (pg_temp.sid('cat_classicos'),  v_user_id, 'Burgers Clássicos', true, false, '🧀', 2),
    (pg_temp.sid('cat_acomp'),      v_user_id, 'Acompanhamentos',   true, false, '🍟', 3),
    (pg_temp.sid('cat_bebidas'),    v_user_id, 'Bebidas',           true, false, '🥤', 4),
    (pg_temp.sid('cat_sobremesas'), v_user_id, 'Sobremesas',        true, false, '🍦', 5),
    (pg_temp.sid('cat_cervejas'),   v_user_id, 'Cervejas',          true, false, '🍺', 6);

  INSERT INTO public.produtos (
    id, owner_id, categoria_id, nome, descricao, serve_texto, preco, disponivel,
    destaque, imagem_url, promocao, preco_promocional, ordem
  ) VALUES
    (pg_temp.sid('p_combo_smash'), v_user_id, pg_temp.sid('cat_combos'),
      'Combo Smash', 'Smash Burger + batata frita + refrigerante lata.', 'Serve 1 pessoa',
      42.90, true, true, v_img_combo, false, null, 0),
    (pg_temp.sid('p_combo_bacon'), v_user_id, pg_temp.sid('cat_combos'),
      'Combo Bacon Duplo', 'Smash Bacon + batata cheddar + refrigerante.', 'Serve 1 pessoa',
      54.90, true, false, v_img_bacon, false, null, 1),
    (pg_temp.sid('p_combo_kids'), v_user_id, pg_temp.sid('cat_combos'),
      'Combo Kids', 'Mini burger + batata pequena + suco.', 'Serve 1 criança',
      29.90, true, false, v_img_classic, false, null, 2),

    (pg_temp.sid('p_smash'), v_user_id, pg_temp.sid('cat_smash'),
      'Smash Burger', 'Blend 90g smash, queijo cheddar, picles e molho da casa no pão brioche.', 'Serve 1 pessoa',
      28.90, true, false, v_img_smash, false, null, 0),
    (pg_temp.sid('p_smash_duplo'), v_user_id, pg_temp.sid('cat_smash'),
      'Smash Duplo', 'Dois blends 90g, cheddar duplo e molho especial.', 'Serve 1 pessoa',
      36.90, true, true, v_img_double, true, 32.90, 1),
    (pg_temp.sid('p_smash_bacon'), v_user_id, pg_temp.sid('cat_smash'),
      'Smash Bacon', 'Smash 90g, cheddar, bacon crocante e barbecue.', 'Serve 1 pessoa',
      34.90, true, true, v_img_bacon, false, null, 2),
    (pg_temp.sid('p_smash_costela'), v_user_id, pg_temp.sid('cat_smash'),
      'Smash Costela', 'Blend de costela 120g, onion rings e molho barbecue.', 'Serve 1 pessoa',
      39.90, true, false, v_img_costela, false, null, 3),

    (pg_temp.sid('p_cheese'), v_user_id, pg_temp.sid('cat_classicos'),
      'Cheeseburger', 'Burger 140g, queijo prato, alface, tomate e maionese.', 'Serve 1 pessoa',
      32.90, true, false, v_img_classic, false, null, 0),
    (pg_temp.sid('p_house'), v_user_id, pg_temp.sid('cat_classicos'),
      'Burger House', 'Assinatura da casa: 160g, cheddar, bacon, cebola crispy e molho especial.', 'Serve 1 pessoa',
      38.90, true, true, v_img_classic, false, null, 1),
    (pg_temp.sid('p_chicken'), v_user_id, pg_temp.sid('cat_classicos'),
      'Chicken Crispy', 'Filé de frango empanado, alface americana e maionese cítrica.', 'Serve 1 pessoa',
      33.90, true, false, v_img_chicken, false, null, 2),
    (pg_temp.sid('p_veggie'), v_user_id, pg_temp.sid('cat_classicos'),
      'Veggie Garden', 'Burger de grão-de-bico, rúcula, tomate e molho tahine.', 'Serve 1 pessoa',
      31.90, true, false, v_img_veggie, false, null, 3),

    (pg_temp.sid('p_batata'), v_user_id, pg_temp.sid('cat_acomp'),
      'Batata Frita', 'Porção crocante com sal de alecrim.', 'Serve 1 a 2 pessoas',
      14.90, true, false, v_img_fries, false, null, 0),
    (pg_temp.sid('p_batata_cheddar'), v_user_id, pg_temp.sid('cat_acomp'),
      'Batata Cheddar Bacon', 'Batata frita coberta com cheddar cremoso e bacon.', 'Serve 2 pessoas',
      22.90, true, true, v_img_cheddar, false, null, 1),
    (pg_temp.sid('p_onion'), v_user_id, pg_temp.sid('cat_acomp'),
      'Onion Rings', 'Anéis de cebola empanados e crocantes.', 'Serve 1 a 2 pessoas',
      16.90, true, false, v_img_onion, false, null, 2),
    (pg_temp.sid('p_nuggets'), v_user_id, pg_temp.sid('cat_acomp'),
      'Nuggets (8 un.)', 'Nuggets de frango com molho barbecue.', 'Serve 1 pessoa',
      18.90, true, false, v_img_nuggets, false, null, 3),

    (pg_temp.sid('p_coca'), v_user_id, pg_temp.sid('cat_bebidas'),
      'Coca-Cola Lata 350ml', 'Lata gelada.', '1 unidade', 7.00, true, false, v_img_soda, false, null, 0),
    (pg_temp.sid('p_guarana'), v_user_id, pg_temp.sid('cat_bebidas'),
      'Guaraná Lata 350ml', 'Lata gelada.', '1 unidade', 7.00, true, false, v_img_soda, false, null, 1),
    (pg_temp.sid('p_agua'), v_user_id, pg_temp.sid('cat_bebidas'),
      'Água Mineral 500ml', 'Com ou sem gás (informe na observação).', '1 unidade', 4.00, true, false, v_img_soda, false, null, 2),
    (pg_temp.sid('p_suco'), v_user_id, pg_temp.sid('cat_bebidas'),
      'Suco Natural 400ml', 'Laranja, limão ou maracujá.', '1 unidade', 10.00, true, false, v_img_soda, false, null, 3),
    (pg_temp.sid('p_shake_choco'), v_user_id, pg_temp.sid('cat_bebidas'),
      'Milkshake Chocolate', 'Cremoso, 400ml.', 'Serve 1 pessoa', 16.90, true, true, v_img_shake, false, null, 4),
    (pg_temp.sid('p_shake_morango'), v_user_id, pg_temp.sid('cat_bebidas'),
      'Milkshake Morango', 'Cremoso, 400ml.', 'Serve 1 pessoa', 16.90, true, false, v_img_shake, false, null, 5),

    (pg_temp.sid('p_brownie'), v_user_id, pg_temp.sid('cat_sobremesas'),
      'Brownie com Sorvete', 'Brownie quente com bola de creme e calda de chocolate.', 'Serve 1 pessoa',
      18.90, true, true, v_img_brownie, false, null, 0),
    (pg_temp.sid('p_petit'), v_user_id, pg_temp.sid('cat_sobremesas'),
      'Petit Gâteau', 'Bolinho quente de chocolate com sorvete de creme.', 'Serve 1 pessoa',
      19.90, true, false, v_img_petit, false, null, 1),

    (pg_temp.sid('p_heineken'), v_user_id, pg_temp.sid('cat_cervejas'),
      'Heineken Long Neck', 'Long neck 330ml gelada.', '1 unidade', 12.00, true, false, v_img_beer, false, null, 0),
    (pg_temp.sid('p_original'), v_user_id, pg_temp.sid('cat_cervejas'),
      'Original Long Neck', 'Long neck 330ml gelada.', '1 unidade', 10.00, true, false, v_img_beer, false, null, 1);

  -- ---------------------------------------------------------------------------
  -- 5) Adicionais em cascata
  -- ---------------------------------------------------------------------------
  INSERT INTO public.grupos_adicionais (id, nome, descricao, obrigatorio, min_escolhas, max_escolhas, ordem, disponivel) VALUES
    (pg_temp.sid('g_ponto'), 'Ponto da carne', 'Escolha o ponto do burger.', true, 1, 1, 0, true),
    (pg_temp.sid('g_queijo'), 'Queijo extra', 'Adicione até 2 queijos.', false, 0, 2, 1, true),
    (pg_temp.sid('g_extras'), 'Extras', 'Deixe o burger do seu jeito.', false, 0, 5, 2, true),
    (pg_temp.sid('g_refri'), 'Escolha o refrigerante', 'Incluso no combo.', true, 1, 1, 0, true);

  INSERT INTO public.adicionais (id, grupo_id, nome, preco, disponivel, ordem) VALUES
    (pg_temp.sid('a_mal'), pg_temp.sid('g_ponto'), 'Mal passada', 0, true, 0),
    (pg_temp.sid('a_ponto'), pg_temp.sid('g_ponto'), 'Ao ponto', 0, true, 1),
    (pg_temp.sid('a_bem'), pg_temp.sid('g_ponto'), 'Bem passada', 0, true, 2),
    (pg_temp.sid('a_cheddar'), pg_temp.sid('g_queijo'), 'Cheddar extra', 3.00, true, 0),
    (pg_temp.sid('a_mussarela'), pg_temp.sid('g_queijo'), 'Mussarela extra', 3.00, true, 1),
    (pg_temp.sid('a_gorgonzola'), pg_temp.sid('g_queijo'), 'Gorgonzola', 5.00, true, 2),
    (pg_temp.sid('a_bacon'), pg_temp.sid('g_extras'), 'Bacon crocante', 6.00, true, 0),
    (pg_temp.sid('a_ovo'), pg_temp.sid('g_extras'), 'Ovo', 4.00, true, 1),
    (pg_temp.sid('a_cebola'), pg_temp.sid('g_extras'), 'Cebola crispy', 4.00, true, 2),
    (pg_temp.sid('a_molho'), pg_temp.sid('g_extras'), 'Molho da casa extra', 3.00, true, 3),
    (pg_temp.sid('a_bbq'), pg_temp.sid('g_extras'), 'Barbecue extra', 2.00, true, 4),
    (pg_temp.sid('a_coca'), pg_temp.sid('g_refri'), 'Coca-Cola', 0, true, 0),
    (pg_temp.sid('a_guarana'), pg_temp.sid('g_refri'), 'Guaraná', 0, true, 1),
    (pg_temp.sid('a_sprite'), pg_temp.sid('g_refri'), 'Sprite', 0, true, 2);

  INSERT INTO public.produto_grupos_adicionais (produto_id, grupo_id, ordem) VALUES
    (pg_temp.sid('p_smash'), pg_temp.sid('g_ponto'), 0),
    (pg_temp.sid('p_smash'), pg_temp.sid('g_queijo'), 1),
    (pg_temp.sid('p_smash'), pg_temp.sid('g_extras'), 2),
    (pg_temp.sid('p_smash_duplo'), pg_temp.sid('g_ponto'), 0),
    (pg_temp.sid('p_smash_duplo'), pg_temp.sid('g_queijo'), 1),
    (pg_temp.sid('p_smash_duplo'), pg_temp.sid('g_extras'), 2),
    (pg_temp.sid('p_smash_bacon'), pg_temp.sid('g_ponto'), 0),
    (pg_temp.sid('p_smash_bacon'), pg_temp.sid('g_queijo'), 1),
    (pg_temp.sid('p_smash_bacon'), pg_temp.sid('g_extras'), 2),
    (pg_temp.sid('p_smash_costela'), pg_temp.sid('g_ponto'), 0),
    (pg_temp.sid('p_smash_costela'), pg_temp.sid('g_extras'), 1),
    (pg_temp.sid('p_cheese'), pg_temp.sid('g_ponto'), 0),
    (pg_temp.sid('p_cheese'), pg_temp.sid('g_extras'), 1),
    (pg_temp.sid('p_house'), pg_temp.sid('g_ponto'), 0),
    (pg_temp.sid('p_house'), pg_temp.sid('g_queijo'), 1),
    (pg_temp.sid('p_house'), pg_temp.sid('g_extras'), 2),
    (pg_temp.sid('p_combo_smash'), pg_temp.sid('g_ponto'), 0),
    (pg_temp.sid('p_combo_smash'), pg_temp.sid('g_refri'), 1),
    (pg_temp.sid('p_combo_bacon'), pg_temp.sid('g_ponto'), 0),
    (pg_temp.sid('p_combo_bacon'), pg_temp.sid('g_refri'), 1);

  -- ---------------------------------------------------------------------------
  -- 6) Mesas, bairros, cupons, fidelidade, promoções
  -- ---------------------------------------------------------------------------
  INSERT INTO public.mesas (id, owner_id, numero, status) VALUES
    (pg_temp.sid('mesa_1'), v_user_id, 1, 'ocupada'),
    (pg_temp.sid('mesa_2'), v_user_id, 2, 'ocupada'),
    (pg_temp.sid('mesa_3'), v_user_id, 3, 'aguardando_pagamento'),
    (pg_temp.sid('mesa_4'), v_user_id, 4, 'livre'),
    (pg_temp.sid('mesa_5'), v_user_id, 5, 'livre'),
    (pg_temp.sid('mesa_6'), v_user_id, 6, 'livre'),
    (pg_temp.sid('mesa_7'), v_user_id, 7, 'livre'),
    (pg_temp.sid('mesa_8'), v_user_id, 8, 'livre'),
    (pg_temp.sid('mesa_9'), v_user_id, 9, 'livre'),
    (pg_temp.sid('mesa_10'), v_user_id, 10, 'livre'),
    (pg_temp.sid('mesa_11'), v_user_id, 11, 'livre'),
    (pg_temp.sid('mesa_12'), v_user_id, 12, 'livre');

  INSERT INTO public.bairros_taxas (owner_id, nome, taxa, ativo, frete_gratis_ativo, frete_gratis_minimo) VALUES
    (v_user_id, 'Centro', 5.00, true, false, null),
    (v_user_id, 'Jardim América', 7.00, true, false, null),
    (v_user_id, 'Vila Nova', 8.00, true, false, 50),
    (v_user_id, 'Bela Vista', 10.00, true, false, null),
    (v_user_id, 'Industrial', 12.00, true, false, null),
    (v_user_id, 'Até 2 km', 0.00, true, true, null);

  INSERT INTO public.cupons (
    id, owner_id, codigo, descricao, tipo, valor, valor_minimo_pedido,
    limite_usos_total, usos_realizados, uso_unico_por_cliente,
    data_inicio, data_expiracao, ativo
  ) VALUES
    (pg_temp.sid('cup_bemvindo'), v_user_id, 'DEMOHUB10',
      '10% de desconto no primeiro pedido (mín. R$ 40).', 'percentual', 10, 40,
      500, 12, true, CURRENT_DATE - 10, CURRENT_DATE + 90, true),
    (pg_temp.sid('cup_frete'), v_user_id, 'DEMOFRETE',
      'Frete grátis em pedidos acima de R$ 50.', 'frete_gratis', null, 50,
      200, 8, false, CURRENT_DATE - 10, CURRENT_DATE + 90, true);

  INSERT INTO public.recompensas (
    id, owner_id, nome, descricao, tipo, valor, produto_id,
    pedidos_necessarios, ativo, ordem
  ) VALUES
    (pg_temp.sid('rec_burger'), v_user_id, 'Smash Burger grátis',
      'Ganhe um Smash Burger após 10 pedidos.', 'item_gratis', 0,
      pg_temp.sid('p_smash'), 10, true, 0),
    (pg_temp.sid('rec_10off'), v_user_id, '10% de desconto',
      'Desconto de 10% no pedido após 8 pedidos.', 'desconto_percentual', 10,
      null, 8, true, 1),
    (pg_temp.sid('rec_milkshake'), v_user_id, 'Milkshake grátis',
      'Milkshake de chocolate após 6 pedidos.', 'item_gratis', 0,
      pg_temp.sid('p_shake_choco'), 6, true, 2);

  INSERT INTO public.promocoes (
    id, owner_id, nome, descricao, tipo, ativo, prioridade,
    aplica_automaticamente, necessita_cupom, codigo_cupom,
    data_inicio, data_fim, dias_semana,
    condicoes, acao, escopo_produtos
  ) VALUES
    (pg_temp.sid('promo_combo'), v_user_id,
      'Combo Smash da casa', 'Smash + batata + refri por preço especial.',
      'combo', true, 100, true, false, null,
      CURRENT_DATE - 5, CURRENT_DATE + 60, ARRAY[0,1,2,3,4,5,6],
      '[]'::jsonb,
      jsonb_build_object(
        'combo', jsonb_build_object(
          'preco', 42.90,
          'itens', jsonb_build_array(
            jsonb_build_object('produto_id', pg_temp.sid('p_smash'), 'qtd', 1),
            jsonb_build_object('produto_id', pg_temp.sid('p_batata'), 'qtd', 1),
            jsonb_build_object('produto_id', pg_temp.sid('p_coca'), 'qtd', 1)
          )
        )
      ),
      '{"modo":"todos","categoria_ids":[],"produto_ids":[],"excluir_produto_ids":[]}'::jsonb),
    (pg_temp.sid('promo_10off'), v_user_id,
      '10% no primeiro pedido', 'Desconto automático no primeiro pedido acima de R$ 40.',
      'desconto_percentual', true, 80, true, false, null,
      CURRENT_DATE - 5, CURRENT_DATE + 60, ARRAY[0,1,2,3,4,5,6],
      jsonb_build_array(
        jsonb_build_object('tipo', 'primeiro_pedido', 'params', '{}'::jsonb),
        jsonb_build_object('tipo', 'valor_minimo', 'params', jsonb_build_object('valor', 40))
      ),
      jsonb_build_object('percentual', 10, 'teto', 15),
      '{"modo":"todos","categoria_ids":[],"produto_ids":[],"excluir_produto_ids":[]}'::jsonb),
    (pg_temp.sid('promo_frete'), v_user_id,
      'Frete grátis acima de R$ 80', 'Taxa de entrega zerada automaticamente.',
      'frete_gratis', true, 50, true, false, null,
      CURRENT_DATE - 5, CURRENT_DATE + 90, ARRAY[0,1,2,3,4,5,6],
      jsonb_build_array(
        jsonb_build_object('tipo', 'valor_minimo', 'params', jsonb_build_object('valor', 80))
      ),
      jsonb_build_object('frete', jsonb_build_object('modo', 'gratis')),
      '{"modo":"todos","categoria_ids":[],"produto_ids":[],"excluir_produto_ids":[]}'::jsonb),
    (pg_temp.sid('promo_shake'), v_user_id,
      '2 milkshakes por R$ 28', 'Leve 2 milkshakes e pague preço especial.',
      'leve_mais_pague_menos', true, 40, true, false, null,
      CURRENT_DATE - 5, CURRENT_DATE + 45, ARRAY[0,5,6],
      '[]'::jsonb,
      jsonb_build_object(
        'leve_mais', jsonb_build_object(
          'produto_ids', jsonb_build_array(pg_temp.sid('p_shake_choco'), pg_temp.sid('p_shake_morango')),
          'categoria_ids', '[]'::jsonb,
          'faixas', jsonb_build_array(jsonb_build_object('qtd', 2, 'preco', 28))
        )
      ),
      jsonb_build_object(
        'modo', 'produtos',
        'categoria_ids', '[]'::jsonb,
        'produto_ids', jsonb_build_array(pg_temp.sid('p_shake_choco'), pg_temp.sid('p_shake_morango')),
        'excluir_produto_ids', '[]'::jsonb
      ));

  -- ---------------------------------------------------------------------------
  -- 7) Clientes
  -- ---------------------------------------------------------------------------
  INSERT INTO public.clientes (
    id, owner_id, nome, telefone, endereco, numero, complemento, bairro,
    total_pedidos, pontos
  ) VALUES
    (pg_temp.sid('cli_ana'), v_user_id, 'Ana Souza', '11988880001',
      'Rua Augusta', '1500', 'Apto 32', 'Centro', 12, 2),
    (pg_temp.sid('cli_bruno'), v_user_id, 'Bruno Lima', '11988880002',
      'Av. Paulista', '900', 'Conjunto 12', 'Bela Vista', 8, 8),
    (pg_temp.sid('cli_carla'), v_user_id, 'Carla Mendes', '11988880003',
      'Rua Harmonia', '210', null, 'Vila Nova', 5, 5),
    (pg_temp.sid('cli_diego'), v_user_id, 'Diego Alves', '11988880004',
      'Rua das Palmeiras', '45', 'Casa', 'Jardim América', 3, 3),
    (pg_temp.sid('cli_elena'), v_user_id, 'Elena Costa', '11988880005',
      'Rua do Comércio', '88', null, 'Centro', 1, 1),
    (pg_temp.sid('cli_fabio'), v_user_id, 'Fábio Nunes', '11988880006',
      'Av. Industrial', '3200', 'Galpão 2', 'Industrial', 0, 0),
    (pg_temp.sid('cli_gabi'), v_user_id, 'Gabriela Rocha', '11988880007',
      'Rua das Flores', '12', 'Fundos', 'Centro', 6, 0),
    (pg_temp.sid('cli_hugo'), v_user_id, 'Hugo Martins', '11988880008',
      'Rua Bela Cintra', '700', 'Apto 101', 'Bela Vista', 2, 2);

  -- ---------------------------------------------------------------------------
  -- 8) Operação ao vivo: mesas + delivery + caixa
  -- ---------------------------------------------------------------------------
  INSERT INTO public.contas (
    id, owner_id, mesa_id, status, total, modalidade_consumo, nome, aberta_em
  ) VALUES
    (pg_temp.sid('conta_m1'), v_user_id, pg_temp.sid('mesa_1'), 'aberta', 79.80, 'local', 'Família Souza', now() - interval '40 minutes'),
    (pg_temp.sid('conta_m2'), v_user_id, pg_temp.sid('mesa_2'), 'aberta', 57.80, 'local', 'Mesa 2', now() - interval '18 minutes'),
    (pg_temp.sid('conta_m3'), v_user_id, pg_temp.sid('mesa_3'), 'aberta', 42.90, 'levar', 'Retirada João', now() - interval '55 minutes');

  INSERT INTO public.pedidos (
    id, owner_id, conta_id, cliente_id, tipo, tipo_entrega, status,
    subtotal, desconto, total, criado_em
  ) VALUES
    (pg_temp.sid('ped_m1'), v_user_id, pg_temp.sid('conta_m1'), null, 'mesa', 'retirada', 'em_preparo',
      79.80, 0, 79.80, now() - interval '40 minutes'),
    (pg_temp.sid('ped_m2'), v_user_id, pg_temp.sid('conta_m2'), null, 'mesa', 'retirada', 'pendente',
      57.80, 0, 57.80, now() - interval '18 minutes'),
    (pg_temp.sid('ped_m3'), v_user_id, pg_temp.sid('conta_m3'), null, 'mesa', 'retirada', 'pronto',
      42.90, 0, 42.90, now() - interval '55 minutes');

  INSERT INTO public.pedido_itens (id, owner_id, pedido_id, produto_id, quantidade, preco_unitario, observacao) VALUES
    (pg_temp.sid('item_m1a'), v_user_id, pg_temp.sid('ped_m1'), pg_temp.sid('p_house'), 1, 38.90, 'Sem cebola'),
    (pg_temp.sid('item_m1b'), v_user_id, pg_temp.sid('ped_m1'), pg_temp.sid('p_smash_bacon'), 1, 34.90, null),
    (pg_temp.sid('item_m2a'), v_user_id, pg_temp.sid('ped_m2'), pg_temp.sid('p_combo_smash'), 1, 42.90, null),
    (gen_random_uuid(), v_user_id, pg_temp.sid('ped_m2'), pg_temp.sid('p_batata'), 1, 14.90, null),
    (pg_temp.sid('item_m3a'), v_user_id, pg_temp.sid('ped_m3'), pg_temp.sid('p_combo_smash'), 1, 42.90, 'Para viagem');

  INSERT INTO public.pedido_item_adicionais (pedido_item_id, adicional_id, quantidade, preco_unitario) VALUES
    (pg_temp.sid('item_m1a'), pg_temp.sid('a_ponto'), 1, 0),
    (pg_temp.sid('item_m1a'), pg_temp.sid('a_bacon'), 1, 6.00),
    (pg_temp.sid('item_m1b'), pg_temp.sid('a_mal'), 1, 0),
    (pg_temp.sid('item_m2a'), pg_temp.sid('a_ponto'), 1, 0),
    (pg_temp.sid('item_m2a'), pg_temp.sid('a_coca'), 1, 0);

  INSERT INTO public.pedidos (
    id, owner_id, cliente_id, tipo, tipo_entrega, status,
    subtotal, desconto, valor_desconto, total, criado_em, cupom_id
  ) VALUES
    (pg_temp.sid('ped_del_pendente'), v_user_id, pg_temp.sid('cli_elena'), 'delivery', 'delivery', 'pendente',
      51.80, 0, 0, 56.80, now() - interval '6 minutes', null),
    (pg_temp.sid('ped_del_preparo'), v_user_id, pg_temp.sid('cli_diego'), 'delivery', 'delivery', 'em_preparo',
      61.80, 0, 0, 68.80, now() - interval '22 minutes', null),
    (pg_temp.sid('ped_del_saiu'), v_user_id, pg_temp.sid('cli_carla'), 'delivery', 'delivery', 'pronto',
      42.90, 0, 0, 50.90, now() - interval '38 minutes', null),
    (pg_temp.sid('ped_del_entregue'), v_user_id, pg_temp.sid('cli_ana'), 'delivery', 'delivery', 'entregue',
      71.80, 7.18, 7.18, 69.62, now() - interval '3 hours', pg_temp.sid('cup_bemvindo')),
    (pg_temp.sid('ped_ret_pronto'), v_user_id, pg_temp.sid('cli_hugo'), 'delivery', 'retirada', 'pronto',
      38.90, 0, 0, 38.90, now() - interval '15 minutes', null),
    (pg_temp.sid('ped_hist_1'), v_user_id, pg_temp.sid('cli_bruno'), 'delivery', 'delivery', 'entregue',
      54.90, 0, 0, 61.90, now() - interval '1 day', null),
    (pg_temp.sid('ped_hist_2'), v_user_id, pg_temp.sid('cli_gabi'), 'delivery', 'delivery', 'entregue',
      33.90, 0, 0, 38.90, now() - interval '2 days', null);

  INSERT INTO public.pedido_itens (id, owner_id, pedido_id, produto_id, quantidade, preco_unitario, observacao) VALUES
    (pg_temp.sid('item_d1a'), v_user_id, pg_temp.sid('ped_del_pendente'), pg_temp.sid('p_smash_duplo'), 1, 32.90, 'Bem passada'),
    (pg_temp.sid('item_d1b'), v_user_id, pg_temp.sid('ped_del_pendente'), pg_temp.sid('p_batata'), 1, 14.90, null),
    (pg_temp.sid('item_d2a'), v_user_id, pg_temp.sid('ped_del_preparo'), pg_temp.sid('p_house'), 1, 38.90, null),
    (pg_temp.sid('item_d3a'), v_user_id, pg_temp.sid('ped_del_saiu'), pg_temp.sid('p_combo_smash'), 1, 42.90, null),
    (pg_temp.sid('item_d4a'), v_user_id, pg_temp.sid('ped_del_entregue'), pg_temp.sid('p_combo_bacon'), 1, 54.90, null),
    (pg_temp.sid('item_r1a'), v_user_id, pg_temp.sid('ped_ret_pronto'), pg_temp.sid('p_house'), 1, 38.90, 'Retirada no balcão'),
    (pg_temp.sid('item_h1a'), v_user_id, pg_temp.sid('ped_hist_1'), pg_temp.sid('p_combo_bacon'), 1, 54.90, null),
    (pg_temp.sid('item_h2a'), v_user_id, pg_temp.sid('ped_hist_2'), pg_temp.sid('p_chicken'), 1, 33.90, null);

  INSERT INTO public.entregas (
    owner_id, pedido_id, cliente_nome, cliente_telefone, endereco, numero, complemento,
    bairro, taxa_entrega, status, origem, forma_pagamento, troco_para
  ) VALUES
    (v_user_id, pg_temp.sid('ped_del_pendente'), 'Elena Costa', '11988880005',
      'Rua do Comércio', '88', null, 'Centro', 5.00, 'aguardando', 'online', 'pix', null),
    (v_user_id, pg_temp.sid('ped_del_preparo'), 'Diego Alves', '11988880004',
      'Rua das Palmeiras', '45', 'Casa', 'Jardim América', 7.00, 'aguardando', 'online', 'dinheiro', 80),
    (v_user_id, pg_temp.sid('ped_del_saiu'), 'Carla Mendes', '11988880003',
      'Rua Harmonia', '210', null, 'Vila Nova', 8.00, 'saiu_para_entrega', 'online', 'cartao', null),
    (v_user_id, pg_temp.sid('ped_del_entregue'), 'Ana Souza', '11988880001',
      'Rua Augusta', '1500', 'Apto 32', 'Centro', 5.00, 'entregue', 'online', 'pix', null),
    (v_user_id, pg_temp.sid('ped_ret_pronto'), 'Hugo Martins', '11988880008',
      'Retirada no balcão', null, null, 'Centro', 0, 'aguardando', 'online', 'pix', null),
    (v_user_id, pg_temp.sid('ped_hist_1'), 'Bruno Lima', '11988880002',
      'Av. Paulista', '900', 'Conjunto 12', 'Bela Vista', 7.00, 'entregue', 'manual', 'pix', null),
    (v_user_id, pg_temp.sid('ped_hist_2'), 'Gabriela Rocha', '11988880007',
      'Rua das Flores', '12', 'Fundos', 'Centro', 5.00, 'entregue', 'whatsapp', 'dinheiro', 50);

  INSERT INTO public.cliente_pedidos (cliente_id, pedido_id, criado_em)
  SELECT c.id, p.id, p.criado_em
  FROM (VALUES
    ('cli_ana', 'ped_del_entregue'),
    ('cli_bruno', 'ped_hist_1'),
    ('cli_carla', 'ped_del_saiu'),
    ('cli_diego', 'ped_del_preparo'),
    ('cli_elena', 'ped_del_pendente'),
    ('cli_gabi', 'ped_hist_2'),
    ('cli_hugo', 'ped_ret_pronto')
  ) AS x(ck, pk)
  JOIN seed_demo_ids ca ON ca.k = x.ck
  JOIN seed_demo_ids pa ON pa.k = x.pk
  JOIN public.clientes c ON c.id = ca.id
  JOIN public.pedidos p ON p.id = pa.id;

  -- Histórico extra para o programa de fidelidade aparecer "vivo" na demo
  DECLARE
    v_extra_pedido uuid;
    i integer;
  BEGIN
    FOR i IN 1..9 LOOP
      v_extra_pedido := gen_random_uuid();
      INSERT INTO public.pedidos (
        id, owner_id, cliente_id, tipo, tipo_entrega, status,
        subtotal, total, criado_em
      ) VALUES (
        v_extra_pedido, v_user_id, pg_temp.sid('cli_ana'), 'delivery', 'delivery', 'entregue',
        38.90, 43.90, now() - (i || ' days')::interval
      );
      INSERT INTO public.pedido_itens (owner_id, pedido_id, produto_id, quantidade, preco_unitario)
      VALUES (v_user_id, v_extra_pedido, pg_temp.sid('p_house'), 1, 38.90);
      INSERT INTO public.entregas (
        owner_id, pedido_id, cliente_nome, cliente_telefone, endereco, numero, bairro,
        taxa_entrega, status, origem, forma_pagamento
      ) VALUES (
        v_user_id, v_extra_pedido, 'Ana Souza', '11988880001', 'Rua Augusta', '1500', 'Centro',
        5.00, 'entregue', 'online', 'pix'
      );
      INSERT INTO public.cliente_pedidos (cliente_id, pedido_id, criado_em)
      VALUES (pg_temp.sid('cli_ana'), v_extra_pedido, now() - (i || ' days')::interval);
    END LOOP;

    FOR i IN 1..7 LOOP
      v_extra_pedido := gen_random_uuid();
      INSERT INTO public.pedidos (
        id, owner_id, cliente_id, tipo, tipo_entrega, status,
        subtotal, total, criado_em
      ) VALUES (
        v_extra_pedido, v_user_id, pg_temp.sid('cli_bruno'), 'delivery', 'delivery', 'entregue',
        32.90, 42.90, now() - ((i + 3) || ' days')::interval
      );
      INSERT INTO public.pedido_itens (owner_id, pedido_id, produto_id, quantidade, preco_unitario)
      VALUES (v_user_id, v_extra_pedido, pg_temp.sid('p_cheese'), 1, 32.90);
      INSERT INTO public.entregas (
        owner_id, pedido_id, cliente_nome, cliente_telefone, endereco, numero, bairro,
        taxa_entrega, status, origem, forma_pagamento
      ) VALUES (
        v_user_id, v_extra_pedido, 'Bruno Lima', '11988880002', 'Av. Paulista', '900', 'Bela Vista',
        10.00, 'entregue', 'online', 'cartao'
      );
      INSERT INTO public.cliente_pedidos (cliente_id, pedido_id, criado_em)
      VALUES (pg_temp.sid('cli_bruno'), v_extra_pedido, now() - ((i + 3) || ' days')::interval);
    END LOOP;

    FOR i IN 1..5 LOOP
      v_extra_pedido := gen_random_uuid();
      INSERT INTO public.pedidos (
        id, owner_id, cliente_id, tipo, tipo_entrega, status,
        subtotal, total, criado_em
      ) VALUES (
        v_extra_pedido, v_user_id, pg_temp.sid('cli_gabi'), 'delivery', 'delivery', 'entregue',
        16.90, 21.90, now() - ((i + 8) || ' days')::interval
      );
      INSERT INTO public.pedido_itens (owner_id, pedido_id, produto_id, quantidade, preco_unitario)
      VALUES (v_user_id, v_extra_pedido, pg_temp.sid('p_shake_choco'), 1, 16.90);
      INSERT INTO public.entregas (
        owner_id, pedido_id, cliente_nome, cliente_telefone, endereco, numero, bairro,
        taxa_entrega, status, origem, forma_pagamento
      ) VALUES (
        v_user_id, v_extra_pedido, 'Gabriela Rocha', '11988880007', 'Rua das Flores', '12', 'Centro',
        5.00, 'entregue', 'online', 'pix'
      );
      INSERT INTO public.cliente_pedidos (cliente_id, pedido_id, criado_em)
      VALUES (pg_temp.sid('cli_gabi'), v_extra_pedido, now() - ((i + 8) || ' days')::interval);
    END LOOP;
  END;

  PERFORM public.refresh_cliente_totals(id)
  FROM public.clientes
  WHERE owner_id = v_user_id;

  INSERT INTO public.caixas (
    id, owner_id, status, valor_inicial, observacoes, aberto_em
  ) VALUES (
    pg_temp.sid('caixa_aberto'), v_user_id, 'aberto', 150.00,
    'Caixa de demonstração — turno da noite', now() - interval '3 hours'
  );

  INSERT INTO public.caixa_movimentacoes (caixa_id, owner_id, tipo, valor, descricao, criado_em) VALUES
    (pg_temp.sid('caixa_aberto'), v_user_id, 'suprimento', 50.00, 'Troco extra para o delivery', now() - interval '2 hours'),
    (pg_temp.sid('caixa_aberto'), v_user_id, 'retirada', 30.00, 'Sangria para o cofre', now() - interval '40 minutes');

  -- ---------------------------------------------------------------------------
  -- 9) Financeiro
  -- ---------------------------------------------------------------------------
  INSERT INTO public.fornecedores (id, owner_id, nome, cnpj, telefone, email, contato_responsavel, ativo) VALUES
    (pg_temp.sid('forn_frigo'), v_user_id, 'Frigorífico Central', NULL,
      '1133334444', 'vendas@frigo-central.com', 'Marcos', true),
    (pg_temp.sid('forn_bebidas'), v_user_id, 'Distribuidora Gelada', NULL,
      '1133335555', 'pedidos@gelada.com', 'Patrícia', true),
    (pg_temp.sid('forn_embalagens'), v_user_id, 'Embalagens Plus', NULL,
      '1133336666', 'contato@embaplus.com', 'Ricardo', true);

  INSERT INTO public.categorias_compra (id, owner_id, nome, tipo, cor) VALUES
    (pg_temp.sid('cc_carne'), v_user_id, 'Carnes', 'ingrediente', '#DC2626'),
    (pg_temp.sid('cc_pao'), v_user_id, 'Pães', 'ingrediente', '#D97706'),
    (pg_temp.sid('cc_embalagem'), v_user_id, 'Embalagens', 'embalagem', '#2563EB'),
    (pg_temp.sid('cc_bebida'), v_user_id, 'Bebidas', 'ingrediente', '#16A34A');

  INSERT INTO public.compras (
    owner_id, fornecedor_id, categoria_compra_id, descricao, valor_total,
    data_compra, data_vencimento, status_pagamento, forma_pagamento, nota_fiscal
  ) VALUES
    (v_user_id, pg_temp.sid('forn_frigo'), pg_temp.sid('cc_carne'),
      'Blend smash 20 kg + costela 8 kg', 1280.00, CURRENT_DATE - 2, null, 'pago', 'pix', 'NF-10482'),
    (v_user_id, pg_temp.sid('forn_bebidas'), pg_temp.sid('cc_bebida'),
      'Refrigerantes e cervejas da semana', 640.00, CURRENT_DATE - 1, CURRENT_DATE + 7, 'pendente', 'boleto', 'NF-2211'),
    (v_user_id, pg_temp.sid('forn_embalagens'), pg_temp.sid('cc_embalagem'),
      'Embalagens delivery (500 un.)', 310.00, CURRENT_DATE - 10, CURRENT_DATE - 2, 'vencido', 'boleto', 'NF-778');

  INSERT INTO public.contas_pagar (
    owner_id, descricao, valor, data_vencimento, status,
    recorrente_mensal, dia_vencimento, observacoes
  ) VALUES
    (v_user_id, 'Aluguel do ponto', 4200.00,
      date_trunc('month', CURRENT_DATE)::date + 9, 'pendente',
      true, 10, 'Conta fixa mensal'),
    (v_user_id, 'Energia elétrica', 890.00,
      date_trunc('month', CURRENT_DATE)::date + 14, 'pendente',
      true, 15, 'Conta de luz'),
    (v_user_id, 'Internet e POS', 189.90,
      date_trunc('month', CURRENT_DATE)::date + 4, 'pago',
      true, 5, 'Já pago este mês');

  UPDATE public.contas_pagar
  SET data_pagamento = CURRENT_DATE - 3
  WHERE owner_id = v_user_id AND descricao = 'Internet e POS';

  RAISE NOTICE '================================================';
  RAISE NOTICE 'Conta demo criada com sucesso.';
  RAISE NOTICE 'E-mail: %', v_email;
  RAISE NOTICE 'Senha:  %', v_password;
  RAISE NOTICE 'Cardápio: https://easyfoodhub.com.br/%/cardapio', v_referencia;
  RAISE NOTICE 'Owner ID: %', v_user_id;
  RAISE NOTICE '================================================';
END $$;
