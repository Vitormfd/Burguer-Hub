-- Agente de prospecção comercial do Easy Food Hub (nível plataforma, não por loja).
--
-- Descoberta e qualificação rodam sozinhas (Edge Function prospeccao-agente, chamada pelo
-- pg_cron a cada 5 minutos e só trabalhando dentro da agenda configurada). O primeiro
-- contato é ASSISTIDO: o operador revisa a mensagem pronta e envia com um clique.
-- Respostas no WhatsApp comercial são atendidas pela IA (Edge Function prospeccao-whatsapp).
--
-- Só usuários em prospeccao_admins enxergam ou alteram qualquer tabela daqui.
-- Pode rodar de novo sem estragar nada.

CREATE TABLE IF NOT EXISTS public.prospeccao_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_prospeccao_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.prospeccao_admins WHERE user_id = auth.uid());
$fn$;

GRANT EXECUTE ON FUNCTION public.is_prospeccao_admin() TO authenticated;

-- Configuração única (id = 1) --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospeccao_config (
  id integer PRIMARY KEY DEFAULT 1,
  ativo boolean NOT NULL DEFAULT false,
  dias_semana integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  hora_inicio time NOT NULL DEFAULT '09:00',
  hora_fim time NOT NULL DEFAULT '18:00',
  fuso text NOT NULL DEFAULT 'America/Sao_Paulo',
  minutos_diarios integer NOT NULL DEFAULT 120,
  meta_qualificados_dia integer NOT NULL DEFAULT 20,
  meta_contatos_dia integer NOT NULL DEFAULT 15,
  especialidades text[] NOT NULL DEFAULT '{hamburgueria,pizzaria,lanchonete,açaiteria,marmitaria,pastelaria,restaurante,espetinho,sorveteria}',
  estados text[] NOT NULL DEFAULT '{}',
  cidades text[] NOT NULL DEFAULT '{}',
  peso_anota_ai integer NOT NULL DEFAULT 60,
  peso_sem_sistema integer NOT NULL DEFAULT 40,
  pontuacao_minima integer NOT NULL DEFAULT 45,
  limite_gasto_diario_usd numeric(10,2) NOT NULL DEFAULT 3,
  limite_gasto_mensal_usd numeric(10,2) NOT NULL DEFAULT 50,
  limite_buscas_web_dia integer NOT NULL DEFAULT 60,
  limite_places_dia integer NOT NULL DEFAULT 30,
  limite_respostas_ia_dia integer NOT NULL DEFAULT 200,
  cotacao_dolar numeric(10,2) NOT NULL DEFAULT 5.50,
  -- Oferta comercial: o agente só fala o que estiver aqui.
  preco_mensal numeric(10,2) NOT NULL DEFAULT 199,
  teste_gratis_dias integer NOT NULL DEFAULT 0,
  bot_whatsapp text NOT NULL DEFAULT 'consultar',
  link_cadastro text NOT NULL DEFAULT 'https://www.easyfoodhub.com.br/auth',
  link_demo text NOT NULL DEFAULT '',
  nome_remetente text NOT NULL DEFAULT '',
  -- WhatsApp comercial (instância própria na Evolution, separada das lojas).
  evolution_instance text NOT NULL DEFAULT 'efh-prospeccao',
  responder_automatico boolean NOT NULL DEFAULT true,
  telefone_alertas text NOT NULL DEFAULT '',
  -- Estado do agente (escrito pela Edge Function).
  estado text NOT NULL DEFAULT 'pausado',
  ultima_execucao_em timestamptz,
  proxima_execucao_em timestamptz,
  ultimo_erro text,
  ultimo_erro_em timestamptz,
  ultimo_alerta_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospeccao_config_unica CHECK (id = 1),
  CONSTRAINT prospeccao_config_bot_check CHECK (bot_whatsapp IN ('incluso', 'nao_incluso', 'consultar')),
  CONSTRAINT prospeccao_config_minutos_check CHECK (minutos_diarios BETWEEN 5 AND 1440),
  CONSTRAINT prospeccao_config_teste_check CHECK (teste_gratis_dias BETWEEN 0 AND 90),
  CONSTRAINT prospeccao_config_pesos_check CHECK (peso_anota_ai BETWEEN 0 AND 100 AND peso_sem_sistema BETWEEN 0 AND 100)
);

