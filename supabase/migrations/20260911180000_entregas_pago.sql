-- Marca se o pagamento da entrega/retirada já foi recebido.
-- Pedidos Pix online (Mercado Pago) ficam pago=true; manuais/balcão escolhem no formulário.
ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS pago boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.entregas.pago IS
  'true = pagamento já recebido (ex.: Pix online ou pago no balcão); false = a pagar na entrega/retirada';

-- Pedidos criados após aprovação do Pix online já existentes.
UPDATE public.entregas e
SET pago = true
FROM public.pagamentos_pix pp
WHERE pp.pedido_id = e.pedido_id
  AND pp.status = 'approved'
  AND e.pago = false;
