ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS destaque boolean NOT NULL DEFAULT false;
