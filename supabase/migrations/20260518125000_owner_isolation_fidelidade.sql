-- Isolamento de dados por tenant para tabelas de fidelidade e cupons

-- 1) Adicionar coluna owner_id nas tabelas de fidelidade e cupons
ALTER TABLE public.recompensas ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.cupons ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.cupom_usos ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

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

  UPDATE public.recompensas SET owner_id = COALESCE(owner_id, v_default_owner);
  UPDATE public.clientes SET owner_id = COALESCE(owner_id, v_default_owner);
  UPDATE public.cupons SET owner_id = COALESCE(owner_id, v_default_owner);
  
  UPDATE public.cupom_usos cu
  SET owner_id = COALESCE(cu.owner_id, c.owner_id, v_default_owner)
  FROM public.cupons c
  WHERE cu.cupom_id = c.id;

  UPDATE public.cupom_usos
  SET owner_id = COALESCE(owner_id, v_default_owner)
  WHERE owner_id IS NULL;
END;
$$;

-- 3) Defaults de owner para operações autenticadas
ALTER TABLE public.recompensas ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.clientes ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.cupons ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE public.cupom_usos ALTER COLUMN owner_id SET DEFAULT auth.uid();

-- 4) Triggers para propagar owner em tabelas filhas
CREATE OR REPLACE FUNCTION public.set_owner_from_parent_fidelidade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'cupom_usos' THEN
    IF NEW.owner_id IS NULL AND NEW.cupom_id IS NOT NULL THEN
      SELECT c.owner_id INTO NEW.owner_id FROM public.cupons c WHERE c.id = NEW.cupom_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupom_usos_set_owner ON public.cupom_usos;
CREATE TRIGGER cupom_usos_set_owner
BEFORE INSERT ON public.cupom_usos
FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_parent_fidelidade();

-- 5) RLS (Row Level Security) para tabelas de fidelidade
ALTER TABLE public.recompensas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupom_usos ENABLE ROW LEVEL SECURITY;

-- Policies para recompensas
DROP POLICY IF EXISTS "recompensas_owner_isolation" ON public.recompensas;
CREATE POLICY "recompensas_owner_isolation" ON public.recompensas
  USING (owner_id = auth.uid() OR owner_id IS NULL)
  WITH CHECK (owner_id = auth.uid());

-- Policies para clientes (visível para owner e sem autenticação via cardápio público)
DROP POLICY IF EXISTS "clientes_insert_anon" ON public.clientes;
CREATE POLICY "clientes_insert_anon" ON public.clientes
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "clientes_select_public" ON public.clientes;
CREATE POLICY "clientes_select_public" ON public.clientes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "clientes_update_public" ON public.clientes;
CREATE POLICY "clientes_update_public" ON public.clientes
  FOR UPDATE USING (true) WITH CHECK (true);

-- Policies para cupons (visível para owner e sem autenticação via cardápio público)
DROP POLICY IF EXISTS "cupons_insert_anon" ON public.cupons;
CREATE POLICY "cupons_insert_anon" ON public.cupons
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "cupons_select_public" ON public.cupons;
CREATE POLICY "cupons_select_public" ON public.cupons
  FOR SELECT USING (true);

-- Policies para cupom_usos (visível para owner e sem autenticação via cardápio público)
DROP POLICY IF EXISTS "cupom_usos_insert_anon" ON public.cupom_usos;
CREATE POLICY "cupom_usos_insert_anon" ON public.cupom_usos
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "cupom_usos_select_public" ON public.cupom_usos;
CREATE POLICY "cupom_usos_select_public" ON public.cupom_usos
  FOR SELECT USING (true);
