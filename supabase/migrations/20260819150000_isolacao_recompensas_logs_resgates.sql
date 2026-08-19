-- Auditoria de vazamento entre lojas (mesmo padrão de cupons/clientes/adicionais):
-- policies antigas USING (true) continuam ativas em OR com as de owner.
-- Recompensas da demo apareciam no painel de outras contas.
-- Logs de WhatsApp listavam telefones/mensagens de todas as lojas.

-- ---------------------------------------------------------------------------
-- 1) Recompensas
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Autenticados gerenciam recompensas" ON public.recompensas;
DROP POLICY IF EXISTS "recompensas_owner_isolation" ON public.recompensas;

CREATE POLICY "recompensas_owner_all"
  ON public.recompensas FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Cardápio público continua lendo recompensas ativas da loja (filtro owner_id no front).
DROP POLICY IF EXISTS "Anon le recompensas ativas" ON public.recompensas;
DROP POLICY IF EXISTS "recompensas_anon_select" ON public.recompensas;
CREATE POLICY "recompensas_anon_select"
  ON public.recompensas FOR SELECT TO anon
  USING (ativo = true AND owner_id IS NOT NULL);

-- RPC pública não deve devolver recompensa órfã (owner_id nulo) de outra loja.
CREATE OR REPLACE FUNCTION public.get_cliente_fidelidade(
  p_owner_id uuid,
  p_telefone text
)
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

  IF p_owner_id IS NULL OR v_phone = '' THEN
    RETURN jsonb_build_object('cliente', NULL, 'recompensas', '[]'::jsonb, 'resgates_pendentes', '[]'::jsonb);
  END IF;

  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE owner_id = p_owner_id
    AND telefone = v_phone;

  RETURN jsonb_build_object(
    'cliente', CASE WHEN v_cliente.id IS NULL THEN NULL ELSE to_jsonb(v_cliente) END,
    'recompensas', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.ordem, r.pedidos_necessarios, r.nome), '[]'::jsonb)
      FROM public.recompensas r
      WHERE r.ativo = true
        AND r.owner_id = p_owner_id
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
        AND rc.owner_id = p_owner_id
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Resgates e vínculo cliente↔pedido
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Autenticados gerenciam resgates" ON public.resgates;
DROP POLICY IF EXISTS "resgates_owner_all" ON public.resgates;

CREATE POLICY "resgates_owner_all"
  ON public.resgates FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.clientes c
      WHERE c.id = resgates.cliente_id
        AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.clientes c
      WHERE c.id = resgates.cliente_id
        AND c.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Autenticados gerenciam cliente pedidos" ON public.cliente_pedidos;
DROP POLICY IF EXISTS "cliente_pedidos_owner_all" ON public.cliente_pedidos;

CREATE POLICY "cliente_pedidos_owner_all"
  ON public.cliente_pedidos FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.clientes c
      WHERE c.id = cliente_pedidos.cliente_id
        AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.clientes c
      WHERE c.id = cliente_pedidos.cliente_id
        AND c.owner_id = auth.uid()
    )
  );

-- Checkout público usa RPC security definer; insert direto anon abria a tabela.
DROP POLICY IF EXISTS "Anon insere cliente pedidos" ON public.cliente_pedidos;
DROP POLICY IF EXISTS "Anon insere resgates pendentes" ON public.resgates;

-- ---------------------------------------------------------------------------
-- 3) Logs de WhatsApp (telefones e mensagens de outras lojas)
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_logs
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

UPDATE public.whatsapp_logs wl
SET owner_id = p.owner_id
FROM public.pedidos p
WHERE wl.pedido_id = p.id
  AND wl.owner_id IS NULL
  AND p.owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_owner_enviado
  ON public.whatsapp_logs (owner_id, enviado_em DESC);

CREATE OR REPLACE FUNCTION public.set_whatsapp_log_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL AND NEW.pedido_id IS NOT NULL THEN
    SELECT p.owner_id INTO NEW.owner_id
    FROM public.pedidos p
    WHERE p.id = NEW.pedido_id;
  END IF;

  IF NEW.owner_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.owner_id := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_logs_set_owner ON public.whatsapp_logs;
CREATE TRIGGER whatsapp_logs_set_owner
BEFORE INSERT ON public.whatsapp_logs
FOR EACH ROW EXECUTE FUNCTION public.set_whatsapp_log_owner();

DROP POLICY IF EXISTS "whatsapp_logs_select" ON public.whatsapp_logs;
DROP POLICY IF EXISTS "whatsapp_logs_insert" ON public.whatsapp_logs;
DROP POLICY IF EXISTS "whatsapp_logs_owner_all" ON public.whatsapp_logs;

CREATE POLICY "whatsapp_logs_owner_all"
  ON public.whatsapp_logs FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4) Adicionais gravados em itens de pedido
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Autenticados gerenciam pedido item adicionais" ON public.pedido_item_adicionais;
DROP POLICY IF EXISTS "pedido_item_adicionais_owner_all" ON public.pedido_item_adicionais;

CREATE POLICY "pedido_item_adicionais_owner_all"
  ON public.pedido_item_adicionais FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.pedido_itens pi
      WHERE pi.id = pedido_item_adicionais.pedido_item_id
        AND pi.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.pedido_itens pi
      WHERE pi.id = pedido_item_adicionais.pedido_item_id
        AND pi.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Promoções ativas: autenticado só vê as da própria loja
--    (anon continua lendo ativas no cardápio público, filtrado por owner_id no front)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "promocoes_select_ativas_public" ON public.promocoes;
CREATE POLICY "promocoes_select_ativas_public"
  ON public.promocoes FOR SELECT TO anon
  USING (ativo = true);
