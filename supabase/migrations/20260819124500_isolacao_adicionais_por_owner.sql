-- Isola grupos/adicionais por loja.
-- O seed da conta demo inseriu grupos sem owner_id; as policies antigas
-- eram USING (true), então todas as contas viam os mesmos grupos.

ALTER TABLE public.grupos_adicionais
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.adicionais
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.produto_grupos_adicionais
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 1) Dono único via vínculo com produto
UPDATE public.grupos_adicionais g
SET owner_id = src.owner_id
FROM (
  SELECT pga.grupo_id, (array_agg(p.owner_id))[1] AS owner_id
  FROM public.produto_grupos_adicionais pga
  JOIN public.produtos p ON p.id = pga.produto_id
  WHERE p.owner_id IS NOT NULL
  GROUP BY pga.grupo_id
  HAVING COUNT(DISTINCT p.owner_id) = 1
) src
WHERE g.id = src.grupo_id
  AND g.owner_id IS NULL;

-- 2) Se o mesmo grupo foi vinculado a produtos de várias lojas, clona para as outras
DO $$
DECLARE
  r record;
  v_new_grupo uuid;
BEGIN
  FOR r IN
    SELECT
      g.id AS grupo_id,
      g.nome,
      g.descricao,
      g.obrigatorio,
      g.min_escolhas,
      g.max_escolhas,
      g.ordem,
      g.disponivel,
      p.owner_id AS extra_owner
    FROM public.grupos_adicionais g
    JOIN public.produto_grupos_adicionais pga ON pga.grupo_id = g.id
    JOIN public.produtos p ON p.id = pga.produto_id
    WHERE g.owner_id IS NOT NULL
      AND p.owner_id IS NOT NULL
      AND p.owner_id <> g.owner_id
    GROUP BY
      g.id, g.nome, g.descricao, g.obrigatorio, g.min_escolhas,
      g.max_escolhas, g.ordem, g.disponivel, p.owner_id
  LOOP
    v_new_grupo := gen_random_uuid();

    INSERT INTO public.grupos_adicionais (
      id, owner_id, nome, descricao, obrigatorio, min_escolhas, max_escolhas, ordem, disponivel
    ) VALUES (
      v_new_grupo, r.extra_owner, r.nome, r.descricao, r.obrigatorio,
      r.min_escolhas, r.max_escolhas, r.ordem, r.disponivel
    );

    INSERT INTO public.adicionais (
      id, owner_id, grupo_id, nome, preco, disponivel, imagem_url, ordem
    )
    SELECT
      gen_random_uuid(),
      r.extra_owner,
      v_new_grupo,
      a.nome,
      a.preco,
      a.disponivel,
      a.imagem_url,
      a.ordem
    FROM public.adicionais a
    WHERE a.grupo_id = r.grupo_id;

    UPDATE public.produto_grupos_adicionais pga
    SET grupo_id = v_new_grupo
    FROM public.produtos p
    WHERE pga.grupo_id = r.grupo_id
      AND p.id = pga.produto_id
      AND p.owner_id = r.extra_owner;
  END LOOP;
END $$;

-- 3) Grupos do seed da demo, ainda sem dono
UPDATE public.grupos_adicionais g
SET owner_id = u.id
FROM auth.users u
WHERE u.email = 'demo@easyfoodhub.com.br'
  AND g.owner_id IS NULL
  AND g.nome IN (
    'Ponto da carne',
    'Queijo extra',
    'Extras',
    'Escolha o refrigerante'
  );

-- 4) Restante sem vínculo: se só existe uma loja além da demo, fica com ela
UPDATE public.grupos_adicionais g
SET owner_id = p.id
FROM public.profiles p
WHERE g.owner_id IS NULL
  AND p.id IS DISTINCT FROM (
    SELECT id FROM auth.users WHERE email = 'demo@easyfoodhub.com.br' LIMIT 1
  )
  AND (
    SELECT COUNT(*) FROM public.profiles x
    WHERE x.id IS DISTINCT FROM (
      SELECT id FROM auth.users WHERE email = 'demo@easyfoodhub.com.br' LIMIT 1
    )
  ) = 1;

