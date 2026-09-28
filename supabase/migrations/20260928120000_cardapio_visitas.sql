-- Funil de visitas do cardápio público: uma linha por sessão, guardando a etapa mais avançada.
-- etapa: 1 = abriu o cardápio, 2 = adicionou ao carrinho, 3 = abriu o checkout, 4 = finalizou o pedido.

CREATE TABLE IF NOT EXISTS public.cardapio_visitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  session_id text NOT NULL,
  etapa smallint NOT NULL DEFAULT 1 CHECK (etapa BETWEEN 1 AND 4),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, session_id)
);

CREATE INDEX IF NOT EXISTS cardapio_visitas_owner_criado_idx
  ON public.cardapio_visitas (owner_id, criado_em);

ALTER TABLE public.cardapio_visitas ENABLE ROW LEVEL SECURITY;

-- Anon não lê nem altera a tabela direto: grava só via RPC abaixo.
DROP POLICY IF EXISTS "cardapio_visitas_owner_select" ON public.cardapio_visitas;
CREATE POLICY "cardapio_visitas_owner_select"
  ON public.cardapio_visitas FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.registrar_visita_cardapio(
  p_owner_id uuid,
  p_session_id text,
  p_etapa smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $registrar$
BEGIN
  IF p_owner_id IS NULL
     OR p_session_id IS NULL
     OR length(p_session_id) NOT BETWEEN 8 AND 64
     OR p_etapa IS NULL
     OR p_etapa NOT BETWEEN 1 AND 4 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.configuracoes c WHERE c.owner_id = p_owner_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.cardapio_visitas (owner_id, session_id, etapa)
  VALUES (p_owner_id, p_session_id, p_etapa)
  ON CONFLICT (owner_id, session_id) DO UPDATE
    SET etapa = GREATEST(public.cardapio_visitas.etapa, EXCLUDED.etapa),
        atualizado_em = now();
END;
$registrar$;

REVOKE ALL ON FUNCTION public.registrar_visita_cardapio(uuid, text, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_visita_cardapio(uuid, text, smallint) TO anon, authenticated;

-- Quantas sessões chegaram em cada etapa (ou além) no período, para o dono logado.
CREATE OR REPLACE FUNCTION public.relatorio_visitas_cardapio(p_ini timestamptz, p_fim timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $relatorio$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'visitas',  COUNT(*),
      'carrinho', COUNT(*) FILTER (WHERE etapa >= 2),
      'checkout', COUNT(*) FILTER (WHERE etapa >= 3),
      'pedidos',  COUNT(*) FILTER (WHERE etapa >= 4)
    )
    FROM public.cardapio_visitas
    WHERE owner_id = auth.uid()
      AND criado_em >= p_ini
      AND criado_em <= p_fim
  );
END;
$relatorio$;

REVOKE ALL ON FUNCTION public.relatorio_visitas_cardapio(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_visitas_cardapio(timestamptz, timestamptz) TO authenticated;

-- Limpeza diária (visitas com mais de 60 dias). Não bloqueia a migration se pg_cron não estiver disponível.
DO $limpeza$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'limpar_cardapio_visitas';
  PERFORM cron.schedule(
    'limpar_cardapio_visitas',
    '0 4 * * *',
    $job$DELETE FROM public.cardapio_visitas WHERE criado_em < now() - interval '60 days'$job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponível; agende a limpeza de cardapio_visitas manualmente: %', SQLERRM;
END;
$limpeza$;
