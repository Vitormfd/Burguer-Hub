-- Isolamento de dados por conta (owner_id) para evitar vazamento entre tenants

-- 1) Coluna owner_id nas tabelas principais
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bairros_taxas ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.mesas ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.contas ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_itens ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.entregas ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 2) Backfill do owner com base no primeiro profile (dados legados)
DO $$
DECLARE
  v_default_owner uuid;
BEGIN
  SELECT p.id INTO v_default_owner
  FROM public.profiles p
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF v_default_owner IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.configuracoes SET owner_id = COALESCE(owner_id, v_default_owner);
  UPDATE public.bairros_taxas SET owner_id = COALESCE(owner_id, v_default_owner);
  UPDATE public.categorias SET owner_id = COALESCE(owner_id, v_default_owner);
  UPDATE public.produtos SET owner_id = COALESCE(owner_id, v_default_owner);
  UPDATE public.mesas SET owner_id = COALESCE(owner_id, v_default_owner);

  UPDATE public.contas c
  SET owner_id = COALESCE(c.owner_id, m.owner_id, v_default_owner)
  FROM public.mesas m
  WHERE c.mesa_id = m.id;

  UPDATE public.contas
  SET owner_id = COALESCE(owner_id, v_default_owner)
  WHERE owner_id IS NULL;

  UPDATE public.pedidos p
  SET owner_id = COALESCE(p.owner_id, c.owner_id, v_default_owner)
  FROM public.contas c
  WHERE p.conta_id = c.id;

  UPDATE public.pedidos
  SET owner_id = COALESCE(owner_id, v_default_owner)
  WHERE owner_id IS NULL;

  UPDATE public.pedido_itens pi
  SET owner_id = COALESCE(pi.owner_id, p.owner_id, v_default_owner)
  FROM public.pedidos p
  WHERE pi.pedido_id = p.id;

  UPDATE public.pedido_itens
  SET owner_id = COALESCE(owner_id, v_default_owner)
  WHERE owner_id IS NULL;

  UPDATE public.entregas e
  SET owner_id = COALESCE(e.owner_id, p.owner_id, v_default_owner)
  FROM public.pedidos p
  WHERE e.pedido_id = p.id;

  UPDATE public.entregas
  SET owner_id = COALESCE(owner_id, v_default_owner)
  WHERE owner_id IS NULL;
END;
$$;

-- 3) Defaults de owner para operações autenticadas
ALTER TABLE public.configuracoes ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.bairros_taxas ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.categorias ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.produtos ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.mesas ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.contas ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.pedidos ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.pedido_itens ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.entregas ALTER COLUMN owner_id SET DEFAULT auth.uid();

-- 4) Triggers para propagar owner em tabelas filhas
CREATE OR REPLACE FUNCTION public.set_owner_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'contas' THEN
    IF NEW.owner_id IS NULL AND NEW.mesa_id IS NOT NULL THEN
      SELECT m.owner_id INTO NEW.owner_id FROM public.mesas m WHERE m.id = NEW.mesa_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'pedidos' THEN
    IF NEW.owner_id IS NULL AND NEW.conta_id IS NOT NULL THEN
      SELECT c.owner_id INTO NEW.owner_id FROM public.contas c WHERE c.id = NEW.conta_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'pedido_itens' THEN
    IF NEW.owner_id IS NULL THEN
      SELECT p.owner_id INTO NEW.owner_id FROM public.pedidos p WHERE p.id = NEW.pedido_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'entregas' THEN
    IF NEW.owner_id IS NULL THEN
      SELECT p.owner_id INTO NEW.owner_id FROM public.pedidos p WHERE p.id = NEW.pedido_id;
    END IF;
  END IF;

  IF NEW.owner_id IS NULL AND auth.role() = 'authenticated' THEN
    NEW.owner_id := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contas_set_owner_from_parent ON public.contas;
CREATE TRIGGER contas_set_owner_from_parent
BEFORE INSERT ON public.contas
FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_parent();

DROP TRIGGER IF EXISTS pedidos_set_owner_from_parent ON public.pedidos;
CREATE TRIGGER pedidos_set_owner_from_parent
BEFORE INSERT ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_parent();

DROP TRIGGER IF EXISTS pedido_itens_set_owner_from_parent ON public.pedido_itens;
CREATE TRIGGER pedido_itens_set_owner_from_parent
BEFORE INSERT ON public.pedido_itens
FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_parent();

DROP TRIGGER IF EXISTS entregas_set_owner_from_parent ON public.entregas;
CREATE TRIGGER entregas_set_owner_from_parent
BEFORE INSERT ON public.entregas
FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_parent();

-- 5) Ajuste de unicidade por tenant
ALTER TABLE public.mesas DROP CONSTRAINT IF EXISTS mesas_numero_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mesas_owner_numero_unique
  ON public.mesas (owner_id, numero)
  WHERE owner_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracoes_owner_unique
  ON public.configuracoes (owner_id)
  WHERE owner_id IS NOT NULL;

