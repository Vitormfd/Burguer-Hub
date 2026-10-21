-- Pedido feito no site com Pix online só existe depois que o Mercado Pago aprova o
-- pagamento, então a entrega dele é sempre paga. Antes isso dependia só do webhook
-- (mp-pix-webhook) fazer um UPDATE separado em entregas; se a versão publicada da
-- função não tiver esse passo, ou ele falhar, a notinha sai "A PAGAR".
-- Agora o próprio banco garante: assim que o Pix aprovado é vinculado ao pedido,
-- a entrega vira pago = true.

CREATE OR REPLACE FUNCTION public.pagamentos_pix_marca_entrega_paga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.pedido_id IS NOT NULL THEN
    UPDATE public.entregas
    SET pago = true
    WHERE pedido_id = NEW.pedido_id
      AND pago = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagamentos_pix_marca_entrega_paga ON public.pagamentos_pix;
CREATE TRIGGER trg_pagamentos_pix_marca_entrega_paga
  AFTER INSERT OR UPDATE OF status, pedido_id ON public.pagamentos_pix
  FOR EACH ROW
  EXECUTE FUNCTION public.pagamentos_pix_marca_entrega_paga();

-- Corrige os pedidos Pix online que já entraram como "A pagar".
UPDATE public.entregas e
SET pago = true
FROM public.pagamentos_pix pp
WHERE pp.pedido_id = e.pedido_id
  AND pp.status = 'approved'
  AND e.pago = false;
