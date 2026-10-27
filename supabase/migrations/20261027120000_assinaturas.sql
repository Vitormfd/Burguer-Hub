-- Assinatura do Easy Food Hub (Stripe) e modo demonstração.
--
-- Conta sem assinatura ativa (ou sem liberação manual) entra em modo demonstração:
-- navega por tudo e pode montar a loja (cardápio, mesas, configurações), mas não opera:
-- pedidos e abertura de mesas são recusados aqui no banco, qualquer que seja o caminho
-- (app, cardápio público, Pix, robô do WhatsApp). WhatsApp, IA e marketing são
-- bloqueados nas Edge Functions com a mesma regra (conta_liberada).
--
-- Pode rodar mais de uma vez.

CREATE TABLE IF NOT EXISTS public.assinaturas (
  owner_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  -- Status da assinatura na Stripe: active, trialing, past_due, canceled, unpaid, incomplete...
  stripe_status text,
  periodo_fim timestamptz,
  cancela_no_fim boolean NOT NULL DEFAULT false,
  email_pagamento text,
  -- Liberação feita à mão pelo administrador (clientes antigos, pagamento por fora, cortesia).
  liberado_manual boolean NOT NULL DEFAULT false,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assinaturas_leitura ON public.assinaturas;
CREATE POLICY assinaturas_leitura ON public.assinaturas
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_prospeccao_admin());
-- Escrita: só o webhook da Stripe (service role) e o administrador, pela função abaixo.

-- Eventos recebidos da Stripe: evita processar o mesmo evento duas vezes e guarda
-- pagamentos que não acharam conta (ex.: e-mail diferente do cadastro).
CREATE TABLE IF NOT EXISTS public.stripe_eventos (
  id text PRIMARY KEY,
  tipo text NOT NULL,
  owner_id uuid,
  email text,
  processado boolean NOT NULL DEFAULT false,
  erro text,
  payload jsonb NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stripe_eventos_admin ON public.stripe_eventos;
CREATE POLICY stripe_eventos_admin ON public.stripe_eventos
  FOR SELECT TO authenticated
  USING (public.is_prospeccao_admin());

-- past_due continua liberada: a Stripe ainda está tentando cobrar o cartão.
CREATE OR REPLACE FUNCTION public.conta_liberada(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT a.liberado_manual OR COALESCE(a.stripe_status IN ('active', 'trialing', 'past_due'), false)
       FROM public.assinaturas a
      WHERE a.owner_id = p_owner),
    false
  );
$fn$;
REVOKE ALL ON FUNCTION public.conta_liberada(uuid) FROM public;
-- O cardápio público (anon) precisa saber se a loja recebe pedidos.
GRANT EXECUTE ON FUNCTION public.conta_liberada(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exigir_assinatura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.owner_id IS NOT NULL AND NOT public.conta_liberada(NEW.owner_id) THEN
    RAISE EXCEPTION 'Assinatura inativa: assine o Easy Food Hub para registrar pedidos e abrir mesas.'
      USING ERRCODE = 'P0001', HINT = 'efh_assinatura';
  END IF;
  RETURN NEW;
END;
$fn$;

-- "zz_" garante que roda depois dos triggers que preenchem owner_id (ordem alfabética).
DROP TRIGGER IF EXISTS zz_pedidos_exige_assinatura ON public.pedidos;
CREATE TRIGGER zz_pedidos_exige_assinatura
  BEFORE INSERT ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.exigir_assinatura();

DROP TRIGGER IF EXISTS zz_contas_exige_assinatura ON public.contas;
CREATE TRIGGER zz_contas_exige_assinatura
  BEFORE INSERT ON public.contas
  FOR EACH ROW EXECUTE FUNCTION public.exigir_assinatura();

-- Contas que já existiam antes da cobrança continuam operando. O administrador revisa
-- e bloqueia quem não é cliente na tela Assinaturas.
INSERT INTO public.assinaturas (owner_id, liberado_manual, observacao)
SELECT p.id, true, 'Conta existente antes da cobrança (27/10/2026). Revise se é cliente.'
  FROM public.profiles p
ON CONFLICT (owner_id) DO NOTHING;

-- Situação da conta logada (banner do modo demonstração).
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
    'cancela_no_fim', COALESCE(a.cancela_no_fim, false)
  )
  FROM (SELECT 1) x
  LEFT JOIN public.assinaturas a ON a.owner_id = auth.uid();
$fn$;
GRANT EXECUTE ON FUNCTION public.minha_assinatura() TO authenticated;

-- Lista de contas para o administrador (vazia para quem não é admin).
CREATE OR REPLACE FUNCTION public.admin_assinaturas()
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
  observacao text
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
         a.observacao
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.configuracoes c ON c.owner_id = p.id
    LEFT JOIN public.assinaturas a ON a.owner_id = p.id
   WHERE public.is_prospeccao_admin()
   ORDER BY p.created_at DESC;
$fn$;
GRANT EXECUTE ON FUNCTION public.admin_assinaturas() TO authenticated;

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
        atualizado_em = now();
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.admin_definir_liberacao(uuid, boolean, text) TO authenticated;

-- Webhook da Stripe: acha a conta pelo e-mail quando o pagamento veio sem client_reference_id.
CREATE OR REPLACE FUNCTION public.owner_por_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT u.id FROM auth.users u
   JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.owner_por_email(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_por_email(text) TO service_role;