INSERT INTO public.prospeccao_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Estabelecimentos ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text,
  instagram text,
  facebook text,
  site text,
  telefone text,
  email text,
  cidade text,
  uf text,
  bairro text,
  link_cardapio text,
  google_place_id text,
  sistema text NOT NULL DEFAULT 'indeterminado',
  sistema_confianca text NOT NULL DEFAULT 'baixa',
  evidencias jsonb NOT NULL DEFAULT '[]',
  sinais jsonb NOT NULL DEFAULT '{}',
  pontuacao integer NOT NULL DEFAULT 0,
  pontuacao_detalhes jsonb NOT NULL DEFAULT '{}',
  prioridade text NOT NULL DEFAULT 'baixa',
  publico text,
  status text NOT NULL DEFAULT 'novo',
  canal_contato text,
  interesse text NOT NULL DEFAULT 'nenhum',
  proxima_acao text,
  proxima_acao_em timestamptz,
  resumo_conversa text,
  observacoes text,
  motivo_desqualificacao text,
  mensagem_sugerida text,
  mensagem_gerada_em timestamptz,
  valor_concorrente numeric(10,2),
  bloqueado boolean NOT NULL DEFAULT false,
  atendimento_humano boolean NOT NULL DEFAULT false,
  followups integer NOT NULL DEFAULT 0,
  fonte text,
  consulta_origem text,
  descoberto_em timestamptz NOT NULL DEFAULT now(),
  verificado_em timestamptz NOT NULL DEFAULT now(),
  contatado_em timestamptz,
  respondeu_em timestamptz,
  convertido_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospects_sistema_check CHECK (sistema IN ('sem_sistema', 'anota_ai', 'concorrente', 'sistema_proprio', 'indeterminado')),
  CONSTRAINT prospects_confianca_check CHECK (sistema_confianca IN ('alta', 'media', 'baixa')),
  CONSTRAINT prospects_prioridade_check CHECK (prioridade IN ('alta', 'media', 'baixa')),
  CONSTRAINT prospects_interesse_check CHECK (interesse IN ('nenhum', 'baixo', 'medio', 'alto')),
  CONSTRAINT prospects_status_check CHECK (status IN (
    'novo', 'qualificado', 'contatado', 'respondeu', 'interessado', 'demonstracao',
    'cliente', 'sem_interesse', 'nao_contatar', 'desqualificado'
  ))
);

CREATE INDEX IF NOT EXISTS idx_prospects_status ON public.prospects (status, pontuacao DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_local ON public.prospects (uf, cidade);
CREATE INDEX IF NOT EXISTS idx_prospects_descoberto ON public.prospects (descoberto_em DESC);

-- Identificadores para deduplicação (telefone, @instagram, facebook, domínio, place id, nome+cidade).
CREATE TABLE IF NOT EXISTS public.prospect_identificadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  valor text NOT NULL,
  CONSTRAINT prospect_identificadores_unico UNIQUE (tipo, valor)
);
CREATE INDEX IF NOT EXISTS idx_prospect_ident_prospect ON public.prospect_identificadores (prospect_id);

