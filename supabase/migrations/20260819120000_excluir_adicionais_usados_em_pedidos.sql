-- Permite excluir grupos/adicionais do cardápio mesmo quando já foram
-- usados em pedidos. A linha do pedido permanece (qtd + preço + nome).

ALTER TABLE public.pedido_item_adicionais
  ADD COLUMN IF NOT EXISTS nome text;

UPDATE public.pedido_item_adicionais pia
SET nome = a.nome
FROM public.adicionais a
WHERE a.id = pia.adicional_id
  AND (pia.nome IS NULL OR BTRIM(pia.nome) = '');

CREATE OR REPLACE FUNCTION public.set_pedido_item_adicional_nome()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.nome IS NULL OR BTRIM(NEW.nome) = '' THEN
    SELECT a.nome
      INTO NEW.nome
    FROM public.adicionais a
    WHERE a.id = NEW.adicional_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pedido_item_adicionais_set_nome ON public.pedido_item_adicionais;
CREATE TRIGGER pedido_item_adicionais_set_nome
BEFORE INSERT OR UPDATE OF adicional_id, nome
ON public.pedido_item_adicionais
FOR EACH ROW
EXECUTE FUNCTION public.set_pedido_item_adicional_nome();

ALTER TABLE public.pedido_item_adicionais
  DROP CONSTRAINT IF EXISTS pedido_item_adicionais_adicional_id_fkey;

ALTER TABLE public.pedido_item_adicionais
  ALTER COLUMN adicional_id DROP NOT NULL;

ALTER TABLE public.pedido_item_adicionais
  ADD CONSTRAINT pedido_item_adicionais_adicional_id_fkey
  FOREIGN KEY (adicional_id)
  REFERENCES public.adicionais(id)
  ON DELETE SET NULL;
