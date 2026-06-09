-- Módulo de pedidos via WhatsApp (chatbot Z-API)

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS whatsapp_pedido_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_msg_boas_vindas text NOT NULL DEFAULT
    'Olá! 👋 Bem-vindo(a) à *{{loja}}*!

Faça seu pedido pelo WhatsApp — é rápido e fácil! 🍔

Digite *menu* para ver o cardápio
Digite *carrinho* para ver seu pedido
Digite *link* para o cardápio online
Digite *cancelar* para desistir
Digite *ajuda* para ver os comandos

🌐 Ou peça pelo site: {{cardapio}}';

-- Sessões conversacionais do chatbot
CREATE TABLE IF NOT EXISTS public.whatsapp_pedido_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  telefone text NOT NULL,
  etapa text NOT NULL DEFAULT 'inicio',
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  ultimo_message_id text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_pedido_sessions_owner_telefone_unique UNIQUE (owner_id, telefone)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_pedido_sessions_atualizado
  ON public.whatsapp_pedido_sessions (atualizado_em DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_pedido_sessions_owner
  ON public.whatsapp_pedido_sessions (owner_id);

-- RLS: apenas service role (edge functions) manipula sessões
ALTER TABLE public.whatsapp_pedido_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'whatsapp_pedido_sessions'
      AND policyname = 'whatsapp_pedido_sessions_select'
  ) THEN
    CREATE POLICY "whatsapp_pedido_sessions_select" ON public.whatsapp_pedido_sessions
      FOR SELECT TO authenticated
      USING (owner_id = auth.uid());
  END IF;
END;
$$;

-- Origem whatsapp para entregas
ALTER TABLE public.entregas DROP CONSTRAINT IF EXISTS entregas_origem_check;
ALTER TABLE public.entregas
  ADD CONSTRAINT entregas_origem_check
  CHECK (origem IN ('manual', 'online', 'whatsapp'));

-- RPC para criar pedido via WhatsApp (reutiliza lógica do checkout público)
CREATE OR REPLACE FUNCTION public.create_whatsapp_delivery_order(
  p_owner_id uuid,
  p_tipo_entrega text,
  p_cliente_nome text,
  p_cliente_telefone text,
  p_endereco text,
  p_numero text,
  p_complemento text,
  p_bairro text,
  p_taxa_entrega numeric,
  p_forma_pagamento text,
  p_troco_para numeric DEFAULT NULL,
  p_subtotal numeric DEFAULT 0,
  p_total numeric DEFAULT 0,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_pedido_id uuid;
BEGIN
  v_result := public.create_public_delivery_order(
    p_owner_id,
    p_tipo_entrega,
    p_cliente_nome,
    p_cliente_telefone,
    p_endereco,
    p_numero,
    p_complemento,
    p_bairro,
    p_taxa_entrega,
    p_forma_pagamento,
    p_troco_para,
    p_subtotal,
    0,
    p_total,
    NULL,
    0,
    NULL,
    NULL,
    p_items
  );

  v_pedido_id := (v_result->>'pedido_id')::uuid;

  UPDATE public.entregas
  SET origem = 'whatsapp'
  WHERE pedido_id = v_pedido_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_whatsapp_delivery_order(
  uuid, text, text, text, text, text, text, text,
  numeric, text, numeric, numeric, numeric, jsonb
) TO service_role;