-- 6) Criar configuracao inicial para novas contas e evitar singleton global
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

  INSERT INTO public.profiles (id, nome)
  VALUES (NEW.id, v_nome)
  ON CONFLICT (id) DO NOTHING;

  v_referencia := lower(regexp_replace(COALESCE(NULLIF(v_nome, ''), 'loja') || '-' || substring(NEW.id::text from 1 for 8), '[^a-zA-Z0-9-]+', '-', 'g'));

  INSERT INTO public.configuracoes (owner_id, nome_loja, referencia)
  VALUES (
    NEW.id,
    CASE WHEN v_nome = '' THEN 'Minha Hamburgueria' ELSE v_nome END,
    v_referencia
  )
  ON CONFLICT (owner_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 7) Policies: remover permissivas e aplicar isolamento por owner para authenticated
DROP POLICY IF EXISTS "Configurações públicas para leitura" ON public.configuracoes;
DROP POLICY IF EXISTS "Autenticados atualizam configurações" ON public.configuracoes;
DROP POLICY IF EXISTS "Autenticados inserem configurações" ON public.configuracoes;

DROP POLICY IF EXISTS "Bairros públicos para leitura" ON public.bairros_taxas;
DROP POLICY IF EXISTS "Autenticados gerenciam bairros - insert" ON public.bairros_taxas;
DROP POLICY IF EXISTS "Autenticados gerenciam bairros - update" ON public.bairros_taxas;
DROP POLICY IF EXISTS "Autenticados gerenciam bairros - delete" ON public.bairros_taxas;

DROP POLICY IF EXISTS "Autenticados leem categorias" ON public.categorias;
DROP POLICY IF EXISTS "Autenticados inserem categorias" ON public.categorias;
DROP POLICY IF EXISTS "Autenticados atualizam categorias" ON public.categorias;
DROP POLICY IF EXISTS "Autenticados deletam categorias" ON public.categorias;

DROP POLICY IF EXISTS "Autenticados leem produtos" ON public.produtos;
DROP POLICY IF EXISTS "Autenticados inserem produtos" ON public.produtos;
DROP POLICY IF EXISTS "Autenticados atualizam produtos" ON public.produtos;
DROP POLICY IF EXISTS "Autenticados deletam produtos" ON public.produtos;

DROP POLICY IF EXISTS "Autenticados leem mesas" ON public.mesas;
DROP POLICY IF EXISTS "Autenticados inserem mesas" ON public.mesas;
DROP POLICY IF EXISTS "Autenticados atualizam mesas" ON public.mesas;
DROP POLICY IF EXISTS "Autenticados deletam mesas" ON public.mesas;

DROP POLICY IF EXISTS "Autenticados leem contas" ON public.contas;
DROP POLICY IF EXISTS "Autenticados inserem contas" ON public.contas;
DROP POLICY IF EXISTS "Autenticados atualizam contas" ON public.contas;
DROP POLICY IF EXISTS "Autenticados deletam contas" ON public.contas;

DROP POLICY IF EXISTS "Autenticados leem pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "Autenticados inserem pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "Autenticados atualizam pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "Autenticados deletam pedidos" ON public.pedidos;

DROP POLICY IF EXISTS "Autenticados leem pedido_itens" ON public.pedido_itens;
DROP POLICY IF EXISTS "Autenticados inserem pedido_itens" ON public.pedido_itens;
DROP POLICY IF EXISTS "Autenticados atualizam pedido_itens" ON public.pedido_itens;
DROP POLICY IF EXISTS "Autenticados deletam pedido_itens" ON public.pedido_itens;

DROP POLICY IF EXISTS "Autenticados leem entregas" ON public.entregas;
DROP POLICY IF EXISTS "Autenticados inserem entregas" ON public.entregas;
DROP POLICY IF EXISTS "Autenticados atualizam entregas" ON public.entregas;
DROP POLICY IF EXISTS "Autenticados deletam entregas" ON public.entregas;

CREATE POLICY "configuracoes_anon_select"
  ON public.configuracoes FOR SELECT TO anon
  USING (ativo = true);

CREATE POLICY "configuracoes_owner_all"
  ON public.configuracoes FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "bairros_anon_select"
  ON public.bairros_taxas FOR SELECT TO anon
  USING (ativo = true);

CREATE POLICY "bairros_owner_all"
  ON public.bairros_taxas FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "categorias_owner_all"
  ON public.categorias FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "produtos_owner_all"
  ON public.produtos FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "mesas_owner_all"
  ON public.mesas FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "contas_owner_all"
  ON public.contas FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "pedidos_owner_all"
  ON public.pedidos FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "pedido_itens_owner_all"
  ON public.pedido_itens FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "entregas_owner_all"
  ON public.entregas FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Mantem as policies anon ja existentes para categorias/produtos/entregas/pedidos,
-- mas o frontend publico deve consultar pelo owner_id da configuracao carregada.
