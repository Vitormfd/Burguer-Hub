-- Adiciona campo de ordenação manual para produtos (lanches)
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 0;

-- Preenche ordem inicial baseada na ordem alfabética atual
DO $$
DECLARE
  rec RECORD;
  idx INTEGER := 0;
BEGIN
  FOR rec IN SELECT id FROM public.produtos ORDER BY nome ASC LOOP
    UPDATE public.produtos SET ordem = idx WHERE id = rec.id;
    idx := idx + 1;
  END LOOP;
END;
$$;

-- Index para ordenação eficiente
CREATE INDEX IF NOT EXISTS produtos_ordem_idx ON public.produtos(ordem);
