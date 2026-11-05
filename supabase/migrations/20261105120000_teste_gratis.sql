-- Teste grátis de 7 dias, sem cartão, para contas novas.
--
-- Durante o teste a conta opera de verdade: pedidos, mesas, cardápio público e Pix.
-- WhatsApp, robô, IA e marketing ficam de fora (custo e risco de bloqueio do número), a
-- menos que o administrador libere para aquela conta (teste_whatsapp).
--
-- O vencimento não depende de rotina agendada: conta_liberada compara teste_ate com a
-- hora do banco a cada pedido. Contas que já existem não mudam: esta migration não dá
-- teste a ninguém que já tenha perfil.
--
-- Requer 20261027120000_assinaturas.sql. Não rode aquela de novo depois desta: ela
-- recriaria conta_liberada sem o teste e liberaria à mão todas as contas sem assinatura.
--
-- Pode rodar mais de uma vez.

ALTER TABLE public.assinaturas
  ADD COLUMN IF NOT EXISTS teste_ate timestamptz,
  ADD COLUMN IF NOT EXISTS teste_whatsapp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_contato text,
  ADD COLUMN IF NOT EXISTS origem jsonb;

-- O RLS já não tem política de escrita; isto é a segunda camada. Sem o privilégio, nenhum
-- usuário grava nestas tabelas pela API, mesmo que uma política errada apareça no futuro.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.assinaturas FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stripe_eventos FROM PUBLIC, anon, authenticated;

-- past_due continua liberada: a Stripe ainda está tentando cobrar o cartão.
CREATE OR REPLACE FUNCTION public.conta_liberada(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT a.liberado_manual
            OR COALESCE(a.stripe_status IN ('active', 'trialing', 'past_due'), false)
            OR COALESCE(a.teste_ate > now(), false)
       FROM public.assinaturas a
      WHERE a.owner_id = p_owner),
    false
  );
$fn$;

-- WhatsApp, robô, IA e marketing: só quem paga, quem foi liberado à mão ou quem está em
-- teste com o WhatsApp liberado pelo administrador.
CREATE OR REPLACE FUNCTION public.conta_whatsapp_liberada(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT a.liberado_manual
            OR COALESCE(a.stripe_status IN ('active', 'trialing', 'past_due'), false)
            OR (a.teste_whatsapp AND COALESCE(a.teste_ate > now(), false))
       FROM public.assinaturas a
      WHERE a.owner_id = p_owner),
    false
  );
$fn$;
REVOKE ALL ON FUNCTION public.conta_whatsapp_liberada(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conta_whatsapp_liberada(uuid) TO service_role;

-- Toda conta nova nasce com 7 dias. A duração e o acesso nunca vêm do navegador; os dados
-- que o cadastro envia (contato e origem do anúncio) são só informação para o administrador.
CREATE OR REPLACE FUNCTION public.iniciar_teste_gratis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_criado timestamptz;
  v_meta jsonb;
  v_whatsapp text;
  v_origem jsonb;
BEGIN
  -- Falha aqui não pode derrubar o cadastro: a conta entra em demonstração.
  BEGIN
    SELECT u.created_at, COALESCE(u.raw_user_meta_data, '{}'::jsonb)
      INTO v_criado, v_meta
      FROM auth.users u
     WHERE u.id = NEW.id;

    -- Conta antiga que só agora ganhou perfil não é conta nova.
    IF v_criado IS NULL OR v_criado < now() - interval '10 minutes' THEN
      RETURN NEW;
    END IF;

    v_whatsapp := NULLIF(left(regexp_replace(COALESCE(v_meta ->> 'whatsapp', ''), '\D', '', 'g'), 15), '');

    SELECT jsonb_object_agg(chave, left(valor, 200))
      INTO v_origem
      FROM jsonb_each_text(
             CASE WHEN jsonb_typeof(v_meta -> 'origem') = 'object' THEN v_meta -> 'origem' ELSE '{}'::jsonb END
           ) AS o(chave, valor)
     WHERE chave IN ('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid');

    INSERT INTO public.assinaturas (owner_id, teste_ate, whatsapp_contato, origem)
    VALUES (NEW.id, now() + interval '7 days', v_whatsapp, v_origem)
    ON CONFLICT (owner_id) DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'iniciar_teste_gratis: falha para %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.iniciar_teste_gratis() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_inicia_teste_gratis ON public.profiles;
CREATE TRIGGER profiles_inicia_teste_gratis
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.iniciar_teste_gratis();

-- Situação da conta logada (banner e avisos do painel).
CREATE OR REPLACE FUNCTION public.minha_assinatura()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'liberada', public.conta_liberada(auth.uid()),
    'liberado_manual', COALESCE(a.liberado_manual, false),
    'status', a.stripe_status,
    'periodo_fim', a.periodo_fim,
    'cancela_no_fim', COALESCE(a.cancela_no_fim, false),
    'paga', COALESCE(a.stripe_status IN ('active', 'trialing', 'past_due'), false),
    'em_teste', COALESCE(a.teste_ate > now(), false),
    'teste_ate', a.teste_ate,
    'whatsapp_liberado', public.conta_whatsapp_liberada(auth.uid())
  )
  FROM (SELECT 1) x
  LEFT JOIN public.assinaturas a ON a.owner_id = auth.uid();
