import { describe, expect, it } from "vitest";
import { aplicarAcao } from "@/lib/promocoes/actions";
import { promocaoElegivel } from "@/lib/promocoes/conditions";
import { avaliarPromocoes, escolherVencedora } from "@/lib/promocoes/engine";
import { emptyEscopo, type PromoContext, type Promocao } from "@/lib/promocoes/types";

const basePromo = (over: Partial<Promocao> & Pick<Promocao, "id" | "nome" | "tipo">): Promocao => ({
  owner_id: "owner-1",
  descricao: null,
  ativo: true,
  prioridade: 0,
  aplica_automaticamente: true,
  necessita_cupom: false,
  codigo_cupom: null,
  data_inicio: null,
  data_fim: null,
  hora_inicio: null,
  hora_fim: null,
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  limite_usos_total: null,
  usos_realizados: 0,
  limite_por_cliente: null,
  condicoes: [],
  acao: {},
  escopo_produtos: emptyEscopo(),
  ...over,
});

const ctxBase = (over: Partial<PromoContext> = {}): PromoContext => ({
  tipoEntrega: "delivery",
  subtotal: 100,
  taxaEntrega: 12,
  formaPagamento: "pix",
  bairro: "Centro",
  itens: [
    { produtoId: "p1", categoriaId: "c1", nome: "Burger", quantidade: 2, precoUnit: 40 },
    { produtoId: "p2", categoriaId: "c2", nome: "Refri", quantidade: 1, precoUnit: 20 },
  ],
  cliente: { totalPedidos: 3, telefone: "11999999999" },
  ...over,
});

describe("promocoes engine — conflitos", () => {
  it("nunca acumula: aplica só a de maior prioridade", () => {
    const baixa = basePromo({
      id: "a",
      nome: "10%",
      tipo: "desconto_percentual",
      prioridade: 1,
      acao: { percentual: 10 },
    });
    const alta = basePromo({
      id: "b",
      nome: "R$20",
      tipo: "desconto_fixo",
      prioridade: 10,
      acao: { valor_fixo: 20 },
    });

    const result = avaliarPromocoes([baixa, alta], ctxBase());
    expect(result.aplicada?.promocaoId).toBe("b");
    expect(result.aplicada?.desconto).toBe(20);
    expect(result.candidatas).toHaveLength(2);
  });

  it("em empate de prioridade, escolhe a de maior economia", () => {
    const a = basePromo({
      id: "a",
      nome: "A",
      tipo: "desconto_percentual",
      prioridade: 5,
      acao: { percentual: 10 },
    });
    const b = basePromo({
      id: "b",
      nome: "B",
      tipo: "desconto_fixo",
      prioridade: 5,
      acao: { valor_fixo: 25 },
    });

    const effect = escolherVencedora([
      { promo: a, effect: aplicarAcao(a, ctxBase())! },
      { promo: b, effect: aplicarAcao(b, ctxBase())! },
    ]);
    expect(effect?.promocaoId).toBe("b");
  });

  it("não aplica em retirada", () => {
    const promo = basePromo({
      id: "a",
      nome: "10%",
      tipo: "desconto_percentual",
      acao: { percentual: 10 },
    });
    const result = avaliarPromocoes([promo], ctxBase({ tipoEntrega: "retirada" }));
    expect(result.aplicada).toBeNull();
    expect(result.motivoSemAplicacao).toMatch(/delivery/i);
  });

  it("respeita valor mínimo", () => {
    const promo = basePromo({
      id: "a",
      nome: "Frete",
      tipo: "frete_gratis",
      acao: { frete: { modo: "gratis" } },
      condicoes: [{ tipo: "valor_minimo", params: { valor: 150 } }],
    });
    expect(promocaoElegivel(promo, ctxBase({ subtotal: 100 }))).toBe(false);
    expect(promocaoElegivel(promo, ctxBase({ subtotal: 150 }))).toBe(true);
  });

  it("cliente novo = 0 pedidos; VIP = total > N", () => {
    const novo = basePromo({
      id: "n",
      nome: "Novo",
      tipo: "desconto_fixo",
      acao: { valor_fixo: 5 },
      condicoes: [{ tipo: "cliente_novo", params: {} }],
    });
    const vip = basePromo({
      id: "v",
      nome: "VIP",
      tipo: "desconto_fixo",
      acao: { valor_fixo: 15 },
      condicoes: [{ tipo: "cliente_vip", params: { min_pedidos: 5 } }],
    });

    expect(promocaoElegivel(novo, ctxBase({ cliente: { totalPedidos: 0 } }))).toBe(true);
    expect(promocaoElegivel(novo, ctxBase({ cliente: { totalPedidos: 1 } }))).toBe(false);
    expect(promocaoElegivel(vip, ctxBase({ cliente: { totalPedidos: 5 } }))).toBe(false);
    expect(promocaoElegivel(vip, ctxBase({ cliente: { totalPedidos: 6 } }))).toBe(true);
  });

  it("cupom de campanha só aplica com código correto", () => {
    const promo = basePromo({
      id: "c",
      nome: "Cupom campanha",
      tipo: "cupom",
      necessita_cupom: true,
      codigo_cupom: "PROMO10",
      aplica_automaticamente: false,
      acao: { cupom_modo: "percentual", percentual: 10 },
    });

    expect(promocaoElegivel(promo, ctxBase())).toBe(false);
    expect(promocaoElegivel(promo, ctxBase({ codigoCupomDigitado: "errado" }))).toBe(false);
    expect(promocaoElegivel(promo, ctxBase({ codigoCupomDigitado: "promo10" }))).toBe(true);
  });

  it("frete grátis zera taxa no efeito", () => {
    const promo = basePromo({
      id: "f",
      nome: "Frete",
      tipo: "frete_gratis",
      acao: { frete: { modo: "gratis" } },
    });
    const effect = aplicarAcao(promo, ctxBase({ taxaEntrega: 12 }));
    expect(effect?.freteGratis).toBe(true);
    expect(effect?.descontoFrete).toBe(12);
  });

  it("pontos extras não geram desconto monetário", () => {
    const promo = basePromo({
      id: "p",
      nome: "Pontos",
      tipo: "pontos",
      acao: { pontos: { extra: 20 } },
    });
    const effect = aplicarAcao(promo, ctxBase());
    expect(effect?.pontosExtra).toBe(20);
    expect(effect?.desconto).toBe(0);
  });

  it("respeita limite de usos totais", () => {
    const promo = basePromo({
      id: "l",
      nome: "Limitada",
      tipo: "desconto_fixo",
      acao: { valor_fixo: 5 },
      limite_usos_total: 10,
      usos_realizados: 10,
    });
    expect(promocaoElegivel(promo, ctxBase())).toBe(false);
  });
});
