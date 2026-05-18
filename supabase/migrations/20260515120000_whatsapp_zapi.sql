-- Z-API credentials and WhatsApp message templates in configuracoes
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS zapi_instance_id text,
  ADD COLUMN IF NOT EXISTS zapi_token text,
  ADD COLUMN IF NOT EXISTS zapi_client_token text,
  ADD COLUMN IF NOT EXISTS zapi_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_msg_confirmado text NOT NULL DEFAULT
    'Olá {{nome}}! 🍔 Seu pedido #{{pedido_id}} foi confirmado e já está na fila! Em breve começamos o preparo. 🔥',
  ADD COLUMN IF NOT EXISTS whatsapp_msg_em_preparo text NOT NULL DEFAULT
    '{{nome}}, seu pedido #{{pedido_id}} entrou em preparo agora! 👨‍🍳 Já já fica pronto!',
  ADD COLUMN IF NOT EXISTS whatsapp_msg_saiu_entrega text NOT NULL DEFAULT
    'Seu pedido saiu para entrega! 🛵 Em aproximadamente {{tempo_estimado}} minutos chega aí, {{nome}}!',
  ADD COLUMN IF NOT EXISTS whatsapp_msg_entregue text NOT NULL DEFAULT
    'Pedido entregue! ✅ Obrigado pela preferência, {{nome}}! Volte sempre 🍔❤️',
  ADD COLUMN IF NOT EXISTS whatsapp_msg_retirada_pronto text NOT NULL DEFAULT
    '{{nome}}, seu pedido #{{pedido_id}} está pronto para retirada no balcão! 🏃 Pode vir buscar!';

-- Enum for WhatsApp log status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'whatsapp_log_status'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.whatsapp_log_status AS ENUM ('enviado', 'erro');
  END IF;
END;
$$;

-- WhatsApp send log table
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid REFERENCES public.pedidos(id) ON DELETE SET NULL,
  telefone text NOT NULL,
  tipo_mensagem text NOT NULL,
  mensagem_enviada text NOT NULL,
  status public.whatsapp_log_status NOT NULL,
  erro_detalhe text,
  enviado_em timestamptz NOT NULL DEFAULT now()
);

-- Index for cleanup cron and UI queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_enviado_em
  ON public.whatsapp_logs (enviado_em DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_pedido_id
  ON public.whatsapp_logs (pedido_id);

-- RLS: authenticated users can read/write logs (service role always bypasses)
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'whatsapp_logs'
      AND policyname = 'whatsapp_logs_select'
  ) THEN
    CREATE POLICY "whatsapp_logs_select" ON public.whatsapp_logs
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'whatsapp_logs'
      AND policyname = 'whatsapp_logs_insert'
  ) THEN
    CREATE POLICY "whatsapp_logs_insert" ON public.whatsapp_logs
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END;
$$;

-- Cleanup function: delete logs older than 90 days
CREATE OR REPLACE FUNCTION public.cleanup_whatsapp_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.whatsapp_logs
  WHERE enviado_em < now() - INTERVAL '90 days';
END;
$$;

-- Schedule daily cleanup at 03:00 UTC (requires pg_cron extension)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'whatsapp-logs-cleanup'
    ) THEN
      PERFORM cron.schedule(
        'whatsapp-logs-cleanup',
        '0 3 * * *',
        'SELECT public.cleanup_whatsapp_logs()'
      );
    END IF;
  END IF;
END;
$$;
