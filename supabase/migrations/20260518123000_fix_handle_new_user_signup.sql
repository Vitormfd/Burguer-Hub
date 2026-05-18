-- Hotfix: nao deixar falha de bootstrap bloquear cadastro em auth.users

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text;
  v_referencia text;
BEGIN
  v_nome := COALESCE(NEW.raw_user_meta_data ->> 'nome', '');

  -- 1) Perfil nunca deve derrubar o signup.
  BEGIN
    INSERT INTO public.profiles (id, nome)
    VALUES (NEW.id, v_nome)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: falha ao inserir profile para %: %', NEW.id, SQLERRM;
  END;

  -- 2) Configuracao inicial da loja: tentativa best-effort.
  BEGIN
    v_referencia := lower(
      regexp_replace(
        COALESCE(NULLIF(v_nome, ''), 'loja') || '-' || substring(NEW.id::text from 1 for 8),
        '[^a-zA-Z0-9-]+',
        '-',
        'g'
      )
    );

    INSERT INTO public.configuracoes (owner_id, nome_loja, referencia)
    VALUES (
      NEW.id,
      CASE WHEN v_nome = '' THEN 'Minha Hamburgueria' ELSE v_nome END,
      v_referencia
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: falha ao inserir configuracao para %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
