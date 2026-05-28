CREATE TABLE public.conta_pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id UUID NOT NULL REFERENCES public.contas(id) ON DELETE CASCADE,
  forma_pagamento public.compra_forma_pagamento NOT NULL,
  valor NUMERIC(10,2) NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conta_pagamentos_conta_id_idx
  ON public.conta_pagamentos(conta_id);
