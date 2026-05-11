ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS promocao boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preco_promocional numeric;

ALTER TABLE public.categorias
  ADD COLUMN IF NOT EXISTS icone text;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS tempo_entrega_min text NOT NULL DEFAULT '30-45 min';