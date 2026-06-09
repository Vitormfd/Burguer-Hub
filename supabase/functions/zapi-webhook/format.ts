import type { CartItemWa, LojaConfig, SessionDados } from "./types.ts";

export const brl = (value: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export const normalizeText = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export const normalizePhone = (value: string): string => {
  const digits = value.replace(/\D/g, "").trim();
  if (digits.startsWith("55") && digits.length === 13) return digits.slice(2);
  return digits;
};

export const formatPhoneZapi = (phone: string): string => {
  const local = normalizePhone(phone);
  return local.length === 11 ? `55${local}` : phone.replace(/\D/g, "");
};

export const itemUnitPrice = (item: CartItemWa): number => {
  const adds = item.adicionais.reduce(
    (sum, a) => sum + a.preco_unitario * a.quantidade,
    0,
  );
  return item.preco_unitario + adds;
};

export const cartSubtotal = (carrinho: CartItemWa[]): number =>
  carrinho.reduce((sum, item) => sum + itemUnitPrice(item) * item.quantidade, 0);

export const formatCart = (carrinho: CartItemWa[]): string => {
  if (!carrinho.length) return "🛒 Seu carrinho está vazio.";

  const lines: string[] = ["🛒 *Seu pedido:*", ""];
  for (const item of carrinho) {
    lines.push(
      `${item.quantidade}x ${item.produto_nome} — ${brl(itemUnitPrice(item) * item.quantidade)}`,
    );
    for (const ad of item.adicionais) {
      const qty = ad.quantidade > 1 ? ` x${ad.quantidade}` : "";
      lines.push(`  + ${ad.nome}${qty}`);
    }
    if (item.observacao?.trim()) {
      lines.push(`  _Obs: ${item.observacao.trim()}_`);
    }
  }
  lines.push("");
  lines.push(`*Subtotal:* ${brl(cartSubtotal(carrinho))}`);
  return lines.join("\n");
};

export const formatBoasVindas = (cfg: LojaConfig): string =>
  cfg.whatsapp_msg_boas_vindas.replaceAll("{{loja}}", cfg.nome_loja);

export const encodeKdsObservation = (produtoNome: string, observacao?: string): string => {
  const safeName = produtoNome.replace(/\]/g, "").trim();
  const safeObs = (observacao || "").trim();
  const marker = `[item:${safeName}]`;
  return safeObs ? `${marker} ${safeObs}` : marker;
};

export const formatResumoConfirmacao = (
  dados: SessionDados,
  taxaEntrega: number,
  total: number,
): string => {
  const lines: string[] = [
    "📋 *Resumo do pedido*",
    "",
    formatCart(dados.carrinho),
  ];

  if (dados.tipo_entrega === "delivery") {
    lines.push("");
    lines.push("📍 *Entrega:*");
    lines.push(`Nome: ${dados.cliente?.nome || "—"}`);
    lines.push(
      `Endereço: ${dados.cliente?.endereco}, ${dados.cliente?.numero}`,
    );
    if (dados.cliente?.complemento) {
      lines.push(`Complemento: ${dados.cliente.complemento}`);
    }
    lines.push(`Bairro: ${dados.cliente?.bairro_nome}`);
    if (taxaEntrega > 0) lines.push(`Taxa de entrega: ${brl(taxaEntrega)}`);
  } else {
    lines.push("");
    lines.push("🏪 *Retirada no balcão*");
    lines.push(`Nome: ${dados.cliente?.nome || "—"}`);
  }

  lines.push("");
  lines.push(`💳 Pagamento: ${formatPagamento(dados.forma_pagamento)}`);
  if (dados.forma_pagamento === "dinheiro" && dados.troco_para) {
    lines.push(`Troco para: ${brl(dados.troco_para)}`);
  }
  lines.push("");
  lines.push(`💰 *Total: ${brl(total)}*`);

  return lines.join("\n");
};

export const formatPagamento = (forma?: string): string => {
  const map: Record<string, string> = {
    pix: "PIX",
    cartao: "Cartão",
    dinheiro: "Dinheiro",
    boleto: "Boleto",
  };
  return map[forma || ""] || forma || "—";
};

export const AJUDA_TEXTO = `ℹ️ *Comandos disponíveis:*

*menu* — Ver cardápio
*carrinho* — Ver seu pedido
*cancelar* — Cancelar pedido
*ajuda* — Ver esta mensagem`;
