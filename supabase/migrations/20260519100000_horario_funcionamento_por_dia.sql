-- Horario de funcionamento por dia da semana no cardapio

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS horario_funcionamento jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Preenche com o horario global atual para manter compatibilidade com lojas existentes
UPDATE public.configuracoes
SET horario_funcionamento = jsonb_build_array(
  jsonb_build_object('dia', 0, 'ativo', true, 'abertura', to_char(hora_abertura, 'HH24:MI:SS'), 'fechamento', to_char(hora_fechamento, 'HH24:MI:SS')),
  jsonb_build_object('dia', 1, 'ativo', true, 'abertura', to_char(hora_abertura, 'HH24:MI:SS'), 'fechamento', to_char(hora_fechamento, 'HH24:MI:SS')),
  jsonb_build_object('dia', 2, 'ativo', true, 'abertura', to_char(hora_abertura, 'HH24:MI:SS'), 'fechamento', to_char(hora_fechamento, 'HH24:MI:SS')),
  jsonb_build_object('dia', 3, 'ativo', true, 'abertura', to_char(hora_abertura, 'HH24:MI:SS'), 'fechamento', to_char(hora_fechamento, 'HH24:MI:SS')),
  jsonb_build_object('dia', 4, 'ativo', true, 'abertura', to_char(hora_abertura, 'HH24:MI:SS'), 'fechamento', to_char(hora_fechamento, 'HH24:MI:SS')),
  jsonb_build_object('dia', 5, 'ativo', true, 'abertura', to_char(hora_abertura, 'HH24:MI:SS'), 'fechamento', to_char(hora_fechamento, 'HH24:MI:SS')),
  jsonb_build_object('dia', 6, 'ativo', true, 'abertura', to_char(hora_abertura, 'HH24:MI:SS'), 'fechamento', to_char(hora_fechamento, 'HH24:MI:SS'))
)
WHERE jsonb_typeof(horario_funcionamento) IS DISTINCT FROM 'array'
   OR jsonb_array_length(horario_funcionamento) = 0;

ALTER TABLE public.configuracoes
  DROP CONSTRAINT IF EXISTS configuracoes_horario_funcionamento_array_check;

ALTER TABLE public.configuracoes
  ADD CONSTRAINT configuracoes_horario_funcionamento_array_check
  CHECK (jsonb_typeof(horario_funcionamento) = 'array');
