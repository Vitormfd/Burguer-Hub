CREATE OR REPLACE FUNCTION public.registrar_suprimento_caixa(
  p_caixa_id uuid,
  p_valor numeric,
  p_descricao text DEFAULT NULL
)
RETURNS public.caixa_movimentacoes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.caixa_movimentacoes;
BEGIN
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor do suprimento deve ser maior que zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.caixas c
    WHERE c.id = p_caixa_id
      AND c.owner_id = auth.uid()
      AND c.status = 'aberto'
  ) THEN
    RAISE EXCEPTION 'Caixa não encontrado ou não está aberto';
  END IF;

  INSERT INTO public.caixa_movimentacoes (caixa_id, tipo, valor, descricao)
  VALUES (p_caixa_id, 'suprimento', p_valor, NULLIF(trim(COALESCE(p_descricao, '')), ''))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
