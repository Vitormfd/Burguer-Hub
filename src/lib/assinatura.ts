// Assinatura do Easy Food Hub (Stripe). Sem assinatura ativa a conta fica em modo
// demonstração: navega e monta a loja, mas pedidos, mesas, WhatsApp e cardápio público
// são bloqueados no servidor (ver supabase/migrations/20261027120000_assinaturas.sql).

/** Link de pagamento da Stripe (assinatura mensal). Vazio = botão leva ao WhatsApp. */
export const LINK_PAGAMENTO_STRIPE = "https://buy.stripe.com/eVqaEYgnlbfZczL2xi6kg06";

export const PRECO_ASSINATURA = "R$ 199/mês";

const WHATSAPP_VENDAS = "5574999348744";

/** Link que identifica a conta na Stripe (client_reference_id) e já preenche o e-mail. */
export function linkAssinar(user: { id: string; email?: string | null } | null): string {
  if (!LINK_PAGAMENTO_STRIPE || !user) {
    const texto = encodeURIComponent("Olá! Criei minha conta no Easy Food Hub e quero assinar.");
    return `https://wa.me/${WHATSAPP_VENDAS}?text=${texto}`;
  }
  const url = new URL(LINK_PAGAMENTO_STRIPE);
  url.searchParams.set("client_reference_id", user.id);
  if (user.email) url.searchParams.set("prefilled_email", user.email);
  return url.toString();
}

export interface MinhaAssinatura {
  liberada: boolean;
  liberado_manual: boolean;
  status: string | null;
  periodo_fim: string | null;
  cancela_no_fim: boolean;
}

export const STATUS_ASSINATURA: Record<string, string> = {
  active: "Ativa",
  trialing: "Em teste",
  past_due: "Pagamento atrasado",
  canceled: "Cancelada",
  unpaid: "Não paga",
  incomplete: "Incompleta",
  incomplete_expired: "Expirada",
  paused: "Pausada",
};

/** Erro do banco quando a conta sem assinatura tenta operar (trigger exigir_assinatura). */
export const ehErroAssinatura = (msg: string | null | undefined) => /Assinatura inativa/i.test(msg || "");
