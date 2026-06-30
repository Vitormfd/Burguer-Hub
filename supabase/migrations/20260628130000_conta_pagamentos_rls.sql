-- Pagamentos parciais da mesa: RLS por owner da conta vinculada.

ALTER TABLE public.conta_pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conta_pagamentos_owner_all" ON public.conta_pagamentos;

CREATE POLICY "conta_pagamentos_owner_all"
  ON public.conta_pagamentos
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.contas c
      WHERE c.id = conta_id
        AND c.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.contas c
      WHERE c.id = conta_id
        AND c.owner_id = auth.uid()
    )
  );
