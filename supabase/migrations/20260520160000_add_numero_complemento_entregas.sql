-- Adicionar campos numero e complemento na tabela entregas
ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS numero TEXT,
  ADD COLUMN IF NOT EXISTS complemento TEXT;
