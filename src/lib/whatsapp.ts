import { supabase } from "@/integrations/supabase/client";
import type { Cart, CartItem } from "@/components/cardapio/cartTypes";
import { cartSubtotal } from "@/components/cardapio/cartTypes";
import { brl } from "@/lib/format";
import type { TipoMensagemWhatsapp } from "@/types/db";

export interface WhatsappDadosPedido {
  nome?: string;
  itens?: string;
  resumo?: string;
  total?: string;
  tempo_estimado?: string;
}

export interface WhatsappResumoOpcoes {
  taxaEntrega?: number;
  desconto?: number;
  subtotal?: number;
}

/** Lista simples para {{itens}} (compatível com templates antigos). */
export const formatWhatsappItensLista = (cart: Cart | CartItem[]): string =>
  cart.map((i) => `${i.quantidade}x ${i.produto.nome}`).join(", ");

/** Resumo detalhado para {{itens}} / {{resumo}} (itens, adicionais, obs, taxa e descontos). */
export function formatWhatsappResumoPedido(
  cart: Cart | CartItem[],
  opts: WhatsappResumoOpcoes = {}
): string {
  const lines: string[] = [];

  for (const item of cart) {
    lines.push(`${item.quantidade}x ${item.produto.nome} — ${brl(item.precoUnit * item.quantidade)}`);
    for (const ad of item.adicionais) {
      const qty = ad.quantidade > 1 ? ` x${ad.quantidade}` : "";
      lines.push(`  + ${ad.adicionalNome}${qty}`);
    }
    if (item.observacao?.trim()) {
      lines.push(`  Obs: ${item.observacao.trim()}`);
    }
  }

  const subtotal = opts.subtotal ?? cartSubtotal(cart);
  const taxa = opts.taxaEntrega ?? 0;
  const desconto = opts.desconto ?? 0;

  if (taxa > 0 || desconto > 0) {
    lines.push("");
    lines.push(`Subtotal: ${brl(subtotal)}`);
    if (taxa > 0) lines.push(`Taxa de entrega: ${brl(taxa)}`);
    if (desconto > 0) lines.push(`Desconto: -${brl(desconto)}`);
  }

  return lines.join("\n");
}

/** Monta dados do pedido para WhatsApp (usa {{itens}} — compatível com edge function atual). */
export function buildWhatsappPedidoDados(
  cart: Cart | CartItem[],
  opts: {
    nome?: string;
    total: string;
    taxaEntrega?: number;
    desconto?: number;
    subtotal?: number;
  }
): WhatsappDadosPedido {
  const resumo = formatWhatsappResumoPedido(cart, {
    taxaEntrega: opts.taxaEntrega,
    desconto: opts.desconto,
    subtotal: opts.subtotal,
  });

  return {
    nome: opts.nome,
    itens: resumo,
    resumo,
    total: opts.total,
  };
}

/**
 * Dispara a Edge Function send-whatsapp de forma fire-and-forget.
 * Nunca lança exceção — erros são silenciados para não bloquear o fluxo.
 */
/** Configura o webhook de recebimento na Z-API para o chatbot de pedidos. */
export async function configureWhatsappWebhook(
  configuracao_id: string,
): Promise<{ ok: boolean; webhook_url?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("send-whatsapp", {
      body: { action: "configure_webhook", configuracao_id },
    });
    if (error) return { ok: false, error: error.message };
    return data as { ok: boolean; webhook_url?: string; error?: string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro desconhecido" };
  }
}

export async function sendWhatsapp(
  pedido_id: string,
  tipo_mensagem: TipoMensagemWhatsapp,
  telefone: string,
  dados_pedido?: WhatsappDadosPedido
): Promise<void> {
  try {
    await supabase.functions.invoke("send-whatsapp", {
      body: { pedido_id, tipo_mensagem, telefone, dados_pedido },
    });
  } catch {
    // Silently ignore — WhatsApp failure must never block order operations
  }
}
