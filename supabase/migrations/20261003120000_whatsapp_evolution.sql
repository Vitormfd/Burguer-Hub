-- Provedor de WhatsApp por loja: Z-API (padrão, lojas atuais) ou Evolution API (servidor próprio).
-- A URL e a API key global da Evolution ficam em secrets das Edge Functions, nunca nesta tabela.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS whatsapp_provider text NOT NULL DEFAULT 'zapi',
  ADD COLUMN IF NOT EXISTS evolution_instance text;

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_whatsapp_provider_check;

ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_whatsapp_provider_check
  CHECK (whatsapp_provider IN ('zapi', 'evolution'));

CREATE UNIQUE INDEX IF NOT EXISTS configuracoes_evolution_instance_key
  ON public.configuracoes (evolution_instance)
  WHERE evolution_instance IS NOT NULL;

COMMENT ON COLUMN public.configuracoes.whatsapp_provider IS
  'zapi = credenciais Z-API da loja; evolution = instancia no servidor Evolution API proprio';
COMMENT ON COLUMN public.configuracoes.evolution_instance IS
  'Nome da instancia na Evolution API (criada pela Edge Function send-whatsapp)';