-- Histórico de mensagens (enviadas e recebidas).
CREATE TABLE IF NOT EXISTS public.prospect_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  direcao text NOT NULL,
  canal text NOT NULL DEFAULT 'whatsapp',
  autor text NOT NULL,
  texto text NOT NULL DEFAULT '',
  intencao text,
  external_id text,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospect_mensagens_direcao_check CHECK (direcao IN ('saida', 'entrada')),
  CONSTRAINT prospect_mensagens_autor_check CHECK (autor IN ('agente', 'operador', 'prospect', 'sistema'))
);
CREATE INDEX IF NOT EXISTS idx_prospect_mensagens_prospect ON public.prospect_mensagens (prospect_id, criado_em);
CREATE INDEX IF NOT EXISTS idx_prospect_mensagens_data ON public.prospect_mensagens (criado_em DESC);

-- Histórico de pesquisas (evita repetir a mesma busca).
CREATE TABLE IF NOT EXISTS public.prospeccao_buscas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  consulta text NOT NULL,
  especialidade text,
  cidade text,
  uf text,
  publico text,
  fonte text NOT NULL,
  executada_em timestamptz NOT NULL DEFAULT now(),
  encontrados integer NOT NULL DEFAULT 0,
  novos integer NOT NULL DEFAULT 0,
  custo_usd numeric(10,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prospeccao_buscas_data ON public.prospeccao_buscas (executada_em DESC);

-- Execuções e logs (custo, erros, o que foi feito).
CREATE TABLE IF NOT EXISTS public.prospeccao_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  status text NOT NULL DEFAULT 'rodando',
  motivo text,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  finalizada_em timestamptz,
  duracao_ms integer NOT NULL DEFAULT 0,
  consulta text,
  encontrados integer NOT NULL DEFAULT 0,
  novos integer NOT NULL DEFAULT 0,
  qualificados integer NOT NULL DEFAULT 0,
  tokens_entrada integer NOT NULL DEFAULT 0,
  tokens_saida integer NOT NULL DEFAULT 0,
  buscas_web integer NOT NULL DEFAULT 0,
  chamadas_places integer NOT NULL DEFAULT 0,
  custo_usd numeric(10,4) NOT NULL DEFAULT 0,
  erro text,
  detalhes jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT prospeccao_execucoes_status_check CHECK (status IN ('rodando', 'ok', 'erro', 'pulada'))
);
CREATE INDEX IF NOT EXISTS idx_prospeccao_execucoes_data ON public.prospeccao_execucoes (iniciada_em DESC);

-- Municípios do IBGE (cauda longa de cidades do interior; carregado sob demanda).
CREATE TABLE IF NOT EXISTS public.prospeccao_municipios (
  uf text NOT NULL,
  nome text NOT NULL,
  PRIMARY KEY (uf, nome)
);

-- RLS: só admins da prospecção -----------------------------------------------------------------
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'prospeccao_admins', 'prospeccao_config', 'prospects', 'prospect_identificadores',
    'prospect_mensagens', 'prospeccao_buscas', 'prospeccao_execucoes', 'prospeccao_municipios'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_prospeccao_admin()) WITH CHECK (public.is_prospeccao_admin())',
      t || '_admin_all', t
    );
  END LOOP;
END;
$rls$;

-- Métricas do painel (sempre a partir dos registros reais) --------------------------------------
CREATE OR REPLACE FUNCTION public.prospeccao_metricas()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r jsonb;
  v_contatados integer;
  v_responderam integer;
  v_clientes integer;
  v_custo numeric;
