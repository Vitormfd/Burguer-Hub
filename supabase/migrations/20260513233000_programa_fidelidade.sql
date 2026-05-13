DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'recompensa_tipo'
  ) THEN
    CREATE TYPE public.recompensa_tipo AS ENUM ('item_gratis', 'desconto_percentual', 'desconto_fixo');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'resgate_status'
  ) THEN
    CREATE TYPE public.resgate_status AS ENUM ('pendente', 'aplicado', 'cancelado');
  END IF;
END $$;

ALTER TYPE public.pedido_status ADD VALUE IF NOT EXISTS 'cancelado';

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS referencia text,
  ADD COLUMN IF NOT EXISTS fidelidade_ativa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fidelidade_texto text NOT NULL DEFAULT 'A cada 10 pedidos, ganhe uma recompensa!';

CREATE TABLE IF NOT EXISTS public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  telefone text NOT NULL UNIQUE,
  total_pedidos integer NOT NULL DEFAULT 0,
  pontos integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recompensas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  tipo public.recompensa_tipo NOT NULL,
  valor numeric(10,2) NOT NULL DEFAULT 0,
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  pedidos_necessarios integer NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  imagem_url text,
  ordem integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recompensas_pedidos_necessarios_check CHECK (pedidos_necessarios > 0),
  CONSTRAINT recompensas_valor_check CHECK (valor >= 0)
);

CREATE TABLE IF NOT EXISTS public.cliente_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_pedidos_unico UNIQUE (cliente_id, pedido_id),
  CONSTRAINT cliente_pedidos_pedido_unico UNIQUE (pedido_id)
);

CREATE TABLE IF NOT EXISTS public.resgates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  recompensa_id uuid NOT NULL REFERENCES public.recompensas(id) ON DELETE RESTRICT,
  pedido_id uuid REFERENCES public.pedidos(id) ON DELETE SET NULL,
  resgatado_em timestamptz NOT NULL DEFAULT now(),
  status public.resgate_status NOT NULL DEFAULT 'pendente'
);

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtotal numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recompensa_resgatada_id uuid,
  ADD COLUMN IF NOT EXISTS observacoes_internas text;

ALTER TABLE public.pedidos
  DROP CONSTRAINT IF EXISTS pedidos_recompensa_resgatada_id_fkey;

ALTER TABLE public.pedidos
  ADD CONSTRAINT pedidos_recompensa_resgatada_id_fkey
  FOREIGN KEY (recompensa_resgatada_id) REFERENCES public.resgates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON public.clientes(telefone);
