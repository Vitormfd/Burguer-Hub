-- Fix: Fidelidade não estava contando pedidos de mesas
-- Problema 1: Pedidos de mesas não tinham subtotal calculado
-- Problema 2: Ao fechar conta, não havia registro de cliente para fidelidade

-- Criar função para registrar cliente em pedido de mesa (já existente ou novo)
CREATE OR REPLACE FUNCTION public.register_cliente_mesa_pedido(
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
  v_owner_id uuid;
  v_pedido_subtotal numeric(10,2) := 0;
  v_fidelidade_pedido_minimo numeric(10,2) := 0;
BEGIN
  v_phone := public.normalize_phone(p_telefone);
  v_nome := NULLIF(BTRIM(COALESCE(p_nome, '')), '');

  IF v_phone = '' THEN
    RETURN NULL;
  END IF;

  -- Obter owner_id e subtotal do pedido
  SELECT p.owner_id, COALESCE(p.subtotal, p.total, 0)
    INTO v_owner_id, v_pedido_subtotal
  FROM public.pedidos p
  WHERE p.id = p_pedido_id;

  IF v_owner_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Inserir ou atualizar cliente
  INSERT INTO public.clientes (owner_id, nome, telefone)
  VALUES (v_owner_id, COALESCE(v_nome, 'Cliente'), v_phone)
  ON CONFLICT (owner_id, telefone) WHERE owner_id IS NOT NULL
  DO UPDATE SET nome = COALESCE(EXCLUDED.nome, public.clientes.nome)
  RETURNING id INTO v_cliente_id;

  -- Obter mínimo de pedido para fidelidade
  SELECT COALESCE(c.fidelidade_pedido_minimo, 0)
    INTO v_fidelidade_pedido_minimo
  FROM public.configuracoes c
  WHERE c.owner_id = v_owner_id
  ORDER BY c.updated_at DESC
  LIMIT 1;

  -- Atualizar pedido com cliente_id
  UPDATE public.pedidos
  SET cliente_id = v_cliente_id
  WHERE id = p_pedido_id;

  -- Registrar na fidelidade se atender ao mínimo
  IF COALESCE(v_pedido_subtotal, 0) >= GREATEST(COALESCE(v_fidelidade_pedido_minimo, 0), 0) THEN
    INSERT INTO public.cliente_pedidos (cliente_id, pedido_id)
    VALUES (v_cliente_id, p_pedido_id)
    ON CONFLICT (pedido_id) DO UPDATE SET cliente_id = EXCLUDED.cliente_id;
  END IF;

  -- Recalcular totais do cliente
  PERFORM public.refresh_cliente_totals(v_cliente_id);

  RETURN v_cliente_id;
END;
$$;

-- Trigger para recalcular subtotal do pedido quando itens são inseridos/atualizados
CREATE OR REPLACE FUNCTION public.sync_pedido_subtotal_from_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_subtotal numeric(10,2);
BEGIN
  -- Calcular subtotal somando todos os itens + adicionais
  SELECT COALESCE(SUM(
    (pi.quantidade * pi.preco_unitario) + 
    COALESCE((
      SELECT SUM(pia.quantidade * pia.preco_unitario)
      FROM public.pedido_item_adicionais pia
      WHERE pia.pedido_item_id = pi.id
    ), 0)
  ), 0)
    INTO v_pedido_subtotal
  FROM public.pedido_itens pi
  WHERE pi.pedido_id = COALESCE(NEW.pedido_id, OLD.pedido_id)
    AND pi.cancelado = false;

  -- Atualizar subtotal do pedido
  UPDATE public.pedidos
  SET subtotal = v_pedido_subtotal
  WHERE id = COALESCE(NEW.pedido_id, OLD.pedido_id)
    AND tipo = 'mesa';

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_pedido_subtotal_from_items_insert ON public.pedido_itens;
CREATE TRIGGER sync_pedido_subtotal_from_items_insert
AFTER INSERT ON public.pedido_itens
FOR EACH ROW EXECUTE FUNCTION public.sync_pedido_subtotal_from_items();

DROP TRIGGER IF EXISTS sync_pedido_subtotal_from_items_update ON public.pedido_itens;
CREATE TRIGGER sync_pedido_subtotal_from_items_update
AFTER UPDATE ON public.pedido_itens
FOR EACH ROW EXECUTE FUNCTION public.sync_pedido_subtotal_from_items();

DROP TRIGGER IF EXISTS sync_pedido_subtotal_from_adicionais ON public.pedido_item_adicionais;
CREATE TRIGGER sync_pedido_subtotal_from_adicionais
AFTER INSERT OR UPDATE OR DELETE ON public.pedido_item_adicionais
FOR EACH ROW EXECUTE FUNCTION public.sync_pedido_subtotal_from_items();

-- Recalcular subtotal dos pedidos de mesa existentes
UPDATE public.pedidos p
SET subtotal = COALESCE(calc.total, 0)
FROM (
  SELECT pi.pedido_id, SUM(
    (pi.quantidade * pi.preco_unitario) + 
    COALESCE((
      SELECT SUM(pia.quantidade * pia.preco_unitario)
      FROM public.pedido_item_adicionais pia
      WHERE pia.pedido_item_id = pi.id
    ), 0)
  ) as total
  FROM public.pedido_itens pi
  WHERE pi.cancelado = false
  GROUP BY pi.pedido_id
) calc
WHERE p.id = calc.pedido_id
  AND p.tipo = 'mesa'
  AND p.status <> 'cancelado';

GRANT EXECUTE ON FUNCTION public.register_cliente_mesa_pedido(uuid, text, text) TO authenticated;