$fn$;
GRANT EXECUTE ON FUNCTION public.minha_assinatura() TO authenticated;

-- A lista ganha colunas: o tipo de retorno muda, por isso o DROP.
DROP FUNCTION IF EXISTS public.admin_assinaturas();
CREATE FUNCTION public.admin_assinaturas()
RETURNS TABLE (
  owner_id uuid,
  email text,
  nome text,
  nome_loja text,
  criado_em timestamptz,
  pedidos_30d bigint,
  liberada boolean,
  liberado_manual boolean,
  stripe_status text,
  periodo_fim timestamptz,
  observacao text,
  teste_ate timestamptz,
  teste_whatsapp boolean,
  whatsapp_contato text,
  origem jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT p.id,
         u.email::text,
         p.nome,
         c.nome_loja,
         p.created_at,
         (SELECT count(*) FROM public.pedidos pe
           WHERE pe.owner_id = p.id AND pe.criado_em > now() - interval '30 days'),
         public.conta_liberada(p.id),
         COALESCE(a.liberado_manual, false),
         a.stripe_status,
         a.periodo_fim,
         a.observacao,
         a.teste_ate,
         COALESCE(a.teste_whatsapp, false),
         a.whatsapp_contato,
         a.origem
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.configuracoes c ON c.owner_id = p.id
    LEFT JOIN public.assinaturas a ON a.owner_id = p.id
   WHERE public.is_prospeccao_admin()
   ORDER BY p.created_at DESC;
$fn$;
REVOKE ALL ON FUNCTION public.admin_assinaturas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assinaturas() TO authenticated;

-- Bloquear uma conta também encerra o teste; senão o bloqueio não valeria até o vencimento.
CREATE OR REPLACE FUNCTION public.admin_definir_liberacao(p_owner uuid, p_liberado boolean, p_observacao text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_prospeccao_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador';
  END IF;
  INSERT INTO public.assinaturas (owner_id, liberado_manual, observacao)
  VALUES (p_owner, p_liberado, p_observacao)
  ON CONFLICT (owner_id) DO UPDATE
    SET liberado_manual = EXCLUDED.liberado_manual,
        observacao = COALESCE(EXCLUDED.observacao, public.assinaturas.observacao),
        teste_ate = CASE
          WHEN NOT p_liberado AND public.assinaturas.teste_ate > now() THEN now()
          ELSE public.assinaturas.teste_ate
        END,
        teste_whatsapp = CASE WHEN p_liberado THEN public.assinaturas.teste_whatsapp ELSE false END,
        atualizado_em = now();
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.admin_definir_liberacao(uuid, boolean, text) TO authenticated;

-- Dá, renova ou encerra (0 dias) o teste de uma conta e liga o WhatsApp nele. É a única
-- forma de uma conta antiga ganhar teste: uma a uma, por decisão do administrador.
CREATE OR REPLACE FUNCTION public.admin_definir_teste(p_owner uuid, p_dias integer DEFAULT NULL, p_whatsapp boolean DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_prospeccao_admin() THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador';
  END IF;
  IF p_dias IS NOT NULL AND (p_dias < 0 OR p_dias > 30) THEN
    RAISE EXCEPTION 'O teste vai de 0 a 30 dias';
  END IF;
  INSERT INTO public.assinaturas (owner_id, teste_ate, teste_whatsapp)
  VALUES (
    p_owner,
    CASE WHEN p_dias IS NULL THEN NULL ELSE now() + make_interval(days => p_dias) END,
    COALESCE(p_whatsapp, false)
  )
  ON CONFLICT (owner_id) DO UPDATE
    SET teste_ate = CASE
          WHEN p_dias IS NULL THEN public.assinaturas.teste_ate
          ELSE now() + make_interval(days => p_dias)
        END,
        teste_whatsapp = COALESCE(p_whatsapp, public.assinaturas.teste_whatsapp),
        atualizado_em = now();
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_definir_teste(uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_definir_teste(uuid, integer, boolean) TO authenticated;
