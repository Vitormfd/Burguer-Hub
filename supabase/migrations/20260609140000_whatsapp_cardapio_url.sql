-- URL pública do cardápio para mensagens WhatsApp

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS site_url text;

COMMENT ON COLUMN public.configuracoes.site_url IS
  'URL base do app público (ex: https://minhaloja.com.br). Usada em {{cardapio}} nas mensagens WhatsApp.';

-- Atualiza template padrão de boas-vindas (só onde ainda é o default antigo)
UPDATE public.configuracoes
SET whatsapp_msg_boas_vindas =
  'Olá! 👋 Bem-vindo(a) à *{{loja}}*!

Faça seu pedido pelo WhatsApp — é rápido e fácil! 🍔

Digite *menu* para ver o cardápio
Digite *carrinho* para ver seu pedido
Digite *link* para o cardápio online
Digite *cancelar* para desistir
Digite *ajuda* para ver os comandos

🌐 Ou peça pelo site: {{cardapio}}'
WHERE whatsapp_msg_boas_vindas LIKE '%Digite *menu* para ver o cardápio%'
  AND whatsapp_msg_boas_vindas NOT LIKE '%{{cardapio}}%';
