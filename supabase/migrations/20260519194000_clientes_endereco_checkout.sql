-- Persistencia de endereco no cadastro de clientes para auto-preenchimento no checkout

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS endereco text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text;
