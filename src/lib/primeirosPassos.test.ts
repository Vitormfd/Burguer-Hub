import { describe, expect, it } from "vitest";
import { formatScheduleRange, getTodaySchedule, lojaAbertaAgora } from "./horarioLoja";
import { passosPrimeiroPedido, type SituacaoLoja } from "./primeirosPassos";

// Como uma conta nova nasce (ver o fluxo de cadastro): sem produto, sem bairro, sem retirada.
const contaNova: SituacaoLoja = {
  temProduto: false,
  temBairro: false,
  retiradaAtiva: false,
  abertaAgora: false,
  horarioHoje: "18:00 - 23:00",
  temPedido: false,
};

const feitos = (s: SituacaoLoja) => passosPrimeiroPedido(s).filter((p) => p.feito).map((p) => p.id);

describe("passos do primeiro pedido", () => {
  it("conta nova começa com tudo por fazer, na ordem certa", () => {
    expect(passosPrimeiroPedido(contaNova).map((p) => p.id)).toEqual(["produto", "entrega", "horario", "pedido"]);
    expect(feitos(contaNova)).toEqual([]);
  });

  it("retirada ou bairro resolvem o passo de entrega", () => {
    expect(feitos({ ...contaNova, retiradaAtiva: true })).toEqual(["entrega"]);
    expect(feitos({ ...contaNova, temBairro: true })).toEqual(["entrega"]);
  });

  it("loja fechada explica o motivo e mostra o horário de hoje", () => {
    const horario = passosPrimeiroPedido(contaNova).find((p) => p.id === "horario")!;
    expect(horario.detalhe).toContain("não aceita pedidos");
    expect(horario.detalhe).toContain("18:00 - 23:00");
  });

  it("com tudo pronto, só falta o pedido", () => {
    expect(feitos({ ...contaNova, temProduto: true, retiradaAtiva: true, abertaAgora: true })).toEqual([
      "produto",
      "entrega",
      "horario",
    ]);
  });
});

describe("horário da loja", () => {
  const padrao = { hora_abertura: "18:00:00", hora_fechamento: "23:00:00", horario_funcionamento: [] };
  // 5/11/2026 é quinta-feira.
  const quinta = (h: number, m = 0) => new Date(2026, 10, 5, h, m);

  it("horário padrão de conta nova: fechada à tarde, aberta à noite", () => {
    expect(lojaAbertaAgora(padrao, quinta(14))).toBe(false);
    expect(lojaAbertaAgora(padrao, quinta(19))).toBe(true);
    expect(formatScheduleRange(getTodaySchedule(padrao, quinta(14)), padrao)).toBe("18:00 - 23:00");
  });

  it("horário que passa da meia-noite", () => {
    const madrugada = { ...padrao, hora_abertura: "18:00", hora_fechamento: "02:00" };
    expect(lojaAbertaAgora(madrugada, quinta(1))).toBe(true);
    expect(lojaAbertaAgora(madrugada, quinta(3))).toBe(false);
  });

  it("dia desligado fica fechado", () => {
    const semQuinta = { ...padrao, horario_funcionamento: [{ dia: 4, ativo: false, abertura: "00:00", fechamento: "23:59" }] };
    expect(lojaAbertaAgora(semQuinta, quinta(19))).toBe(false);
    expect(formatScheduleRange(getTodaySchedule(semQuinta, quinta(19)), semQuinta)).toBe("Fechado");
  });
});