CREATE INDEX IF NOT EXISTS idx_recompensas_ativas_ordem ON public.recompensas(ativo, ordem, pedidos_necessarios);
CREATE INDEX IF NOT EXISTS idx_resgates_cliente_status ON public.resgates(cliente_id, status);
CREATE INDEX IF NOT EXISTS idx_cliente_pedidos_cliente ON public.cliente_pedidos(cliente_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON public.pedidos(cliente_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.normalize_phone(phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.refresh_cliente_totals(p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pedidos_validos integer;
  resgates_aplicados integer;
BEGIN
  IF p_cliente_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::integer
    INTO pedidos_validos
  FROM public.cliente_pedidos cp
  JOIN public.pedidos p ON p.id = cp.pedido_id
  WHERE cp.cliente_id = p_cliente_id
    AND p.status::text <> 'cancelado';

  SELECT COUNT(*)::integer
    INTO resgates_aplicados
  FROM public.resgates r
  WHERE r.cliente_id = p_cliente_id
    AND r.status = 'aplicado';

  UPDATE public.clientes
  SET total_pedidos = COALESCE(pedidos_validos, 0),
      pontos = GREATEST(COALESCE(pedidos_validos, 0) - COALESCE(resgates_aplicados, 0), 0)
  WHERE id = p_cliente_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_cliente_totals_from_relacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_cliente_totals(COALESCE(NEW.cliente_id, OLD.cliente_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS cliente_pedidos_refresh_totals ON public.cliente_pedidos;
CREATE TRIGGER cliente_pedidos_refresh_totals
AFTER INSERT OR DELETE OR UPDATE OF cliente_id ON public.cliente_pedidos
FOR EACH ROW EXECUTE FUNCTION public.sync_cliente_totals_from_relacao();

CREATE OR REPLACE FUNCTION public.sync_cliente_totals_from_resgate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_cliente_totals(COALESCE(NEW.cliente_id, OLD.cliente_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS resgates_refresh_totals ON public.resgates;
CREATE TRIGGER resgates_refresh_totals
AFTER INSERT OR UPDATE OF status, cliente_id OR DELETE ON public.resgates
FOR EACH ROW EXECUTE FUNCTION public.sync_cliente_totals_from_resgate();

CREATE OR REPLACE FUNCTION public.sync_cliente_totals_from_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid;
BEGIN
  SELECT cp.cliente_id
    INTO v_cliente_id
  FROM public.cliente_pedidos cp
  WHERE cp.pedido_id = COALESCE(NEW.id, OLD.id)
  LIMIT 1;

  PERFORM public.refresh_cliente_totals(v_cliente_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS pedidos_refresh_cliente_totals ON public.pedidos;
CREATE TRIGGER pedidos_refresh_cliente_totals
AFTER UPDATE OF status ON public.pedidos
FOR EACH ROW EXECUTE FUNCTION public.sync_cliente_totals_from_pedido();

CREATE OR REPLACE FUNCTION public.register_cliente_pedido(
  p_pedido_id uuid,
  p_nome text,
  p_telefone text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_id uuid;
  v_phone text;
  v_nome text;
BEGIN
  v_phone := public.normalize_phone(p_telefone);
  v_nome := NULLIF(BTRIM(COALESCE(p_nome, '')), '');

  IF v_phone = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.clientes (nome, telefone)
  VALUES (COALESCE(v_nome, 'Cliente'), v_phone)
  ON CONFLICT (telefone)
  DO UPDATE SET nome = COALESCE(EXCLUDED.nome, public.clientes.nome)
  RETURNING id INTO v_cliente_id;

  INSERT INTO public.cliente_pedidos (cliente_id, pedido_id)
  VALUES (v_cliente_id, p_pedido_id)
  ON CONFLICT (pedido_id) DO UPDATE SET cliente_id = EXCLUDED.cliente_id;

  UPDATE public.pedidos
  SET cliente_id = v_cliente_id
  WHERE id = p_pedido_id;

  PERFORM public.refresh_cliente_totals(v_cliente_id);

  RETURN v_cliente_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cliente_fidelidade(p_telefone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_cliente public.clientes%ROWTYPE;
BEGIN
  v_phone := public.normalize_phone(p_telefone);

  IF v_phone = '' THEN
    RETURN jsonb_build_object('cliente', NULL, 'recompensas', '[]'::jsonb, 'resgates_pendentes', '[]'::jsonb);
  END IF;

  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE telefone = v_phone;

  RETURN jsonb_build_object(
    'cliente', CASE WHEN v_cliente.id IS NULL THEN NULL ELSE to_jsonb(v_cliente) END,
    'recompensas', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.ordem, r.pedidos_necessarios, r.nome), '[]'::jsonb)
      FROM public.recompensas r
      WHERE r.ativo = true
    ),
    'resgates_pendentes', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', rg.id,
          'recompensa_id', rg.recompensa_id,
          'pedido_id', rg.pedido_id,
          'status', rg.status,
          'nome', rc.nome,
          'descricao', rc.descricao,
          'tipo', rc.tipo,
          'valor', rc.valor,
          'produto_id', rc.produto_id
        )
        ORDER BY rg.resgatado_em DESC
      ), '[]'::jsonb)
      FROM public.resgates rg
      JOIN public.recompensas rc ON rc.id = rg.recompensa_id
      WHERE rg.cliente_id = v_cliente.id
        AND rg.status = 'pendente'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_clientes_fidelidade(search_term text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  nome text,
  telefone text,
  total_pedidos integer,
  pontos integer,
  resgates_realizados bigint,
  ultimo_pedido timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.nome,
    c.telefone,
    c.total_pedidos,
    c.pontos,
    COUNT(r.id) FILTER (WHERE r.status = 'aplicado') AS resgates_realizados,
    MAX(p.criado_em) AS ultimo_pedido
  FROM public.clientes c
  LEFT JOIN public.resgates r ON r.cliente_id = c.id
  LEFT JOIN public.cliente_pedidos cp ON cp.cliente_id = c.id
  LEFT JOIN public.pedidos p ON p.id = cp.pedido_id
  WHERE search_term IS NULL
    OR search_term = ''
    OR lower(c.nome) LIKE '%' || lower(search_term) || '%'
    OR c.telefone LIKE '%' || public.normalize_phone(search_term) || '%'
  GROUP BY c.id, c.nome, c.telefone, c.total_pedidos, c.pontos
  ORDER BY MAX(p.criado_em) DESC NULLS LAST, c.nome;
$$;

CREATE OR REPLACE FUNCTION public.get_cliente_fidelidade_detalhe(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'cliente', (
      SELECT to_jsonb(c)
      FROM public.clientes c
      WHERE c.id = p_cliente_id
    ),
    'pedidos', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'pedido_id', p.id,
          'tipo', p.tipo,
          'status', p.status,
          'subtotal', p.subtotal,
          'desconto', p.desconto,
          'total', p.total,
          'criado_em', p.criado_em
        ) ORDER BY p.criado_em DESC
      ), '[]'::jsonb)
      FROM public.cliente_pedidos cp
      JOIN public.pedidos p ON p.id = cp.pedido_id
      WHERE cp.cliente_id = p_cliente_id
    ),
    'resgates', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'status', r.status,
          'resgatado_em', r.resgatado_em,
          'pedido_id', r.pedido_id,
          'recompensa_nome', rc.nome,
          'tipo', rc.tipo,
          'valor', rc.valor
        ) ORDER BY r.resgatado_em DESC
      ), '[]'::jsonb)
      FROM public.resgates r
      JOIN public.recompensas rc ON rc.id = r.recompensa_id
      WHERE r.cliente_id = p_cliente_id
    )
  );
