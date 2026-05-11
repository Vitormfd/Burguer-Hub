
-- Enums
CREATE TYPE public.mesa_status AS ENUM ('livre', 'ocupada', 'aguardando_pagamento');
CREATE TYPE public.conta_status AS ENUM ('aberta', 'fechada');
CREATE TYPE public.pedido_tipo AS ENUM ('mesa', 'delivery');
CREATE TYPE public.pedido_status AS ENUM ('pendente', 'em_preparo', 'pronto', 'entregue');
CREATE TYPE public.entrega_status AS ENUM ('aguardando', 'saiu_para_entrega', 'entregue');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Categorias
CREATE TABLE public.categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Produtos
CREATE TABLE public.produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria_id UUID REFERENCES public.categorias(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  descricao TEXT,
  preco NUMERIC(10,2) NOT NULL DEFAULT 0,
  disponivel BOOLEAN NOT NULL DEFAULT true,
  imagem_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesas
CREATE TABLE public.mesas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero INTEGER NOT NULL UNIQUE,
  status public.mesa_status NOT NULL DEFAULT 'livre',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contas
CREATE TABLE public.contas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_id UUID REFERENCES public.mesas(id) ON DELETE SET NULL,
  aberta_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  fechada_em TIMESTAMPTZ,
  status public.conta_status NOT NULL DEFAULT 'aberta',
  total NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- Pedidos
CREATE TABLE public.pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id UUID REFERENCES public.contas(id) ON DELETE CASCADE,
  tipo public.pedido_tipo NOT NULL,
  status public.pedido_status NOT NULL DEFAULT 'pendente',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pedido itens
CREATE TABLE public.pedido_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  produto_id UUID REFERENCES public.produtos(id) ON DELETE SET NULL,
  quantidade INTEGER NOT NULL DEFAULT 1,
  preco_unitario NUMERIC(10,2) NOT NULL DEFAULT 0,
  observacao TEXT
);

-- Entregas
CREATE TABLE public.entregas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  cliente_nome TEXT NOT NULL,
  cliente_telefone TEXT NOT NULL,
  endereco TEXT NOT NULL,
  bairro TEXT,
  taxa_entrega NUMERIC(10,2) NOT NULL DEFAULT 0,
  status public.entrega_status NOT NULL DEFAULT 'aguardando'
);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- New user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'nome', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entregas ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Profiles visíveis para autenticados" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuário edita seu próprio perfil" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Usuário insere seu próprio perfil" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Generic authenticated policies for operational tables
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['categorias','produtos','mesas','contas','pedidos','pedido_itens','entregas']) LOOP
    EXECUTE format('CREATE POLICY "Autenticados leem %1$s" ON public.%1$I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "Autenticados inserem %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "Autenticados atualizam %1$s" ON public.%1$I FOR UPDATE TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "Autenticados deletam %1$s" ON public.%1$I FOR DELETE TO authenticated USING (true)', t);
  END LOOP;
END $$;

-- Realtime
ALTER TABLE public.mesas REPLICA IDENTITY FULL;
ALTER TABLE public.contas REPLICA IDENTITY FULL;
ALTER TABLE public.pedidos REPLICA IDENTITY FULL;
ALTER TABLE public.pedido_itens REPLICA IDENTITY FULL;
ALTER TABLE public.entregas REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.mesas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.contas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pedido_itens;
ALTER PUBLICATION supabase_realtime ADD TABLE public.entregas;
