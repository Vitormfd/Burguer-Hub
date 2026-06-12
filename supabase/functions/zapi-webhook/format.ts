// Tipos centralizados aqui (evita arquivo types.ts sumir no deploy manual do Supabase)

export type Etapa =
  | "inicio"
  | "menu_categoria"
  | "menu_produto"
  | "produto_quantidade"
  | "produto_adicional"
  | "produto_observacao"
  | "carrinho"
  | "tipo_entrega"
  | "cliente_nome"
  | "cliente_endereco"
  | "cliente_numero"
  | "cliente_complemento"
  | "cliente_bairro"
  | "forma_pagamento"
  | "troco"
  | "confirmacao"
  | "finalizado";

export interface CartAdicionalWa {
  adicional_id: string;
  nome: string;
  quantidade: number;
  preco_unitario: number;
}

export interface CartItemWa {
  id: string;
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao?: string;
  adicionais: CartAdicionalWa[];
}

export interface GrupoAdicionalWa {
  id: string;
  nome: string;
  obrigatorio: boolean;
  min_escolhas: number;
  max_escolhas: number;
  adicionais: { id: string; nome: string; preco: number; disponivel: boolean }[];
}

export interface ProdutoTempWa {
  produto_id: string;
  nome: string;
  preco: number;
  quantidade: number;
  adicionais: CartAdicionalWa[];
  grupo_index: number;
  grupos: GrupoAdicionalWa[];
  categoria_id: string;
  categoria_nome: string;
  fallback_all_groups: boolean;
}

export interface ClienteTempWa {
  nome?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro_id?: string;
  bairro_nome?: string;
}

export interface SessionDados {
  bot_ativo?: boolean;
  carrinho: CartItemWa[];
  produto_temp?: ProdutoTempWa;
  cliente?: ClienteTempWa;
  tipo_entrega?: "delivery" | "retirada";
  forma_pagamento?: string;
  troco_para?: number;
  sender_name?: string;
  categoria_id?: string;
  categoria_nome?: string;
  pagina_produtos?: number;
}

export interface WhatsappSession {
  id: string;
  owner_id: string;
  telefone: string;
  etapa: Etapa;
  dados: SessionDados;
  ultimo_message_id: string | null;
  atualizado_em: string;
}

export interface LojaConfig {
  id: string;
  owner_id: string;
  nome_loja: string;
  referencia?: string | null;
  site_url?: string | null;
  ativo?: boolean;
  zapi_instance_id: string;
  zapi_token: string;
  zapi_client_token: string;
  zapi_ativo: boolean;
  whatsapp_pedido_ativo: boolean;
  whatsapp_msg_boas_vindas: string;
  tempo_entrega_min?: string;
  retirada_ativa?: boolean;
  hora_abertura?: string;
  hora_fechamento?: string;
  horario_funcionamento?: unknown;
  endereco_estabelecimento?: string | null;
  frete_gratis_ativo?: boolean;
  frete_gratis_minimo?: number | null;
}

export interface BairroFreteConfig {
  frete_gratis_ativo?: boolean;
  frete_gratis_minimo?: number | null;
}

export function calcularTaxaEntregaWhatsapp(params: {
  tipoEntrega: "delivery" | "retirada";
  taxaBairro: number;
  subtotal: number;
  cfg: Pick<LojaConfig, "frete_gratis_ativo" | "frete_gratis_minimo">;
  bairro?: BairroFreteConfig | null;
}): number {
  const taxaBairro = Math.max(Number(params.taxaBairro || 0), 0);
  const subtotal = Math.max(Number(params.subtotal || 0), 0);

  if (params.tipoEntrega === "retirada") return 0;
  if (params.cfg.frete_gratis_ativo) return 0;
  if (params.bairro?.frete_gratis_ativo) return 0;

  const minimoGlobal = Number(params.cfg.frete_gratis_minimo || 0);
  if (minimoGlobal > 0 && subtotal >= minimoGlobal) return 0;

  const minimoBairro = Number(params.bairro?.frete_gratis_minimo || 0);
  if (minimoBairro > 0 && subtotal >= minimoBairro) return 0;

  return taxaBairro;
}

export interface ZapiIncomingMessage {
  instanceId?: string;
  messageId?: string;
  phone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  senderName?: string;
  text?: { message?: string };
  listResponseMessage?: {
    selectedRowId?: string;
    title?: string;
    message?: string;
  };
  buttonsResponseMessage?: {
    buttonId?: string;
    message?: string;
  };
}

export interface OutboundMessage {
  text: string;
  optionList?: {
    title: string;
    buttonLabel: string;
    options: { id: string; title: string; description: string }[];
  };
}

export const brl = (value: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export const normalizeText = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export const normalizePhone = (value: string): string => {
  const parsed = normalizeBrazilMobile(value);
  return parsed?.local ?? value.replace(/\D/g, "").trim();
};

/** Normaliza celular BR para envio Z-API (55 + 11 dígitos). */
export const normalizeBrazilMobile = (
  value: string,
): { local: string; formatted: string } | null => {
  let digits = value.replace(/\D/g, "").trim();
  if (!digits) return null;

  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }

  if (digits.length === 10) {
    digits = digits.slice(0, 2) + "9" + digits.slice(2);
  }

  if (digits.length !== 11 || digits[2] !== "9") {
    return null;
  }

  return { local: digits, formatted: `55${digits}` };
};

export const formatPhoneZapi = (phone: string): string => {
  const parsed = normalizeBrazilMobile(phone);
  return parsed?.formatted ?? phone.replace(/\D/g, "");
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

export const buildCardapioUrl = (cfg: LojaConfig): string => {
  const base = (cfg.site_url || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const ref = (cfg.referencia || "").trim().replace(/^\/+|\/+$/g, "");
  return ref ? `${base}/${ref}/cardapio` : `${base}/cardapio`;
};

export const formatBoasVindas = (cfg: LojaConfig): string => {
  const cardapioUrl = buildCardapioUrl(cfg);
  let msg = cfg.whatsapp_msg_boas_vindas.replaceAll("{{loja}}", cfg.nome_loja);
  msg = msg.replaceAll("{{cardapio}}", cardapioUrl || "(configure a URL do site em Configurações)");
  return msg;
};

export const formatCardapioLinkMsg = (cfg: LojaConfig): string => {
  const url = buildCardapioUrl(cfg);
  if (!url) {
    return "🌐 O cardápio online ainda não está configurado. Digite *menu* para pedir por aqui.";
  }
  return `🌐 *Cardápio online:*\n${url}\n\n_Peça pelo site com fotos e checkout completo, ou digite *menu* para pedir por aqui._`;
};

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

export const AJUDA_TEXTO = `ℹ️ *Comandos do pedido automático:*

*menu* — Iniciar pedido pelo WhatsApp
*link* — Link do cardápio online
*carrinho* — Ver pedido em andamento
*cancelar* — Sair do pedido automático
*ajuda* — Ver esta mensagem

_For a qualquer outra coisa, é só escrever — um atendente pode responder._`;
