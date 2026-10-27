// Webhook da Stripe sem SDK: verificação da assinatura (HMAC-SHA256) e leitura dos eventos
// que mudam a situação da assinatura. Lógica pura, testada em stripe.test.ts.

/** Status da Stripe que deixam a conta operar (past_due: a Stripe ainda está tentando cobrar). */
export const STATUS_LIBERADOS = ["active", "trialing", "past_due"] as const;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/**
 * Confere o cabeçalho Stripe-Signature ("t=...,v1=...") contra o corpo cru da requisição.
 * Recusa assinaturas mais velhas que `toleranciaSeg` (proteção contra reenvio).
 */
export async function verificarAssinaturaStripe(
  corpo: string,
  cabecalho: string | null,
  segredo: string,
  agoraSeg = Math.floor(Date.now() / 1000),
  toleranciaSeg = 300,
): Promise<boolean> {
  if (!cabecalho || !segredo) return false;
  const partes = cabecalho.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(partes.find(([k]) => k === "t")?.[1]);
  const assinaturas = partes.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !assinaturas.length) return false;
  if (Math.abs(agoraSeg - t) > toleranciaSeg) return false;

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const esperado = hex(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(`${t}.${corpo}`)));
  return assinaturas.some((v) => iguaisEmTempoConstante(v, esperado));
}

export interface EventoStripe {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type AcaoAssinatura =
  | {
      tipo: "vincular";
      ownerId: string | null;
      email: string | null;
      customer: string | null;
      subscription: string | null;
      status: string;
    }
  | {
      tipo: "atualizar";
      subscription: string;
      customer: string | null;
      status: string;
      periodoFim: string | null;
      cancelaNoFim: boolean;
    }
  | { tipo: "ignorar"; motivo: string };

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const idDe = (v: unknown): string | null =>
  texto(v) ?? (v && typeof v === "object" ? texto((v as { id?: unknown }).id) : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fim do período pago: na API nova fica nos itens da assinatura, na antiga na raiz. */
function periodoFimDe(sub: Record<string, unknown>): string | null {
  const itens = (sub.items as { data?: Array<{ current_period_end?: number }> } | undefined)?.data;
  const seg = itens?.[0]?.current_period_end ?? (sub.current_period_end as number | undefined);
  return typeof seg === "number" ? new Date(seg * 1000).toISOString() : null;
}

/** O que fazer com cada evento. Eventos fora desta lista são registrados e ignorados. */
export function interpretarEvento(evento: EventoStripe): AcaoAssinatura {
  const obj = evento.data?.object ?? {};
  switch (evento.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return { tipo: "ignorar", motivo: "checkout que não é assinatura" };
      if (obj.payment_status === "unpaid") return { tipo: "ignorar", motivo: "checkout sem pagamento confirmado" };
      const ref = texto(obj.client_reference_id);
      const detalhes = obj.customer_details as { email?: unknown } | undefined;
      return {
        tipo: "vincular",
        ownerId: ref && UUID.test(ref) ? ref : null,
        email: texto(detalhes?.email) ?? texto(obj.customer_email),
        customer: idDe(obj.customer),
        subscription: idDe(obj.subscription),
        status: obj.payment_status === "no_payment_required" ? "trialing" : "active",
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = texto(obj.id);
      if (!subscription) return { tipo: "ignorar", motivo: "assinatura sem id" };
      return {
        tipo: "atualizar",
        subscription,
        customer: idDe(obj.customer),
        status: evento.type === "customer.subscription.deleted" ? "canceled" : (texto(obj.status) ?? "incomplete"),
        periodoFim: periodoFimDe(obj),
        cancelaNoFim: obj.cancel_at_period_end === true,
      };
    }
    default:
      return { tipo: "ignorar", motivo: `evento ${evento.type} não usado` };
  }
}
