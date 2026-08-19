-- Cupons da demo apareciam em outras lojas porque o SELECT era global.
-- O checkout público usa RPC (security definer) e a edge function usa service role,
-- então continua validando o código sem listar cupons de outra conta no painel.

DROP POLICY IF EXISTS "Cupons visíveis para autenticados" ON public.cupons;
DROP POLICY IF EXISTS "Cupons administráveis por autenticados" ON public.cupons;
DROP POLICY IF EXISTS "Cupons atualizáveis por autenticados" ON public.cupons;
DROP POLICY IF EXISTS "Cupons excluíveis por autenticados" ON public.cupons;
DROP POLICY IF EXISTS "cupons_insert_anon" ON public.cupons;
DROP POLICY IF EXISTS "cupons_select_public" ON public.cupons;

DROP POLICY IF EXISTS "Usos de cupom visíveis para autenticados" ON public.cupom_usos;
DROP POLICY IF EXISTS "cupom_usos_insert_anon" ON public.cupom_usos;
DROP POLICY IF EXISTS "cupom_usos_select_public" ON public.cupom_usos;

CREATE POLICY "cupons_owner_all"
  ON public.cupons FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "cupom_usos_owner_select"
  ON public.cupom_usos FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "cupom_usos_owner_insert"
  ON public.cupom_usos FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "cupom_usos_anon_insert"
  ON public.cupom_usos FOR INSERT TO anon
  WITH CHECK (true);
