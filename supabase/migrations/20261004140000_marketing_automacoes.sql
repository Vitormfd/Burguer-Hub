-- Marketing automático no WhatsApp: reativação de clientes sumidos e incentivo à
-- segunda compra, com medição de retorno (pedidos e faturamento gerados).
-- Os envios são feitos pela Edge Function marketing-automacoes (cron diário ou
-- botão "Executar agora"). Toda automação nasce DESLIGADA.

-- Chave de telefone BR: 11 dígitos locais (DDD + 9 + número), para casar formatos diferentes.
CREATE OR REPLACE FUNCTION public.phone_key_br(phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  WITH d AS (SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') AS v),
  s AS (SELECT CASE WHEN v LIKE '55%' AND length(v) > 11 THEN substring(v from 3) ELSE v END AS v FROM d)
  SELECT CASE WHEN length(v) = 10 THEN substring(v from 1 for 2) || '9' || substring(v from 3) ELSE v END FROM s;
$fn$;

CREATE TABLE IF NOT EXISTS public.marketing_automacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  ativo boolean NOT NULL DEFAULT false,
  dias integer NOT NULL DEFAULT 30,
  mensagem text NOT NULL DEFAULT '',
  cupom_id uuid REFERENCES public.cupons(id) ON DELETE SET NULL,
  janela_conversao_dias integer NOT NULL DEFAULT 7,
  max_envios_dia integer NOT NULL DEFAULT 30,
  ultima_execucao_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_automacoes_tipo_check CHECK (tipo IN ('reativacao', 'segunda_compra')),
  CONSTRAINT marketing_automacoes_dias_check CHECK (dias BETWEEN 1 AND 365),
  CONSTRAINT marketing_automacoes_janela_check CHECK (janela_conversao_dias BETWEEN 1 AND 30),
  CONSTRAINT marketing_automacoes_max_check CHECK (max_envios_dia BETWEEN 1 AND 200),
  CONSTRAINT marketing_automacoes_unica UNIQUE (owner_id, tipo)
);

CREATE TABLE IF NOT EXISTS public.marketing_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  automacao_tipo text NOT NULL,
  telefone text NOT NULL,
  telefone_key text NOT NULL,
  cliente_nome text,
  mensagem text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'enviado',
  erro text,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_envios_status_check CHECK (status IN ('enviado', 'erro'))
);

