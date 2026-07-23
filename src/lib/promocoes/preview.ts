import { PROMOCAO_TIPO_LABELS, type Promocao, type PromocaoCondicao, type PromocaoTipo } from "./types";

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function describeCondicao(c: PromocaoCondicao): string | null {
  const p = c.params || {};
  switch (c.tipo) {
    case "valor_minimo":
    case "pedido_acima":
      return `pedido a partir de ${brl(Number(p.valor || 0))}`;
    case "valor_maximo":
      return `pedido até ${brl(Number(p.valor || 0))}`;
    case "qtd_min_itens":
      return `mín. ${p.quantidade ?? p.valor} itens`;
    case "qtd_max_itens":
      return `máx. ${p.quantidade ?? p.valor} itens`;
    case "primeiro_pedido":
    case "cliente_novo":
      return "primeiro pedido / cliente novo";
    case "cliente_vip":
      return `cliente VIP (> ${p.min_pedidos ?? p.n ?? 5} pedidos)`;
    case "bairro":
      return `bairro: ${Array.isArray(p.nomes) ? p.nomes.join(", ") : p.nome || "?"}`;
    case "forma_pagamento":
      return `pagamento: ${Array.isArray(p.valores) ? p.valores.join(", ") : "?"}`;
    case "contem_produto":
      return "contendo produto(s) específicos";
    case "nao_contem_produto":
      return "sem determinados produtos";
    default:
      return null;
  }
}

function describeAcao(tipo: PromocaoTipo, promo: Promocao): string {
  const a = promo.acao || {};
  switch (tipo) {
    case "desconto_percentual":
      return `${a.percentual ?? 0}% de desconto${a.teto ? ` (teto ${brl(a.teto)})` : ""}`;
    case "desconto_fixo":
      return `${brl(Number(a.valor_fixo || 0))} de desconto`;
    case "frete_gratis":
      return a.frete?.modo === "ate_valor"
        ? `frete subsidiado até ${brl(Number(a.frete.valor_max || 0))}`
        : "frete grátis";
    case "compre_x_leve_y":
      return `compre ${a.compre_x_leve_y?.qtd_compra ?? "X"} e leve bônus`;
    case "brinde":
      return "ganhe brinde(s)";
    case "combo":
      return `combo por ${brl(Number(a.combo?.preco || 0))}`;
    case "desconto_categoria":
      return `${a.desconto_categoria?.percentual ?? 0}% em categorias`;
    case "desconto_produto":
      return a.desconto_produto?.percentual
        ? `${a.desconto_produto.percentual}% em produtos`
        : `desconto fixo em produtos`;
    case "leve_mais_pague_menos": {
      const f = a.leve_mais?.faixas?.[0];
      return f ? `${f.qtd} por ${brl(f.preco)}` : "leve mais pague menos";
    }
    case "pontos":
      return `+${a.pontos?.extra ?? 0} pontos`;
    case "cupom":
      return describeAcao(
        a.cupom_modo === "fixo"
          ? "desconto_fixo"
          : a.cupom_modo === "frete_gratis"
            ? "frete_gratis"
            : a.cupom_modo === "brinde"
              ? "brinde"
              : "desconto_percentual",
        promo,
      );
    default:
      return PROMOCAO_TIPO_LABELS[tipo] || tipo;
  }
}

/** Texto humano para prévia no admin / carrinho. */
export function gerarPreviewPromocao(promo: Partial<Promocao> & { tipo: PromocaoTipo; nome?: string }): string {
  const acaoTxt = describeAcao(promo.tipo, promo as Promocao);
  const conds = (promo.condicoes || [])
    .map(describeCondicao)
    .filter(Boolean) as string[];

  const nome = promo.nome?.trim() || "Esta promoção";
  if (!conds.length) {
    return `${nome}: ${acaoTxt}.`;
  }
  return `${nome}: em pedidos com ${conds.join(", ")}, aplica ${acaoTxt}.`;
}