-- 5) Propaga owner para itens e vínculos
UPDATE public.adicionais a
SET owner_id = g.owner_id
FROM public.grupos_adicionais g
WHERE a.grupo_id = g.id
  AND a.owner_id IS NULL;

UPDATE public.produto_grupos_adicionais pga
SET owner_id = COALESCE(p.owner_id, g.owner_id)
FROM public.produtos p, public.grupos_adicionais g
WHERE p.id = pga.produto_id
  AND g.id = pga.grupo_id
  AND pga.owner_id IS NULL;

ALTER TABLE public.grupos_adicionais ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.adicionais ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.produto_grupos_adicionais ALTER COLUMN owner_id SET DEFAULT auth.uid();

CREATE OR REPLACE FUNCTION public.set_adicional_owner_from_grupo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL AND NEW.grupo_id IS NOT NULL THEN
    SELECT g.owner_id INTO NEW.owner_id
    FROM public.grupos_adicionais g
    WHERE g.id = NEW.grupo_id;
  END IF;

  IF NEW.owner_id IS NULL AND auth.role() = 'authenticated' THEN
    NEW.owner_id := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS adicionais_set_owner_from_grupo ON public.adicionais;
CREATE TRIGGER adicionais_set_owner_from_grupo
BEFORE INSERT ON public.adicionais
FOR EACH ROW EXECUTE FUNCTION public.set_adicional_owner_from_grupo();

CREATE OR REPLACE FUNCTION public.set_produto_grupo_owner_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL AND NEW.produto_id IS NOT NULL THEN
    SELECT p.owner_id INTO NEW.owner_id
    FROM public.produtos p
    WHERE p.id = NEW.produto_id;
  END IF;

  IF NEW.owner_id IS NULL AND NEW.grupo_id IS NOT NULL THEN
    SELECT g.owner_id INTO NEW.owner_id
    FROM public.grupos_adicionais g
    WHERE g.id = NEW.grupo_id;
  END IF;

  IF NEW.owner_id IS NULL AND auth.role() = 'authenticated' THEN
    NEW.owner_id := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS produto_grupos_adicionais_set_owner ON public.produto_grupos_adicionais;
CREATE TRIGGER produto_grupos_adicionais_set_owner
BEFORE INSERT ON public.produto_grupos_adicionais
FOR EACH ROW EXECUTE FUNCTION public.set_produto_grupo_owner_from_parent();

DROP POLICY IF EXISTS "Leitura publica grupos adicionais" ON public.grupos_adicionais;
DROP POLICY IF EXISTS "Autenticados gerenciam grupos adicionais" ON public.grupos_adicionais;
DROP POLICY IF EXISTS "Leitura publica adicionais" ON public.adicionais;
DROP POLICY IF EXISTS "Autenticados gerenciam adicionais" ON public.adicionais;
DROP POLICY IF EXISTS "Leitura publica produto grupos adicionais" ON public.produto_grupos_adicionais;
DROP POLICY IF EXISTS "Autenticados gerenciam produto grupos adicionais" ON public.produto_grupos_adicionais;

CREATE POLICY "grupos_adicionais_anon_select"
  ON public.grupos_adicionais FOR SELECT TO anon
  USING (disponivel = true);

CREATE POLICY "grupos_adicionais_owner_all"
  ON public.grupos_adicionais FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "adicionais_anon_select"
  ON public.adicionais FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.grupos_adicionais g
      WHERE g.id = adicionais.grupo_id
        AND g.disponivel = true
    )
  );

CREATE POLICY "adicionais_owner_all"
  ON public.adicionais FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "produto_grupos_adicionais_anon_select"
  ON public.produto_grupos_adicionais FOR SELECT TO anon
  USING (true);

CREATE POLICY "produto_grupos_adicionais_owner_all"
  ON public.produto_grupos_adicionais FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
