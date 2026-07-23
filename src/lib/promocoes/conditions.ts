import type { EscopoProdutos, PromoCartItem, PromoContext, Promocao, PromocaoCondicao } from "./types";

const TZ = "America/Sao_Paulo";

export function nowInSaoPaulo(base?: Date): {
  date: string;
  time: string;
  weekday: number;
  dateObj: Date;
} {
  const d = base ?? new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second ?? "00"}`,
    weekday: weekdayMap[parts.weekday] ?? d.getDay(),
    dateObj: d,
  };
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function strList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value) return [value];
  return [];
}

function qtdItens(itens: PromoCartItem[]): number {
  return itens.reduce((s, i) => s + i.quantidade, 0);
}

export function itemNoEscopo(item: PromoCartItem, escopo: EscopoProdutos): boolean {
  if (escopo.excluir_produto_ids?.includes(item.produtoId)) return false;
  if (escopo.modo === "todos") return true;
  if (escopo.modo === "categorias") {
    return Boolean(item.categoriaId && escopo.categoria_ids.includes(item.categoriaId));
  }
  if (escopo.modo === "produtos") {
    return escopo.produto_ids.includes(item.produtoId);
  }
  return true;
}

export function itensNoEscopo(itens: PromoCartItem[], escopo: EscopoProdutos): PromoCartItem[] {
  return itens.filter((i) => itemNoEscopo(i, escopo));
}

export function subtotalEscopo(itens: PromoCartItem[], escopo: EscopoProdutos): number {
  return itensNoEscopo(itens, escopo).reduce((s, i) => s + i.precoUnit * i.quantidade, 0);
}

/** Janela de validade (data/hora/dia) — independente das condições JSON. */
export function dentroDaJanela(promo: Promocao, agora?: Date): boolean {
  const { date, time, weekday } = nowInSaoPaulo(agora);
  const dias = promo.dias_semana?.length ? promo.dias_semana : [0, 1, 2, 3, 4, 5, 6];
  if (!dias.includes(weekday)) return false;

  if (promo.data_inicio && date < promo.data_inicio) return false;
  if (promo.data_fim && date > promo.data_fim) return false;

  const hi = promo.hora_inicio ? String(promo.hora_inicio).slice(0, 8) : null;
  const hf = promo.hora_fim ? String(promo.hora_fim).slice(0, 8) : null;
  const t = time.slice(0, 8);

  if (hi && hf) {
    if (hi <= hf) {
      if (t < hi || t > hf) return false;
    } else {
      // atravessa meia-noite
      if (t < hi && t > hf) return false;
    }
  } else if (hi && t < hi) {
    return false;
  } else if (hf && t > hf) {
    return false;
  }

  return true;
}

export function limitesOk(promo: Promocao, ctx: PromoContext): boolean {
  if (promo.limite_usos_total != null && promo.usos_realizados >= promo.limite_usos_total) {
    return false;
  }
  const tel = ctx.cliente?.telefone;
  const limite = promo.limite_por_cliente;
  if (limite != null && tel) {
    const usados = ctx.cliente?.usosPorPromocao?.[promo.id] ?? 0;
    if (usados >= limite) return false;
  }
  return true;
}

type CondHandler = (ctx: PromoContext, params: Record<string, unknown>, promo: Promocao) => boolean;

const handlers: Record<string, CondHandler> = {
  valor_minimo: (ctx, p) => ctx.subtotal >= num(p.valor),
  valor_maximo: (ctx, p) => ctx.subtotal <= num(p.valor, Infinity),
  pedido_acima: (ctx, p) => ctx.subtotal >= num(p.valor),
  qtd_min_itens: (ctx, p) => qtdItens(ctx.itens) >= num(p.quantidade ?? p.valor),
  qtd_max_itens: (ctx, p) => qtdItens(ctx.itens) <= num(p.quantidade ?? p.valor, Infinity),
  categoria: (ctx, p) => {
    const ids = strList(p.categoria_ids ?? p.ids);
    if (!ids.length) return true;
    return ctx.itens.some((i) => i.categoriaId && ids.includes(i.categoriaId));
  },
  produto: (ctx, p) => {
    const ids = strList(p.produto_ids ?? p.ids);
    if (!ids.length) return true;
    return ctx.itens.some((i) => ids.includes(i.produtoId));
  },
  excluir_produto: (ctx, p) => {
    const ids = strList(p.produto_ids ?? p.ids);
    if (!ids.length) return true;
    return !ctx.itens.some((i) => ids.includes(i.produtoId));
  },
  tipo_entrega: (ctx, p) => {
    const valores = strList(p.valores ?? p.valor);
    if (!valores.length) return true;
    return valores.includes(ctx.tipoEntrega);
  },
  forma_pagamento: (ctx, p) => {
    const valores = strList(p.valores ?? p.valor);
    if (!valores.length) return true;
    return Boolean(ctx.formaPagamento && valores.includes(ctx.formaPagamento));
  },
  primeiro_pedido: (ctx) => (ctx.cliente?.totalPedidos ?? 0) === 0,
  cliente_novo: (ctx) => (ctx.cliente?.totalPedidos ?? 0) === 0,
  cliente_vip: (ctx, p) => {
    const min = num(p.min_pedidos ?? p.n ?? p.valor, 5);
    return (ctx.cliente?.totalPedidos ?? 0) > min;
  },
  cidade: (ctx, p) => {
    const nomes = strList(p.nomes ?? p.nome).map((n) => n.toLowerCase().trim());
    if (!nomes.length) return true;
    const cidade = (ctx.cidade || "").toLowerCase().trim();
    return nomes.includes(cidade);
  },
  bairro: (ctx, p) => {
    const nomes = strList(p.nomes ?? p.nome).map((n) => n.toLowerCase().trim());
    if (!nomes.length) return true;
    const bairro = (ctx.bairro || "").toLowerCase().trim();
    return nomes.includes(bairro);
  },
  contem_produto: (ctx, p) => {
    const ids = strList(p.produto_ids ?? p.ids);
    const qtdMin = num(p.qtd_min, 1);
    if (!ids.length) return true;
    const qtd = ctx.itens
      .filter((i) => ids.includes(i.produtoId))
      .reduce((s, i) => s + i.quantidade, 0);
    return qtd >= qtdMin;
  },
  nao_contem_produto: (ctx, p) => {
    const ids = strList(p.produto_ids ?? p.ids);
    if (!ids.length) return true;
    return !ctx.itens.some((i) => ids.includes(i.produtoId));
  },
  qtd_pedidos_anteriores: (ctx, p) => {
    const min = p.min != null ? num(p.min) : null;
    const max = p.max != null ? num(p.max) : null;
    const exact = p.igual != null ? num(p.igual) : null;
    const total = ctx.cliente?.totalPedidos ?? 0;
    if (exact != null) return total === exact;
    if (min != null && total < min) return false;
    if (max != null && total > max) return false;
    return true;
  },
};

export function avaliarCondicao(
  cond: PromocaoCondicao,
  ctx: PromoContext,
  promo: Promocao,
): boolean {
  const handler = handlers[cond.tipo];
  if (!handler) return true;
  return handler(ctx, (cond.params || {}) as Record<string, unknown>, promo);
}

export function promocaoElegivel(
  promo: Promocao,
  ctx: PromoContext,
  opts?: { ignorarCupom?: boolean },
): boolean {
  // Módulo vale somente para delivery
  if (ctx.tipoEntrega !== "delivery") return false;
  if (!promo.ativo) return false;
  if (!dentroDaJanela(promo, ctx.agora)) return false;
  if (!limitesOk(promo, ctx)) return false;

  if (promo.necessita_cupom) {
    if (opts?.ignorarCupom) return false;
    const digitado = (ctx.codigoCupomDigitado || "").trim().toUpperCase();
    const codigo = (promo.codigo_cupom || "").trim().toUpperCase();
    if (!digitado || !codigo || digitado !== codigo) return false;
  } else if (!promo.aplica_automaticamente) {
    return false;
  }

  const condicoes = Array.isArray(promo.condicoes) ? promo.condicoes : [];
  return condicoes.every((c) => avaliarCondicao(c, ctx, promo));
}

export function registerCondition(tipo: string, handler: CondHandler) {
  handlers[tipo] = handler;
}
