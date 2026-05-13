DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Extensao pg_cron indisponivel neste ambiente: %', SQLERRM;
END;
$$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Extensao pg_net indisponivel neste ambiente: %', SQLERRM;
END;
$$;

DO $$
DECLARE
  v_project_url text;
  v_service_role_key text;
BEGIN
  v_project_url := current_setting('app.settings.supabase_url', true);
  v_service_role_key := current_setting('app.settings.service_role_key', true);

  IF v_project_url IS NULL OR v_service_role_key IS NULL THEN
    RAISE NOTICE 'Cron de Edge Function nao configurado automaticamente. Configure app.settings.supabase_url e app.settings.service_role_key.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('financeiro-vencimentos-diario');

  PERFORM cron.schedule(
    'financeiro-vencimentos-diario',
    '5 2 * * *',
    format(
      $cron$
      SELECT net.http_post(
        url := '%s/functions/v1/financeiro-vencimentos',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := '{}'::jsonb
      );
      $cron$,
      v_project_url,
      v_service_role_key
    )
  );
END;
$$;
