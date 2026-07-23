import { aplicarAcao } from "./actions";
import { promocaoElegivel } from "./conditions";
import type { AvaliarPromocoesResult, PromoContext, PromoEffect, Promocao } from "./types";

/**
 * Resolve conflitos: promoções NUNCA acumulam.
 * Ganha a de maior prioridade; empate → maior desconto/economia; empate → nome.
 */
export function escolherVencedora(
  candidatas: { promo: Promocao; effect: PromoEffect }[],
): PromoEffect | null {
  if (!candidatas.length) return null;

  const ordered = [...candidatas].sort((a, b) => {
    if (b.promo.prioridade !== a.promo.prioridade) {
      return b.promo.prioridade - a.promo.prioridade;
    }
    if (b.effect.economiaTotal !== a.effect.economiaTotal) {
      return b.effect.economiaTotal - a.effect.economiaTotal;
    }
    if (b.effect.pontosExtra !== a.effect.pontosExtra) {
      return b.effect.pontosExtra - a.effect.pontosExtra;
    }
    return a.promo.nome.localeCompare(b.promo.nome);
  });

  return ordered[0].effect;
}

/**
 * Motor principal: avalia todas as promoções e aplica no máximo uma.
 * Só funciona para delivery.
 */
export function avaliarPromocoes(
  promocoes: Promocao[],
  ctx: PromoContext,
): AvaliarPromocoesResult {
  if (ctx.tipoEntrega !== "delivery") {
    return {
      aplicada: null,
      candidatas: [],
      motivoSemAplicacao: "Promoções disponíveis apenas para delivery",
    };
  }

  if (!ctx.itens.length || ctx.subtotal <= 0) {
    return { aplicada: null, candidatas: [], motivoSemAplicacao: "Carrinho vazio" };
  }

  const candidatas: { promo: Promocao; effect: PromoEffect }[] = [];

  for (const promo of promocoes) {
    if (!promocaoElegivel(promo, ctx)) continue;
    const effect = aplicarAcao(promo, ctx);
    if (!effect) continue;
    // Efeito vazio (sem benefício) não conta
    if (
      effect.desconto <= 0 &&
      effect.descontoFrete <= 0 &&
      !effect.freteGratis &&
      !effect.itensBonus.length &&
      effect.pontosExtra <= 0
    ) {
      continue;
    }
    candidatas.push({ promo, effect });
  }

  const aplicada = escolherVencedora(candidatas);

  return {
    aplicada,
    candidatas: candidatas.map((c) => c.promo.id),
    motivoSemAplicacao: aplicada ? undefined : "Nenhuma promoção elegível",
  };
}
