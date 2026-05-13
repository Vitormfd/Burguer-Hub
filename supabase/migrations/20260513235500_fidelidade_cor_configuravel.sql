ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS fidelidade_cor text NOT NULL DEFAULT '#16a34a';

UPDATE public.configuracoes
SET fidelidade_cor = '#16a34a'
WHERE fidelidade_cor IS NULL
   OR fidelidade_cor !~ '^#[0-9A-Fa-f]{6}$';
