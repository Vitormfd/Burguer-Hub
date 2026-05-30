-- {{resumo}} só funciona após redeploy da edge function; {{itens}} já funciona em produção
UPDATE public.configuracoes
SET whatsapp_msg_confirmado = REPLACE(whatsapp_msg_confirmado, '{{resumo}}', '{{itens}}')
WHERE whatsapp_msg_confirmado LIKE '%{{resumo}}%';

ALTER TABLE public.configuracoes
  ALTER COLUMN whatsapp_msg_confirmado SET DEFAULT
    'Olá {{nome}}! 🍔 Seu pedido #{{pedido_id}} foi confirmado e já está na fila!

📋 *Resumo do pedido:*
{{itens}}

💰 *Total:* {{total}}

Em breve começamos o preparo! 🔥';
