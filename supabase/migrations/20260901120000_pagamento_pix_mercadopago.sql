-- Pagamento via Pix (Mercado Pago) no cardápio público.
-- O pedido só é criado (pela RPC create_public_delivery_order já existente) depois que o
-- webhook do Mercado Pago confirma o pagamento — nunca a partir do frontend público.

-- 1) Credenciais do Mercado Pago por loja. Fica FORA de "configuracoes" de propósito:
--    "configuracoes" tem policy de SELECT para anon (cardápio público lê a linha inteira),
--    então um token de pagamento nunca pode morar lá.
CREATE TABLE IF NOT EXISTS public.integracoes_pagamento (
  owner_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  mercadopago_access_token text,
  ativo boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integracoes_pagamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integracoes_pagamento_owner_all"
  ON public.integracoes_pagamento FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Nenhuma policy para anon: a tabela fica invisível ao cardápio público.
-- Edge Functions usam a service role key, que ignora RLS.

-- 2) Flag pública e segura (não é segredo) para o cardápio público saber se deve
--    cobrar Pix antes de criar o pedido.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS pix_online_ativo boolean NOT NULL DEFAULT false;

-- 3) Cobranças Pix em andamento/concluídas. Guarda o payload completo do pedido para
--    que o webhook consiga criar o pedido de verdade só depois da aprovação.
CREATE TABLE IF NOT EXISTS public.pagamentos_pix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mp_payment_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  payload jsonb NOT NULL,
  pedido_id uuid REFERENCES public.pedidos(id) ON DELETE SET NULL,
  qr_code text,
  qr_code_base64 text,
  valor numeric NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_owner_id ON public.pagamentos_pix (owner_id);

ALTER TABLE public.pagamentos_pix ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pagamentos_pix_owner_all"
  ON public.pagamentos_pix FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Sem policy anon: o cardápio público nunca lê essa tabela diretamente.
-- O status é consultado só pela RPC abaixo, usando o id do pagamento como capability token.

-- 4) RPC pública e mínima para o cardápio público consultar o status do Pix em polling.
CREATE OR REPLACE FUNCTION public.get_pagamento_pix_status(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_pedido_id uuid;
BEGIN
  SELECT status, pedido_id INTO v_status, v_pedido_id
  FROM public.pagamentos_pix
  WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'pedido_id', null);
  END IF;

  RETURN jsonb_build_object('status', v_status, 'pedido_id', v_pedido_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pagamento_pix_status(uuid) TO anon, authenticated;
