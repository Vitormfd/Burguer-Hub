-- Template padrão de confirmação passa a incluir resumo do pedido
ALTER TABLE public.configuracoes
  ALTER COLUMN whatsapp_msg_confirmado SET DEFAULT
    'Olá {{nome}}! 🍔 Seu pedido #{{pedido_id}} foi confirmado e já está na fila!

📋 *Resumo do pedido:*
{{resumo}}

💰 *Total:* {{total}}

Em breve começamos o preparo! 🔥';

-- Atualiza lojas que ainda usam o texto padrão antigo (sem resumo)
UPDATE public.configuracoes
SET whatsapp_msg_confirmado =
  'Olá {{nome}}! 🍔 Seu pedido #{{pedido_id}} foi confirmado e já está na fila!

📋 *Resumo do pedido:*
{{resumo}}

💰 *Total:* {{total}}

Em breve começamos o preparo! 🔥'
WHERE whatsapp_msg_confirmado = 'Olá {{nome}}! 🍔 Seu pedido #{{pedido_id}} foi confirmado e já está na fila! Em breve começamos o preparo. 🔥';
