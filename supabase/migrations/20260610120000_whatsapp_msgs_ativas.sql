-- Ativar/desativar cada mensagem automática de status do pedido
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS whatsapp_msg_confirmado_ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_msg_em_preparo_ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_msg_saiu_entrega_ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_msg_entregue_ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_msg_retirada_pronto_ativo boolean NOT NULL DEFAULT true;
