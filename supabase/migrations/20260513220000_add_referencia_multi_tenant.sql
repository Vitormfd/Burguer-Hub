-- Adicionar coluna referencia (slug único) para multi-tenant
ALTER TABLE public.configuracoes
ADD COLUMN IF NOT EXISTS referencia TEXT UNIQUE DEFAULT NULL;

-- Criar índice para melhorar buscas por referencia
CREATE INDEX IF NOT EXISTS idx_configuracoes_referencia ON public.configuracoes(referencia);
