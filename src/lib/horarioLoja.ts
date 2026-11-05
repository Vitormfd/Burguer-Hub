// Horário de funcionamento da loja: mesma regra no cardápio público (aberta/fechada) e no
// guia de primeiros passos do painel.
import type { Configuracao, HorarioFuncionamentoDia } from "@/types/db";

type ConfigHorario = Pick<Configuracao, "hora_abertura" | "hora_fechamento" | "horario_funcionamento">;

export const normalizeTimeHHMM = (value?: string | null) => {
  if (!value) return "00:00";
  return value.slice(0, 5);
};

const toMinutes = (hhmm: string) => {
  const [h, m] = normalizeTimeHHMM(hhmm).split(":").map(Number);
  return h * 60 + m;
};

export const getWeeklySchedule = (cfg: ConfigHorario): HorarioFuncionamentoDia[] => {
  const fallbackAbertura = normalizeTimeHHMM(cfg.hora_abertura);
  const fallbackFechamento = normalizeTimeHHMM(cfg.hora_fechamento);
  const byDay = new Map<number, HorarioFuncionamentoDia>();

  if (Array.isArray(cfg.horario_funcionamento)) {
    for (const raw of cfg.horario_funcionamento) {
      if (!raw || typeof raw !== "object") continue;
      const dia = Number((raw as { dia?: unknown }).dia);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6) continue;
      byDay.set(dia, {
        dia,
        ativo: Boolean((raw as { ativo?: unknown }).ativo),
        abertura: normalizeTimeHHMM((raw as { abertura?: string }).abertura) || fallbackAbertura,
        fechamento: normalizeTimeHHMM((raw as { fechamento?: string }).fechamento) || fallbackFechamento,
      });
    }
  }

  return [0, 1, 2, 3, 4, 5, 6].map((dia) => {
    return byDay.get(dia) ?? {
      dia,
      ativo: true,
      abertura: fallbackAbertura,
      fechamento: fallbackFechamento,
    };
  });
};

export const getTodaySchedule = (cfg: ConfigHorario, date = new Date()) => {
  const dia = date.getDay();
  return getWeeklySchedule(cfg).find((item) => item.dia === dia) ?? null;
};

export const formatScheduleRange = (item: HorarioFuncionamentoDia | null, cfg: ConfigHorario) => {
  if (!item) {
    return `${normalizeTimeHHMM(cfg.hora_abertura)} - ${normalizeTimeHHMM(cfg.hora_fechamento)}`;
  }
  if (!item.ativo) return "Fechado";
  return `${normalizeTimeHHMM(item.abertura)} - ${normalizeTimeHHMM(item.fechamento)}`;
};

/** Aberta no horário do dia, inclusive quando o horário passa da meia-noite. */
export const lojaAbertaAgora = (cfg: ConfigHorario, now = new Date()) => {
  const today = getTodaySchedule(cfg, now);
  if (!today || !today.ativo) return false;

  const cur = now.getHours() * 60 + now.getMinutes();
  const ini = toMinutes(today.abertura);
  const fim = toMinutes(today.fechamento);
  return fim > ini ? cur >= ini && cur <= fim : cur >= ini || cur <= fim;
};
