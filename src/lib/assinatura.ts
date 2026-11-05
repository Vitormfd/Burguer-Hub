// Assinatura do Easy Food Hub (Stripe). Conta nova tem 7 dias de teste grátis; sem teste e
// sem assinatura ativa ela fica em modo demonstração: navega e monta a loja, mas pedidos,
// mesas, WhatsApp e cardápio público são bloqueados no servidor (ver
// supabase/migrations/20261027120000_assinaturas.sql e 20261105120000_teste_gratis.sql).
import { lerOrigem, utmsParaStripe, type Origem } from "@/lib/origemAnuncio";

/** Link de pagamento da Stripe (assinatura mensal). Vazio = botão leva ao WhatsApp. */
export const LINK_PAGAMENTO_STRIPE = "https://buy.stripe.com/eVqaEYgnlbfZczL2xi6kg06";

export const PRECO_ASSINATURA = "R$ 199/mês";
export const VALOR_ASSINATURA = 199;

const WHATSAPP_VENDAS = "5574999348744";

/**
 * Link que identifica a conta na Stripe (client_reference_id) e repassa as UTMs do anúncio.
 * O e-mail não vai na URL: a conta já é identificada pelo id, e a pessoa digita na Stripe.
 */
export function linkAssinar(user: { id: string } | null, origem: Origem = lerOrigem()): string {
  if (!LINK_PAGAMENTO_STRIPE || !user) {
    const texto = encodeURIComponent("Olá! Criei minha conta no Easy Food Hub e quero assinar.");
    return `https://wa.me/${WHATSAPP_VENDAS}?text=${texto}`;
  }
  const url = new URL(LINK_PAGAMENTO_STRIPE);
  url.searchParams.set("client_reference_id", user.id);
  for (const [chave, valor] of utmsParaStripe(origem)) url.searchParams.set(chave, valor);
  return url.toString();
}

export interface MinhaAssinatura {
  liberada: boolean;
  liberado_manual: boolean;
  status: string | null;
  periodo_fim: string | null;
  cancela_no_fim: boolean;
  /** Pagamento confirmado pela Stripe. null = não foi possível consultar. */
  paga?: boolean | null;
  em_teste?: boolean;
  teste_ate?: string | null;
  whatsapp_liberado?: boolean;
}

/** Dias que faltam no teste, arredondados para cima (o último dia conta como 1). */
export function diasRestantesTeste(testeAte: string | null | undefined, agora: number = Date.now()): number {
  if (!testeAte) return 0;
  const restante = new Date(testeAte).getTime() - agora;
  return restante > 0 ? Math.ceil(restante / 86_400_000) : 0;
}

/** Celular do Brasil com DDD. Devolve só os dígitos, sem o 55, ou null se não for válido. */
export function whatsappValido(valor: string): string | null {
  let digitos = valor.replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length > 11) digitos = digitos.slice(2);
  return digitos.length === 10 || digitos.length === 11 ? digitos : null;
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
