DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'cupom_tipo'
  ) THEN
    CREATE TYPE public.cupom_tipo AS ENUM ('percentual', 'fixo', 'frete_gratis');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  descricao text,
  tipo public.cupom_tipo NOT NULL,
  valor numeric(10,2),
  valor_minimo_pedido numeric(10,2) NOT NULL DEFAULT 0,
  limite_usos_total integer,
  usos_realizados integer NOT NULL DEFAULT 0,
  uso_unico_por_cliente boolean NOT NULL DEFAULT true,
  data_inicio date,
  data_expiracao date,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cupons_codigo_upper_check CHECK (codigo = upper(codigo)),
  CONSTRAINT cupons_valor_minimo_check CHECK (valor_minimo_pedido >= 0),
  CONSTRAINT cupons_usos_realizados_check CHECK (usos_realizados >= 0),
  CONSTRAINT cupons_limite_usos_check CHECK (limite_usos_total IS NULL OR limite_usos_total > 0),
  CONSTRAINT cupons_valor_tipo_check CHECK (
    (tipo = 'frete_gratis' AND valor IS NULL) OR
    (tipo <> 'frete_gratis' AND valor IS NOT NULL AND valor >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cupons_codigo_unique ON public.cupons (codigo);
CREATE INDEX IF NOT EXISTS idx_cupons_ativo_datas ON public.cupons (ativo, data_inicio, data_expiracao);
CREATE INDEX IF NOT EXISTS idx_cupons_usos_realizados ON public.cupons (usos_realizados);

CREATE OR REPLACE FUNCTION public.normalize_cupom_codigo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.codigo := upper(trim(COALESCE(NEW.codigo, '')));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cupons_normalize_codigo ON public.cupons;
CREATE TRIGGER cupons_normalize_codigo
BEFORE INSERT OR UPDATE ON public.cupons
FOR EACH ROW EXECUTE FUNCTION public.normalize_cupom_codigo();

CREATE TABLE IF NOT EXISTS public.cupom_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cupom_id uuid NOT NULL REFERENCES public.cupons(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  telefone_cliente text,
  valor_desconto_aplicado numeric(10,2) NOT NULL DEFAULT 0,
  usado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cupom_usos_pedido_unico UNIQUE (pedido_id)
);

CREATE INDEX IF NOT EXISTS idx_cupom_usos_cupom_id ON public.cupom_usos (cupom_id, usado_em DESC);
CREATE INDEX IF NOT EXISTS idx_cupom_usos_cliente_id ON public.cupom_usos (cliente_id, usado_em DESC);
CREATE INDEX IF NOT EXISTS idx_cupom_usos_telefone ON public.cupom_usos (telefone_cliente, usado_em DESC);

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cupom_id uuid REFERENCES public.cupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS valor_desconto numeric(10,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.registrar_uso_cupom(
  p_cupom_id uuid,
  p_pedido_id uuid,
  p_cliente_id uuid DEFAULT NULL,
  p_telefone_cliente text DEFAULT NULL,
  p_valor_desconto_aplicado numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom public.cupons%ROWTYPE;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_telefone text := NULLIF(regexp_replace(COALESCE(p_telefone_cliente, ''), '\D', '', 'g'), '');
BEGIN
  SELECT *
    INTO v_cupom
  FROM public.cupons
  WHERE id = p_cupom_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_cupom.ativo THEN
    RAISE EXCEPTION 'Cupom inválido ou inexistente';
  END IF;

  IF (v_cupom.data_inicio IS NOT NULL AND v_hoje < v_cupom.data_inicio)
     OR (v_cupom.data_expiracao IS NOT NULL AND v_hoje > v_cupom.data_expiracao) THEN
    RAISE EXCEPTION 'Esse cupom expirou';
  END IF;

  IF v_cupom.limite_usos_total IS NOT NULL AND v_cupom.usos_realizados >= v_cupom.limite_usos_total THEN
    RAISE EXCEPTION 'Esse cupom atingiu o limite de usos';
  END IF;

  IF v_cupom.uso_unico_por_cliente AND v_telefone IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.cupom_usos
      WHERE cupom_id = p_cupom_id
        AND telefone_cliente = v_telefone
    ) THEN
      RAISE EXCEPTION 'Você já utilizou esse cupom';
    END IF;
  END IF;

  INSERT INTO public.cupom_usos (
    cupom_id,
    cliente_id,
    pedido_id,
    telefone_cliente,
    valor_desconto_aplicado
  ) VALUES (
    p_cupom_id,
    p_cliente_id,
    p_pedido_id,
    v_telefone,
    GREATEST(COALESCE(p_valor_desconto_aplicado, 0), 0)
  );

  UPDATE public.cupons
  SET usos_realizados = usos_realizados + 1
  WHERE id = p_cupom_id;
END;
$$;

ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupom_usos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cupons visíveis para autenticados" ON public.cupons;
CREATE POLICY "Cupons visíveis para autenticados"
  ON public.cupons FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Cupons administráveis por autenticados" ON public.cupons;
CREATE POLICY "Cupons administráveis por autenticados"
  ON public.cupons FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Cupons atualizáveis por autenticados" ON public.cupons;
CREATE POLICY "Cupons atualizáveis por autenticados"
  ON public.cupons FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Cupons excluíveis por autenticados" ON public.cupons;
CREATE POLICY "Cupons excluíveis por autenticados"
  ON public.cupons FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Usos de cupom visíveis para autenticados" ON public.cupom_usos;
CREATE POLICY "Usos de cupom visíveis para autenticados"
  ON public.cupom_usos FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.aplicar_cupom_checkout(
  p_codigo text,
  p_telefone_cliente text DEFAULT NULL,
  p_subtotal numeric DEFAULT 0,
  p_taxa_entrega numeric DEFAULT 0,
  p_commit boolean DEFAULT false,
  p_pedido_id uuid DEFAULT NULL,
  p_cliente_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cupom public.cupons%ROWTYPE;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_telefone text := NULLIF(regexp_replace(COALESCE(p_telefone_cliente, ''), '\D', '', 'g'), '');
  v_valor_desconto numeric := 0;
BEGIN
  SELECT *
    INTO v_cupom
  FROM public.cupons
  WHERE codigo = upper(trim(COALESCE(p_codigo, '')))
  LIMIT 1;

  IF NOT FOUND OR NOT v_cupom.ativo THEN
    RAISE EXCEPTION 'Cupom inválido ou inexistente';
  END IF;

  IF (v_cupom.data_inicio IS NOT NULL AND v_hoje < v_cupom.data_inicio)
     OR (v_cupom.data_expiracao IS NOT NULL AND v_hoje > v_cupom.data_expiracao) THEN
    RAISE EXCEPTION 'Esse cupom expirou';
  END IF;

  IF v_cupom.limite_usos_total IS NOT NULL AND v_cupom.usos_realizados >= v_cupom.limite_usos_total THEN
    RAISE EXCEPTION 'Esse cupom atingiu o limite de usos';
  END IF;

  IF v_cupom.uso_unico_por_cliente AND v_telefone IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.cupom_usos
      WHERE cupom_id = v_cupom.id
        AND telefone_cliente = v_telefone
    ) THEN
      RAISE EXCEPTION 'Você já utilizou esse cupom';
    END IF;
  END IF;

  IF COALESCE(p_subtotal, 0) < COALESCE(v_cupom.valor_minimo_pedido, 0) THEN
    RAISE EXCEPTION 'Pedido mínimo de R$% para usar esse cupom', to_char(COALESCE(v_cupom.valor_minimo_pedido, 0), 'FM999999990D00');
  END IF;

  v_valor_desconto := CASE
    WHEN v_cupom.tipo = 'percentual' THEN COALESCE(p_subtotal, 0) * (COALESCE(v_cupom.valor, 0) / 100)
    WHEN v_cupom.tipo = 'fixo' THEN COALESCE(v_cupom.valor, 0)
    ELSE COALESCE(p_taxa_entrega, 0)
  END;

  v_valor_desconto := LEAST(GREATEST(v_valor_desconto, 0), GREATEST(COALESCE(p_subtotal, 0) + GREATEST(COALESCE(p_taxa_entrega, 0), 0) - 0.01, 0));

  IF p_commit THEN
    IF p_pedido_id IS NULL THEN
      RAISE EXCEPTION 'Pedido inválido para registrar cupom';
    END IF;

    PERFORM public.registrar_uso_cupom(
      v_cupom.id,
      p_pedido_id,
      p_cliente_id,
      v_telefone,
      v_valor_desconto
    );
  END IF;

  RETURN jsonb_build_object(
    'cupom', jsonb_build_object(
      'id', v_cupom.id,
      'codigo', v_cupom.codigo,
      'descricao', v_cupom.descricao,
      'tipo', v_cupom.tipo,
      'valor', v_cupom.valor,
      'valor_minimo_pedido', v_cupom.valor_minimo_pedido
    ),
    'valor_desconto_aplicado', ROUND(v_valor_desconto::numeric, 2),
    'taxa_entrega_zerada', v_cupom.tipo = 'frete_gratis'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_cupom_checkout(text, text, numeric, numeric, boolean, uuid, uuid) TO anon, authenticated;
