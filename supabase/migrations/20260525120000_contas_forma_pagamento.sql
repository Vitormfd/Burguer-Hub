ALTER TABLE public.contas
  ADD COLUMN IF NOT EXISTS forma_pagamento public.compra_forma_pagamento;