BEGIN
  IF NOT public.is_prospeccao_admin() THEN
    RAISE EXCEPTION 'não autorizado';
  END IF;

  SELECT count(*) FILTER (WHERE contatado_em IS NOT NULL),
         count(*) FILTER (WHERE respondeu_em IS NOT NULL),
         count(*) FILTER (WHERE status = 'cliente')
    INTO v_contatados, v_responderam, v_clientes
    FROM prospects;

  SELECT COALESCE(sum(custo_usd), 0) INTO v_custo FROM prospeccao_execucoes;

  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM prospects),
    'qualificados', (SELECT count(*) FROM prospects WHERE status NOT IN ('novo', 'desqualificado')),
    'anota_ai', (SELECT count(*) FROM prospects WHERE sistema = 'anota_ai'),
    'sem_sistema', (SELECT count(*) FROM prospects WHERE sistema = 'sem_sistema'),
    'aguardando_contato', (SELECT count(*) FROM prospects WHERE status = 'qualificado' AND NOT bloqueado AND contatado_em IS NULL),
    'contatados', v_contatados,
    'responderam', v_responderam,
    'interessados', (SELECT count(*) FROM prospects WHERE status IN ('interessado', 'demonstracao', 'cliente')),
    'demonstracoes', (SELECT count(*) FROM prospects WHERE status = 'demonstracao'),
    'clientes', v_clientes,
    'precisam_humano', (SELECT count(*) FROM prospects WHERE atendimento_humano AND status NOT IN ('cliente', 'sem_interesse', 'nao_contatar')),
    'taxa_resposta', CASE WHEN v_contatados > 0 THEN round(v_responderam::numeric * 100 / v_contatados, 1) END,
    'taxa_conversao', CASE WHEN v_contatados > 0 THEN round(v_clientes::numeric * 100 / v_contatados, 1) END,
    'custo_total_usd', round(v_custo, 2),
    'custo_por_prospect_usd', CASE WHEN (SELECT count(*) FROM prospects) > 0 THEN round(v_custo / (SELECT count(*) FROM prospects), 3) END,
    'custo_por_cliente_usd', CASE WHEN v_clientes > 0 THEN round(v_custo / v_clientes, 2) END,
    'custo_hoje_usd', (SELECT round(COALESCE(sum(custo_usd), 0), 2) FROM prospeccao_execucoes
                       WHERE iniciada_em >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
    'por_segmento', (SELECT COALESCE(jsonb_object_agg(k, n), '{}') FROM (
        SELECT COALESCE(categoria, 'sem categoria') k, count(*) n FROM prospects GROUP BY 1 ORDER BY 2 DESC LIMIT 15) s),
    'por_estado', (SELECT COALESCE(jsonb_object_agg(k, n), '{}') FROM (
        SELECT COALESCE(uf, '??') k, count(*) n FROM prospects GROUP BY 1 ORDER BY 2 DESC) s),
    'por_cidade', (SELECT COALESCE(jsonb_object_agg(k, n), '{}') FROM (
        SELECT COALESCE(cidade, '?') || ' - ' || COALESCE(uf, '??') k, count(*) n FROM prospects GROUP BY 1 ORDER BY 2 DESC LIMIT 15) s),
    'por_sistema', (SELECT COALESCE(jsonb_object_agg(sistema, n), '{}') FROM (
        SELECT sistema, count(*) n FROM prospects GROUP BY 1) s),
    'motivos_rejeicao', (SELECT COALESCE(jsonb_object_agg(k, n), '{}') FROM (
        SELECT COALESCE(motivo_desqualificacao, status) k, count(*) n FROM prospects
        WHERE status IN ('desqualificado', 'sem_interesse', 'nao_contatar') GROUP BY 1 ORDER BY 2 DESC LIMIT 12) s)
  ) INTO r;
  RETURN r;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.prospeccao_metricas() TO authenticated;

-- Cron a cada 5 minutos. A Edge Function decide se está dentro da agenda configurada,
-- então trocar dias/horários no painel não exige mexer aqui.
-- Requer no Vault: project_url (já existe do marketing) e prospeccao_cron_secret.
DO $cron$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prospeccao_agente_tick';
  PERFORM cron.schedule(
    'prospeccao_agente_tick',
    '*/5 * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/prospeccao-agente',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'prospeccao_cron_secret')
        ),
        body := '{"acao":"tick"}'::jsonb,
        timeout_milliseconds := 5000
      )
      WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
        AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'prospeccao_cron_secret');
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron da prospecção não agendado (%). Use "Executar agora" no painel.', SQLERRM;
END;
$cron$;
