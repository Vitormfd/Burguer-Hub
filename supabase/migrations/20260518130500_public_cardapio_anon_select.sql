-- Restaurar leitura anonima do cardapio publico por tenant

DROP POLICY IF EXISTS "categorias_anon_select" ON public.categorias;
CREATE POLICY "categorias_anon_select"
  ON public.categorias FOR SELECT TO anon
  USING (ativo = true);

DROP POLICY IF EXISTS "produtos_anon_select" ON public.produtos;
CREATE POLICY "produtos_anon_select"
  ON public.produtos FOR SELECT TO anon
  USING (disponivel = true);

DROP POLICY IF EXISTS "recompensas_anon_select" ON public.recompensas;
CREATE POLICY "recompensas_anon_select"
  ON public.recompensas FOR SELECT TO anon
  USING (ativo = true);
