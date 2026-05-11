
-- 1) Configurações (singleton)
CREATE TABLE IF NOT EXISTS public.configuracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_loja text NOT NULL DEFAULT 'Minha Hamburgueria',
  logo_url text,
  banner_url text,
  cor_primaria text NOT NULL DEFAULT '#E11D48',
  ativo boolean NOT NULL DEFAULT true,
  hora_abertura time NOT NULL DEFAULT '18:00',
  hora_fechamento time NOT NULL DEFAULT '23:00',
  seo_titulo text NOT NULL DEFAULT 'Cardápio Online',
  seo_descricao text NOT NULL DEFAULT 'Peça já o seu hambúrguer.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Configurações públicas para leitura"
  ON public.configuracoes FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Autenticados atualizam configurações"
  ON public.configuracoes FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Autenticados inserem configurações"
  ON public.configuracoes FOR INSERT TO authenticated WITH CHECK (true);

CREATE TRIGGER configuracoes_updated_at
  BEFORE UPDATE ON public.configuracoes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

INSERT INTO public.configuracoes (nome_loja) VALUES ('Minha Hamburgueria');

-- 2) Bairros e taxas
CREATE TABLE IF NOT EXISTS public.bairros_taxas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  taxa numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bairros_taxas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bairros públicos para leitura"
  ON public.bairros_taxas FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Autenticados gerenciam bairros - insert"
  ON public.bairros_taxas FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Autenticados gerenciam bairros - update"
  ON public.bairros_taxas FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Autenticados gerenciam bairros - delete"
  ON public.bairros_taxas FOR DELETE TO authenticated USING (true);

-- 3) Acesso público para leitura do cardápio
CREATE POLICY "Categorias públicas para leitura"
  ON public.categorias FOR SELECT TO anon USING (ativo = true);

CREATE POLICY "Produtos públicos para leitura"
  ON public.produtos FOR SELECT TO anon USING (disponivel = true);

-- 4) Campos extras em entregas
ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS forma_pagamento text,
  ADD COLUMN IF NOT EXISTS troco_para numeric;

ALTER TABLE public.entregas
  ADD CONSTRAINT entregas_origem_check
  CHECK (origem IN ('manual', 'online'));

-- 5) Permitir que visitantes anônimos criem pedidos delivery online
CREATE POLICY "Anon cria pedidos delivery"
  ON public.pedidos FOR INSERT TO anon
  WITH CHECK (tipo = 'delivery');

CREATE POLICY "Anon cria itens de pedido"
  ON public.pedido_itens FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon cria entregas online"
  ON public.entregas FOR INSERT TO anon
  WITH CHECK (origem = 'online');

-- 6) Realtime para configurações
ALTER PUBLICATION supabase_realtime ADD TABLE public.configuracoes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bairros_taxas;
