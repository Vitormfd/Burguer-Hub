-- O cadastro no sistema é aberto e sem cobrança, então o agente não manda mais o link de
-- cadastro: manda a landing page (easyfoodhub.com.br/lp) e quem quer contratar vai para
-- atendimento humano. Pode rodar de novo sem estragar nada.
DO $m$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'prospeccao_config' AND column_name = 'link_cadastro'
  ) THEN
    ALTER TABLE public.prospeccao_config RENAME COLUMN link_cadastro TO link_site;
  END IF;
END;
$m$;

ALTER TABLE public.prospeccao_config ALTER COLUMN link_site SET DEFAULT 'https://easyfoodhub.com.br/lp';

UPDATE public.prospeccao_config
SET link_site = 'https://easyfoodhub.com.br/lp'
WHERE link_site IN ('', 'https://www.easyfoodhub.com.br/auth', 'https://easyfoodhub.com.br/auth');
