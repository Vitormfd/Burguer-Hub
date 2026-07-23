import { itensNoEscopo, subtotalEscopo } from "./conditions";
import type {
  PromoCartItem,
  PromoContext,
  PromoEffect,
  PromoItemBonus,
  Promocao,
  PromocaoAcao,
  PromocaoTipo,
} from "./types";

function round2(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

function buildBaseEffect(
  promo: Promocao,
  partial: Partial<PromoEffect> & { resumo: string },
): PromoEffect {
  const desconto = round2(partial.desconto ?? 0);
  const descontoFrete = round2(partial.descontoFrete ?? 0);
  const freteGratis = Boolean(partial.freteGratis);
  const itensBonus = partial.itensBonus ?? [];
  const pontosExtra = partial.pontosExtra ?? 0;

  return {
    promocaoId: promo.id,
    nome: promo.nome,
    tipo: promo.tipo,
    desconto,
    freteGratis,
    descontoFrete,
    pontosExtra,
    itensBonus,
    economiaTotal: round2(desconto + descontoFrete),
    resumo: partial.resumo,
    meta: partial.meta ?? {},
  };
}

type ActionHandler = (promo: Promocao, ctx: PromoContext, acao: PromocaoAcao) => PromoEffect | null;

function descontoPercentualPedido(
  promo: Promocao,
  ctx: PromoContext,
  percentual: number,
  teto?: number,
): PromoEffect | null {
  const base = subtotalEscopo(ctx.itens, promo.escopo_produtos);
  if (base <= 0) return null;
  let desconto = (base * percentual) / 100;
  if (teto != null && teto > 0) desconto = Math.min(desconto, teto);
  desconto = Math.min(desconto, ctx.subtotal);
  if (desconto <= 0) return null;
  return buildBaseEffect(promo, {
    desconto,
    resumo: `${percentual}% de desconto (− R$ ${desconto.toFixed(2).replace(".", ",")})`,
    meta: { percentual, base },
  });
}

function descontoFixoPedido(promo: Promocao, ctx: PromoContext, valor: number): PromoEffect | null {
  const base = subtotalEscopo(ctx.itens, promo.escopo_produtos);
  if (base <= 0 && promo.escopo_produtos.modo !== "todos") return null;
  const desconto = Math.min(valor, ctx.subtotal);
  if (desconto <= 0) return null;
  return buildBaseEffect(promo, {
    desconto,
    resumo: `R$ ${desconto.toFixed(2).replace(".", ",")} de desconto`,
    meta: { valor_fixo: valor },
  });
}

function freteHandler(promo: Promocao, ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const frete = acao.frete ?? { modo: "gratis" as const };
  const taxa = Math.max(ctx.taxaEntrega, 0);
  if (taxa <= 0) {
    return buildBaseEffect(promo, {
      freteGratis: true,
      descontoFrete: 0,
      resumo: "Frete grátis",
      meta: { frete },
    });
  }
  if (frete.modo === "ate_valor") {
    const max = Number(frete.valor_max || 0);
    const descontoFrete = Math.min(taxa, Math.max(max, 0));
    if (descontoFrete <= 0) return null;
    const freteGratis = descontoFrete >= taxa;
    return buildBaseEffect(promo, {
      freteGratis,
      descontoFrete,
      resumo: freteGratis
        ? "Frete grátis"
        : `Desconto de R$ ${descontoFrete.toFixed(2).replace(".", ",")} no frete`,
      meta: { frete },
    });
  }
  return buildBaseEffect(promo, {
    freteGratis: true,
    descontoFrete: taxa,
    resumo: "Frete grátis",
    meta: { frete },
  });
}

function compreXLeveY(promo: Promocao, ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const cfg = acao.compre_x_leve_y;
  if (!cfg?.produto_id || !cfg.produto_bonus_id) return null;
  const qtdCompra = Math.max(1, Number(cfg.qtd_compra || 1));
  const qtdBonusUnit = Math.max(1, Number(cfg.qtd_bonus || 1));
  const qtdNoCarrinho = ctx.itens
    .filter((i) => i.produtoId === cfg.produto_id)
    .reduce((s, i) => s + i.quantidade, 0);
  const ciclos = Math.floor(qtdNoCarrinho / qtdCompra);
  if (ciclos <= 0) return null;

  const qtdBonus = ciclos * qtdBonusUnit;
  const bonusItem = ctx.itens.find((i) => i.produtoId === cfg.produto_bonus_id);
  const precoBonus = bonusItem?.precoUnit ?? 0;

  // Se o brinde é o mesmo produto e já está no carrinho além do X, desconta o Y;
  // senão adiciona item bônus gratuito.
  const mesmoProduto = cfg.produto_id === cfg.produto_bonus_id;
  let desconto = 0;
  const itensBonus: PromoItemBonus[] = [];

  if (mesmoProduto) {
    // A cada qtd_compra, ganha qtd_bonus grátis (desconta se já estiver no carrinho; senão adiciona).
    const potencialGratis = ciclos * qtdBonusUnit;
    const extrasNoCarrinho = Math.max(qtdNoCarrinho - ciclos * qtdCompra, 0);
    const descontarDoCarrinho = Math.min(potencialGratis, extrasNoCarrinho);
    desconto = round2(descontarDoCarrinho * precoBonus);
    const faltaAdicionar = potencialGratis - descontarDoCarrinho;
    if (faltaAdicionar > 0) {
      itensBonus.push({
        produtoId: cfg.produto_bonus_id,
        quantidade: faltaAdicionar,
        motivo: promo.nome,
      });
    }
    if (desconto <= 0 && !itensBonus.length) {
      itensBonus.push({
        produtoId: cfg.produto_bonus_id,
        quantidade: potencialGratis,
        motivo: promo.nome,
      });
    }
  } else {
    itensBonus.push({
      produtoId: cfg.produto_bonus_id,
      quantidade: qtdBonus,
      motivo: promo.nome,
    });
    if (bonusItem) {
      const qtdBonusNoCart = ctx.itens
        .filter((i) => i.produtoId === cfg.produto_bonus_id)
        .reduce((s, i) => s + i.quantidade, 0);
      desconto = round2(Math.min(qtdBonus, qtdBonusNoCart) * precoBonus);
      if (qtdBonus <= qtdBonusNoCart) {
        itensBonus.length = 0;
      }
    }
  }

  return buildBaseEffect(promo, {
    desconto,
    itensBonus,
    resumo: `Compre ${qtdCompra} leve ${qtdCompra + qtdBonusUnit}`,
    meta: { compre_x_leve_y: cfg, ciclos },
  });
}

function brindeHandler(promo: Promocao, _ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const cfg = acao.brinde;
  if (!cfg?.produto_ids?.length) return null;
  const qtd = Math.max(1, Number(cfg.qtd || 1));
  const itensBonus: PromoItemBonus[] = cfg.produto_ids.map((produtoId) => ({
    produtoId,
    quantidade: qtd,
    motivo: promo.nome,
  }));
  return buildBaseEffect(promo, {
    itensBonus,
    resumo: `Brinde: ${itensBonus.length} item(ns)`,
    meta: { brinde: cfg },
  });
}

function comboHandler(promo: Promocao, ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const cfg = acao.combo;
  if (!cfg?.itens?.length) return null;
  for (const need of cfg.itens) {
    const qtd = ctx.itens
      .filter((i) => i.produtoId === need.produto_id)
      .reduce((s, i) => s + i.quantidade, 0);
    if (qtd < need.qtd) return null;
  }
  const precoCheio = cfg.itens.reduce((sum, need) => {
    const item = ctx.itens.find((i) => i.produtoId === need.produto_id);
    return sum + (item?.precoUnit ?? 0) * need.qtd;
  }, 0);
  const desconto = round2(Math.max(0, precoCheio - Number(cfg.preco || 0)));
  if (desconto <= 0) return null;
  return buildBaseEffect(promo, {
    desconto,
    resumo: `Combo por R$ ${Number(cfg.preco).toFixed(2).replace(".", ",")} (− R$ ${desconto.toFixed(2).replace(".", ",")})`,
    meta: { combo: cfg, precoCheio },
  });
}

function descontoCategoria(promo: Promocao, ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const cfg = acao.desconto_categoria;
  if (!cfg?.categoria_ids?.length) return null;
  const base = ctx.itens
    .filter((i) => i.categoriaId && cfg.categoria_ids.includes(i.categoriaId))
    .reduce((s, i) => s + i.precoUnit * i.quantidade, 0);
  if (base <= 0) return null;
  const desconto = round2(Math.min(ctx.subtotal, (base * cfg.percentual) / 100));
  if (desconto <= 0) return null;
  return buildBaseEffect(promo, {
    desconto,
    resumo: `${cfg.percentual}% em categorias selecionadas`,
    meta: { desconto_categoria: cfg, base },
  });
}

function descontoProduto(promo: Promocao, ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const cfg = acao.desconto_produto;
  if (!cfg?.produto_ids?.length) return null;
  const base = ctx.itens
    .filter((i) => cfg.produto_ids.includes(i.produtoId))
    .reduce((s, i) => s + i.precoUnit * i.quantidade, 0);
  if (base <= 0) return null;
  let desconto = 0;
  if (cfg.percentual) desconto = (base * cfg.percentual) / 100;
  else if (cfg.valor_fixo) desconto = cfg.valor_fixo;
  desconto = round2(Math.min(ctx.subtotal, desconto));
  if (desconto <= 0) return null;
  return buildBaseEffect(promo, {
    desconto,
    resumo: cfg.percentual
      ? `${cfg.percentual}% em produtos selecionados`
      : `R$ ${desconto.toFixed(2).replace(".", ",")} em produtos selecionados`,
    meta: { desconto_produto: cfg, base },
  });
}

function leveMais(promo: Promocao, ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const cfg = acao.leve_mais;
  if (!cfg?.faixas?.length) return null;

  const match = (i: PromoCartItem) => {
    if (cfg.produto_ids?.length) return cfg.produto_ids.includes(i.produtoId);
    if (cfg.categoria_ids?.length) return Boolean(i.categoriaId && cfg.categoria_ids.includes(i.categoriaId));
    return itensNoEscopo([i], promo.escopo_produtos).length > 0;
  };

  const elegiveis = ctx.itens.filter(match);
  const qtd = elegiveis.reduce((s, i) => s + i.quantidade, 0);
  const faixas = [...cfg.faixas].sort((a, b) => b.qtd - a.qtd);
  const faixa = faixas.find((f) => qtd >= f.qtd);
  if (!faixa) return null;

  const unidades: number[] = [];
  for (const item of elegiveis) {
    for (let k = 0; k < item.quantidade; k++) unidades.push(item.precoUnit);
  }
  unidades.sort((a, b) => b - a);
  const precoFaixa = Number(faixa.preco);
  if (!Number.isFinite(precoFaixa)) return null;
  const precoOriginal = unidades.slice(0, faixa.qtd).reduce((s, p) => s + p, 0);
  const desconto = round2(Math.max(0, precoOriginal - precoFaixa));
  if (desconto <= 0) return null;

  return buildBaseEffect(promo, {
    desconto,
    resumo: `${faixa.qtd} por R$ ${precoFaixa.toFixed(2).replace(".", ",")}`,
    meta: { leve_mais: cfg, faixa, precoOriginal },
  });
}

function pontosHandler(promo: Promocao, _ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const extra = Number(acao.pontos?.extra || 0);
  if (extra <= 0) return null;
  return buildBaseEffect(promo, {
    pontosExtra: extra,
    resumo: `+${extra} pontos`,
    meta: { pontos: acao.pontos },
  });
}

function cupomHandler(promo: Promocao, ctx: PromoContext, acao: PromocaoAcao): PromoEffect | null {
  const modo = acao.cupom_modo || (acao.percentual ? "percentual" : acao.valor_fixo ? "fixo" : acao.frete ? "frete_gratis" : acao.brinde ? "brinde" : "percentual");
  if (modo === "percentual") return descontoPercentualPedido(promo, ctx, Number(acao.percentual || 0), acao.teto);
  if (modo === "fixo") return descontoFixoPedido(promo, ctx, Number(acao.valor_fixo || 0));
  if (modo === "frete_gratis") return freteHandler(promo, ctx, { frete: { modo: "gratis" } });
  if (modo === "brinde") return brindeHandler(promo, ctx, acao);
  return null;
}

const actionHandlers: Record<PromocaoTipo, ActionHandler> = {
  desconto_percentual: (promo, ctx, acao) =>
    descontoPercentualPedido(promo, ctx, Number(acao.percentual || 0), acao.teto),
  desconto_fixo: (promo, ctx, acao) => descontoFixoPedido(promo, ctx, Number(acao.valor_fixo || 0)),
  frete_gratis: freteHandler,
  compre_x_leve_y: compreXLeveY,
  brinde: brindeHandler,
  combo: comboHandler,
  desconto_categoria: descontoCategoria,
  desconto_produto: descontoProduto,
  leve_mais_pague_menos: leveMais,
  pontos: pontosHandler,
  cupom: cupomHandler,
};

export function aplicarAcao(promo: Promocao, ctx: PromoContext): PromoEffect | null {
  const handler = actionHandlers[promo.tipo];
  if (!handler) return null;
  const acao = (promo.acao || {}) as PromocaoAcao;
  const effect = handler(promo, ctx, acao);
  if (!effect) return null;
  // Cap: desconto não pode zerar totalmente o pedido abaixo de 0.01 se houver subtotal
  if (effect.desconto > 0 && ctx.subtotal > 0) {
    effect.desconto = round2(Math.min(effect.desconto, Math.max(ctx.subtotal - 0.01, 0)));
    effect.economiaTotal = round2(effect.desconto + effect.descontoFrete);
  }
  return effect;
}

export function registerAction(tipo: PromocaoTipo, handler: ActionHandler) {
  actionHandlers[tipo] = handler;
}
