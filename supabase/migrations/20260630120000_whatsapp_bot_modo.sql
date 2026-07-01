-- Modo do chatbot WhatsApp: pedido completo ou apenas link do cardápio
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS whatsapp_bot_modo text NOT NULL DEFAULT 'completo';

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_whatsapp_bot_modo_check;

ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_whatsapp_bot_modo_check
  CHECK (whatsapp_bot_modo IN ('completo', 'apenas_link'));
