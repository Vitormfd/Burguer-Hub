import { describe, expect, it } from "vitest";
import { calcularRankingBairros, normalizarBairro, type PedidoBairroInput } from "./bairrosRanking";

const pedido = (id: string, total: number, tipo_entrega: string | null = "delivery"): PedidoBairroInput => ({
  id,
  tipo_entrega,
  total,
  subtotal: null,
  desconto: null,
  valor_desconto: null,
});

describe("normalizarBairro", () => {
  it("ignora maiúsculas, acentos e espaços extras", () => {
    expect(normalizarBairro("  Jardim   São  Paulo ")).toBe("jardim sao paulo");
    expect(normalizarBairro("JARDIM SAO PAULO")).toBe("jardim sao paulo");
    expect(normalizarBairro(null)).toBe("");
  });
});

describe("calcularRankingBairros", () => {
  it("agrupa grafias diferentes e ordena por pedidos", () => {
    const ranking = calcularRankingBairros(
      [pedido("1", 30), pedido("2", 40), pedido("3", 50), pedido("4", 100)],
      [
        { pedido_id: "1", bairro: "Centro", taxa_entrega: 5 },
        { pedido_id: "2", bairro: " centro ", taxa_entrega: 5 },
        { pedido_id: "3", bairro: "CÉNTRO", taxa_entrega: 5 },
        { pedido_id: "4", bairro: "Vila Nova", taxa_entrega: 8 },
      ],
    );

    expect(ranking.bairros).toEqual([
      { chave: "centro", nome: "Centro", pedidos: 3, faturamento: 120 },
      { chave: "vila nova", nome: "Vila Nova", pedidos: 1, faturamento: 100 },
    ]);
  });

  it("deixa retirada de fora e separa entregas sem bairro", () => {
    const ranking = calcularRankingBairros(
      [pedido("1", 30), pedido("2", 25, "retirada"), pedido("3", 45)],
      [
        { pedido_id: "1", bairro: "Centro", taxa_entrega: 0 },
        { pedido_id: "2", bairro: "Centro", taxa_entrega: 0 },
        { pedido_id: "3", bairro: "   ", taxa_entrega: 0 },
      ],
    );

    expect(ranking.bairros).toEqual([{ chave: "centro", nome: "Centro", pedidos: 1, faturamento: 30 }]);
    expect(ranking.semBairro).toEqual({ pedidos: 1, faturamento: 45 });
  });

  it("usa itens + taxa quando o pedido não tem total gravado", () => {
    const ranking = calcularRankingBairros(
      [pedido("1", 0)],
      [{ pedido_id: "1", bairro: "Centro", taxa_entrega: 6 }],
      new Map([["1", 34]]),
    );

    expect(ranking.bairros[0].faturamento).toBe(40);
  });
});
