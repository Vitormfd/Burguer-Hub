-- Categorias: campos para destaque visual no cardapio publico
ALTER TABLE public.categorias
  ADD COLUMN IF NOT EXISTS destaque boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emoji text;

-- Grupos de adicionais
CREATE TABLE IF NOT EXISTS public.grupos_adicionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  obrigatorio boolean NOT NULL DEFAULT false,
  min_escolhas integer NOT NULL DEFAULT 0,
  max_escolhas integer NOT NULL DEFAULT 1,
  ordem integer NOT NULL DEFAULT 0,
  disponivel boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grupos_adicionais_escolhas_validas CHECK (min_escolhas >= 0 AND max_escolhas >= 1 AND min_escolhas <= max_escolhas)
);

-- Itens de adicional
CREATE TABLE IF NOT EXISTS public.adicionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL REFERENCES public.grupos_adicionais(id) ON DELETE CASCADE,
  nome text NOT NULL,
  preco numeric(10,2) NOT NULL DEFAULT 0,
  disponivel boolean NOT NULL DEFAULT true,
  imagem_url text,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Vinculo produto -> grupos
CREATE TABLE IF NOT EXISTS public.produto_grupos_adicionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  grupo_id uuid NOT NULL REFERENCES public.grupos_adicionais(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT produto_grupo_unico UNIQUE (produto_id, grupo_id)
);

-- Itens de adicional escolhidos por pedido_item
CREATE TABLE IF NOT EXISTS public.pedido_item_adicionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_item_id uuid NOT NULL REFERENCES public.pedido_itens(id) ON DELETE CASCADE,
  adicional_id uuid NOT NULL REFERENCES public.adicionais(id) ON DELETE RESTRICT,
  quantidade integer NOT NULL DEFAULT 1,
  preco_unitario numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pedido_item_adicionais_qtd_positiva CHECK (quantidade > 0)
);

CREATE INDEX IF NOT EXISTS idx_adicionais_grupo_ordem
  ON public.adicionais (grupo_id, ordem, nome);

CREATE INDEX IF NOT EXISTS idx_produto_grupos_produto_ordem
  ON public.produto_grupos_adicionais (produto_id, ordem);

CREATE INDEX IF NOT EXISTS idx_pedido_item_adicionais_item
  ON public.pedido_item_adicionais (pedido_item_id);

ALTER TABLE public.grupos_adicionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adicionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produto_grupos_adicionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_item_adicionais ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'grupos_adicionais' AND policyname = 'Leitura publica grupos adicionais'
  ) THEN
    CREATE POLICY "Leitura publica grupos adicionais"
      ON public.grupos_adicionais FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'adicionais' AND policyname = 'Leitura publica adicionais'
  ) THEN
    CREATE POLICY "Leitura publica adicionais"
      ON public.adicionais FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'produto_grupos_adicionais' AND policyname = 'Leitura publica produto grupos adicionais'
  ) THEN
    CREATE POLICY "Leitura publica produto grupos adicionais"
      ON public.produto_grupos_adicionais FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pedido_item_adicionais' AND policyname = 'Autenticados gerenciam pedido item adicionais'
  ) THEN
    CREATE POLICY "Autenticados gerenciam pedido item adicionais"
      ON public.pedido_item_adicionais FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pedido_item_adicionais' AND policyname = 'Anon cria pedido item adicionais'
  ) THEN
    CREATE POLICY "Anon cria pedido item adicionais"
      ON public.pedido_item_adicionais FOR INSERT TO anon WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'grupos_adicionais' AND policyname = 'Autenticados gerenciam grupos adicionais'
  ) THEN
    CREATE POLICY "Autenticados gerenciam grupos adicionais"
      ON public.grupos_adicionais FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'adicionais' AND policyname = 'Autenticados gerenciam adicionais'
  ) THEN
    CREATE POLICY "Autenticados gerenciam adicionais"
      ON public.adicionais FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'produto_grupos_adicionais' AND policyname = 'Autenticados gerenciam produto grupos adicionais'
  ) THEN
    CREATE POLICY "Autenticados gerenciam produto grupos adicionais"
      ON public.produto_grupos_adicionais FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.grupos_adicionais;
ALTER PUBLICATION supabase_realtime ADD TABLE public.adicionais;
ALTER PUBLICATION supabase_realtime ADD TABLE public.produto_grupos_adicionais;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pedido_item_adicionais;
