ALTER TABLE public.categorias
  ADD COLUMN IF NOT EXISTS ordem integer NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.owner_id
      ORDER BY c.nome, c.id
    ) - 1 AS nova_ordem
  FROM public.categorias c
)
UPDATE public.categorias c
SET ordem = r.nova_ordem
FROM ranked r
WHERE c.id = r.id
  AND c.ordem = 0;

CREATE INDEX IF NOT EXISTS idx_categorias_owner_ordem
  ON public.categorias (owner_id, ordem, nome);
