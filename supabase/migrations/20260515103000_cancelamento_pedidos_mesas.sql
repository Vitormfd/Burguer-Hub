ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cancelado_em timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
  ADD COLUMN IF NOT EXISTS cancelado_por text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'tipo_entrega'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.tipo_entrega AS ENUM ('delivery', 'retirada');
  END IF;
END;
$$;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS tipo_entrega public.tipo_entrega NOT NULL DEFAULT 'delivery';

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS retirada_ativa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tempo_estimado_retirada integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS endereco_estabelecimento text;

ALTER TABLE public.pedido_itens
  ADD COLUMN IF NOT EXISTS cancelado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelado_em timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text;

CREATE INDEX IF NOT EXISTS idx_pedido_itens_cancelado_em
  ON public.pedido_itens (cancelado_em)
  WHERE cancelado IS TRUE;

CREATE OR REPLACE FUNCTION public.refresh_conta_total_from_pedido_itens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id uuid;
  v_conta_id uuid;
BEGIN
  v_pedido_id := COALESCE(NEW.pedido_id, OLD.pedido_id);

  SELECT conta_id
  INTO v_conta_id
  FROM public.pedidos
  WHERE id = v_pedido_id;

  IF v_conta_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.contas c
  SET total = COALESCE(calc.total, 0)
  FROM (
    SELECT p.conta_id,
           SUM(pi.quantidade * pi.preco_unitario)::numeric(10,2) AS total
    FROM public.pedidos p
    JOIN public.pedido_itens pi ON pi.pedido_id = p.id
    WHERE p.conta_id = v_conta_id
      AND p.status <> 'cancelado'
      AND p.cancelado_em IS NULL
      AND COALESCE(pi.cancelado, false) = false
    GROUP BY p.conta_id
  ) AS calc
  WHERE c.id = v_conta_id
    AND c.id = calc.conta_id;

  UPDATE public.contas
  SET total = 0
  WHERE id = v_conta_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.pedidos p
      JOIN public.pedido_itens pi ON pi.pedido_id = p.id
      WHERE p.conta_id = v_conta_id
        AND p.status <> 'cancelado'
        AND p.cancelado_em IS NULL
        AND COALESCE(pi.cancelado, false) = false
    );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS pedido_itens_refresh_conta_total ON public.pedido_itens;

CREATE TRIGGER pedido_itens_refresh_conta_total
AFTER INSERT OR UPDATE OR DELETE ON public.pedido_itens
FOR EACH ROW EXECUTE FUNCTION public.refresh_conta_total_from_pedido_itens();
