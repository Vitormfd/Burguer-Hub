-- Clientes de outras lojas apareciam na demo (e vice-versa) porque
-- SELECT/UPDATE eram públicos e list_clientes_fidelidade (security definer)
-- listava a tabela inteira.

DROP POLICY IF EXISTS "Autenticados gerenciam clientes" ON public.clientes;
DROP POLICY IF EXISTS "clientes_insert_anon" ON public.clientes;
DROP POLICY IF EXISTS "clientes_select_public" ON public.clientes;
DROP POLICY IF EXISTS "clientes_update_public" ON public.clientes;

CREATE POLICY "clientes_owner_all"
  ON public.clientes FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Checkout público cria/atualiza cliente via RPC security definer.
-- Anon não precisa mais ler nem alterar a tabela direto.

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
  WHERE c.owner_id = auth.uid()
    AND (
      search_term IS NULL
      OR search_term = ''
      OR lower(c.nome) LIKE '%' || lower(search_term) || '%'
      OR c.telefone LIKE '%' || public.normalize_phone(search_term) || '%'
    )
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
  IF NOT EXISTS (
    SELECT 1
    FROM public.clientes c
    WHERE c.id = p_cliente_id
      AND c.owner_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('cliente', NULL, 'pedidos', '[]'::jsonb, 'resgates', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'cliente', (
      SELECT to_jsonb(c)
      FROM public.clientes c
      WHERE c.id = p_cliente_id
        AND c.owner_id = auth.uid()
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