END;
$$;

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recompensas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resgates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_pedidos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clientes' AND policyname = 'Autenticados gerenciam clientes'
  ) THEN
    CREATE POLICY "Autenticados gerenciam clientes"
      ON public.clientes FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recompensas' AND policyname = 'Autenticados gerenciam recompensas'
  ) THEN
    CREATE POLICY "Autenticados gerenciam recompensas"
      ON public.recompensas FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resgates' AND policyname = 'Autenticados gerenciam resgates'
  ) THEN
    CREATE POLICY "Autenticados gerenciam resgates"
      ON public.resgates FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cliente_pedidos' AND policyname = 'Autenticados gerenciam cliente pedidos'
  ) THEN
    CREATE POLICY "Autenticados gerenciam cliente pedidos"
      ON public.cliente_pedidos FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recompensas' AND policyname = 'Anon le recompensas ativas'
  ) THEN
    CREATE POLICY "Anon le recompensas ativas"
      ON public.recompensas FOR SELECT TO anon USING (ativo = true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clientes' AND policyname = 'Anon insere clientes'
  ) THEN
    CREATE POLICY "Anon insere clientes"
      ON public.clientes FOR INSERT TO anon WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cliente_pedidos' AND policyname = 'Anon insere cliente pedidos'
  ) THEN
    CREATE POLICY "Anon insere cliente pedidos"
      ON public.cliente_pedidos FOR INSERT TO anon WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'resgates' AND policyname = 'Anon insere resgates pendentes'
  ) THEN
    CREATE POLICY "Anon insere resgates pendentes"
      ON public.resgates FOR INSERT TO anon WITH CHECK (status = 'pendente');
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.register_cliente_pedido(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cliente_fidelidade(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_clientes_fidelidade(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cliente_fidelidade_detalhe(uuid) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.clientes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recompensas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.resgates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cliente_pedidos;

UPDATE public.clientes c
SET telefone = public.normalize_phone(c.telefone)
WHERE c.telefone <> public.normalize_phone(c.telefone);

UPDATE public.pedidos p
SET subtotal = COALESCE(itens.subtotal, 0),
    desconto = COALESCE(p.desconto, 0),
    total = COALESCE(itens.subtotal, 0) - COALESCE(p.desconto, 0)
FROM (
  SELECT pedido_id, SUM(quantidade * preco_unitario)::numeric(10,2) AS subtotal
  FROM public.pedido_itens
  GROUP BY pedido_id
) itens
WHERE p.id = itens.pedido_id;