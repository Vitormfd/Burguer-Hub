DO $$ BEGIN
  CREATE TYPE public.modalidade_consumo AS ENUM ('local', 'levar');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.contas
  ADD COLUMN IF NOT EXISTS modalidade_consumo public.modalidade_consumo NOT NULL DEFAULT 'local';
