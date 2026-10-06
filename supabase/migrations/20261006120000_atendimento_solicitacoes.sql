-- Cliente escolheu "Falar com um atendente" no robo do WhatsApp:
-- vira um aviso no painel (sino + som + notificacao) ate o dono marcar como atendido.
-- Pode rodar de novo sem estragar nada.

CREATE TABLE IF NOT EXISTS public.atendimento_solicitacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  telefone text NOT NULL,
  cliente_nome text,
  status text NOT NULL DEFAULT 'pendente',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atendido_em timestamptz,
  CONSTRAINT atendimento_solicitacoes_status_check CHECK (status IN ('pendente', 'atendido'))
);

-- Um aviso pendente por cliente: se ele pedir de novo, so atualiza o horario.
CREATE UNIQUE INDEX IF NOT EXISTS atendimento_solicitacoes_pendente_unico
  ON public.atendimento_solicitacoes (owner_id, telefone)
  WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_atendimento_solicitacoes_owner
  ON public.atendimento_solicitacoes (owner_id, status, criado_em DESC);

ALTER TABLE public.atendimento_solicitacoes ENABLE ROW LEVEL SECURITY;

-- Insercao so pelo robo (service role). O dono le e marca como atendido.
DROP POLICY IF EXISTS "atendimento_owner_select" ON public.atendimento_solicitacoes;
CREATE POLICY "atendimento_owner_select" ON public.atendimento_solicitacoes FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "atendimento_owner_update" ON public.atendimento_solicitacoes;
CREATE POLICY "atendimento_owner_update" ON public.atendimento_solicitacoes FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'atendimento_solicitacoes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.atendimento_solicitacoes;
  END IF;
END $$;
