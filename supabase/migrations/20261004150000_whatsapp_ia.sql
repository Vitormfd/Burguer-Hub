-- Atendente com IA no robô do WhatsApp: entende pedidos em texto livre
-- ("2 x-bacon sem cebola e uma coca") e monta o carrinho. Nasce DESLIGADO;
-- requer o segredo ANTHROPIC_API_KEY na Edge Function zapi-webhook.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS whatsapp_ia_ativa boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.configuracoes.whatsapp_ia_ativa IS
  'Robô do WhatsApp usa IA para entender pedidos escritos em texto livre';