CREATE INDEX IF NOT EXISTS idx_marketing_envios_owner_data ON public.marketing_envios (owner_id, enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_envios_owner_phone ON public.marketing_envios (owner_id, telefone_key, enviado_em DESC);

ALTER TABLE public.marketing_automacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_automacoes_owner_all" ON public.marketing_automacoes;
CREATE POLICY "marketing_automacoes_owner_all" ON public.marketing_automacoes FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "marketing_envios_owner_select" ON public.marketing_envios;
CREATE POLICY "marketing_envios_owner_select" ON public.marketing_envios FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- Clientes elegíveis para uma automação (usado só pela Edge Function, com service role).
CREATE OR REPLACE FUNCTION public.marketing_candidatos(p_owner uuid, p_tipo text, p_dias integer, p_limite integer)
RETURNS TABLE (telefone text, telefone_key text, cliente_nome text, ultimo_pedido timestamptz, total_pedidos bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH pedidos_cliente AS (
    SELECT public.phone_key_br(e.cliente_telefone) AS k,
           e.cliente_telefone AS tel,
           e.cliente_nome AS nome,
           p.criado_em
    FROM public.entregas e
    JOIN public.pedidos p ON p.id = e.pedido_id
    WHERE p.owner_id = p_owner
      AND p.status::text <> 'cancelado'
      AND COALESCE(e.cliente_telefone, '') <> ''
  ),
  agregados AS (
    SELECT k,
           (array_agg(tel ORDER BY criado_em DESC))[1] AS tel,
           (array_agg(nome ORDER BY criado_em DESC))[1] AS nome,
           MAX(criado_em) AS ultimo,
           MIN(criado_em) AS primeiro,
           COUNT(*) AS total
    FROM pedidos_cliente
    WHERE length(k) = 11
    GROUP BY k
  )
  SELECT a.tel, a.k, a.nome, a.ultimo, a.total
  FROM agregados a
  WHERE (
      (p_tipo = 'reativacao'
        AND a.ultimo <= now() - make_interval(days => p_dias)
        AND a.ultimo >= now() - make_interval(days => p_dias + 90)
        AND NOT EXISTS (
          SELECT 1 FROM public.marketing_envios m
          WHERE m.owner_id = p_owner AND m.telefone_key = a.k
            AND m.automacao_tipo = 'reativacao' AND m.enviado_em >= a.ultimo
        ))
      OR
      (p_tipo = 'segunda_compra'
        AND a.total = 1
        AND a.primeiro <= now() - make_interval(days => p_dias)
        AND a.primeiro >= now() - make_interval(days => p_dias + 7)
        AND NOT EXISTS (
          SELECT 1 FROM public.marketing_envios m
          WHERE m.owner_id = p_owner AND m.telefone_key = a.k AND m.automacao_tipo = 'segunda_compra'
        ))
    )
    -- Anti-spam: no máximo uma mensagem de marketing por cliente a cada 7 dias.
    AND NOT EXISTS (
      SELECT 1 FROM public.marketing_envios m
      WHERE m.owner_id = p_owner AND m.telefone_key = a.k AND m.enviado_em >= now() - interval '7 days'
    )
  ORDER BY a.ultimo DESC
  LIMIT GREATEST(COALESCE(p_limite, 0), 0);
$fn$;

REVOKE ALL ON FUNCTION public.marketing_candidatos(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_candidatos(uuid, text, integer, integer) TO service_role;

-- Resultado das automações: envios, clientes que voltaram a pedir dentro da janela e faturamento.
CREATE OR REPLACE FUNCTION public.relatorio_marketing(p_ini timestamptz, p_fim timestamptz)
RETURNS TABLE (automacao_tipo text, envios bigint, erros bigint, convertidos bigint, pedidos bigint, faturamento numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH envios AS (
    SELECT m.id, m.automacao_tipo, m.telefone_key, m.enviado_em, m.status,
           COALESCE(a.janela_conversao_dias, 7) AS janela
    FROM public.marketing_envios m
    LEFT JOIN public.marketing_automacoes a ON a.owner_id = m.owner_id AND a.tipo = m.automacao_tipo
    WHERE m.owner_id = auth.uid()
      AND m.enviado_em >= p_ini
      AND m.enviado_em <= p_fim
  ),
  conversoes AS (
    SELECT en.id AS envio_id, p.id AS pedido_id, p.total
    FROM envios en
    JOIN public.entregas e ON public.phone_key_br(e.cliente_telefone) = en.telefone_key
    JOIN public.pedidos p ON p.id = e.pedido_id
    WHERE en.status = 'enviado'
      AND p.owner_id = auth.uid()
      AND p.status::text <> 'cancelado'
      AND p.criado_em > en.enviado_em
      AND p.criado_em <= en.enviado_em + make_interval(days => en.janela)
  ),
  -- Cada pedido conta uma vez por automação, mesmo que caia na janela de dois envios.
  pedidos_tipo AS (
    SELECT en.automacao_tipo, c.pedido_id, MAX(c.total) AS total
    FROM conversoes c
    JOIN envios en ON en.id = c.envio_id
    GROUP BY en.automacao_tipo, c.pedido_id
  )
  SELECT en.automacao_tipo,
         COUNT(*) FILTER (WHERE en.status = 'enviado') AS envios,
         COUNT(*) FILTER (WHERE en.status = 'erro') AS erros,
         COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM conversoes c WHERE c.envio_id = en.id)) AS convertidos,
         (SELECT COUNT(*) FROM pedidos_tipo pt WHERE pt.automacao_tipo = en.automacao_tipo) AS pedidos,
         COALESCE((SELECT SUM(pt.total) FROM pedidos_tipo pt WHERE pt.automacao_tipo = en.automacao_tipo), 0) AS faturamento
  FROM envios en
  GROUP BY en.automacao_tipo;
$fn$;

REVOKE ALL ON FUNCTION public.relatorio_marketing(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_marketing(timestamptz, timestamptz) TO authenticated;

-- Cron de hora em hora, das 10h às 20h de Brasília (13h-23h UTC). Cada execução envia
-- poucas mensagens por loja (com intervalo entre elas) até o limite diário da automação.
-- Requer dois segredos no Vault do Supabase:
--   select vault.create_secret('https://<projeto>.supabase.co', 'project_url');
--   select vault.create_secret('<mesmo valor de MARKETING_CRON_SECRET>', 'marketing_cron_secret');
-- Sem eles, o job simplesmente não faz nada (e o botão "Executar agora" continua funcionando).
DO $cron$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'marketing_automacoes_horario';
  PERFORM cron.schedule(
    'marketing_automacoes_horario',
    '0 13-23 * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/marketing-automacoes',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'marketing_cron_secret')
        ),
        body := '{}'::jsonb
      )
      WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
        AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'marketing_cron_secret');
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron de marketing não agendado (%). Use o botão "Executar agora" ou agende manualmente.', SQLERRM;
END;
$cron$;
