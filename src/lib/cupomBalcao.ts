import { supabase } from "@/integrations/supabase/client";
import { cartTemPromocao, type Cart } from "@/components/cardapio/cartTypes";
import { normalizePhone } from "@/lib/fidelidade";
import type { Cupom } from "@/types/db";

/**
 * Cupom aplicado pela loja num pedido lançado no painel (Novo Delivery).
 * Segue as mesmas regras da edge function cupons-validar, mas lê só os cupons
 * da própria loja (RLS owner_id = auth.uid()).
 */
export type CupomBalcao = Pick<Cupom, "id" | "codigo" | "tipo" | "valor" | "valor_minimo_pedido">;

// cupons/cupom_usos não estão nos tipos gerados (mesmo padrão do CuponsAdmin).
const sb = supabase as any;

const hojeSaoPaulo = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function calcularDescontoCupom(cupom: CupomBalcao, subtotal: number, taxaEntrega: number): number {
  const base = Math.max(subtotal, 0);
  const taxa = Math.max(taxaEntrega, 0);
  const calculado =
    cupom.tipo === "percentual" ? base * (Number(cupom.valor || 0) / 100)
    : cupom.tipo === "fixo" ? Number(cupom.valor || 0)
    : taxa;
  const maximo = Math.max(base + taxa - 0.01, 0);
  return Number(Math.min(Math.max(calculado, 0), maximo).toFixed(2));
}

/** Lança erro com a mensagem para a loja quando o cupom não pode ser usado. */
export async function validarCupomBalcao(opts: {
  codigo: string;
  telefone: string;
  subtotal: number;
  cart: Cart;
}): Promise<CupomBalcao> {
  const codigo = opts.codigo.trim().toUpperCase();
  if (!codigo) throw new Error("Informe o código do cupom");

  const { data: cupom, error }: { data: (Cupom & { ativo: boolean }) | null; error: { message: string } | null } = await sb
    .from("cupons")
    .select("id, codigo, tipo, valor, valor_minimo_pedido, limite_usos_total, usos_realizados, uso_unico_por_cliente, data_inicio, data_expiracao, ativo")
    .eq("codigo", codigo)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!cupom || !cupom.ativo) throw new Error("Cupom inválido ou inexistente");

  const hoje = hojeSaoPaulo();
  if ((cupom.data_inicio && hoje < cupom.data_inicio) || (cupom.data_expiracao && hoje > cupom.data_expiracao)) {
    throw new Error("Esse cupom expirou");
  }

  if (cupom.limite_usos_total != null && Number(cupom.usos_realizados || 0) >= Number(cupom.limite_usos_total)) {
    throw new Error("Esse cupom atingiu o limite de usos");
  }

  const telefone = normalizePhone(opts.telefone);
  if (cupom.uso_unico_por_cliente && telefone) {
    const { data: usoAnterior, error: usoError } = await sb
      .from("cupom_usos")
      .select("id")
      .eq("cupom_id", cupom.id)
      .eq("telefone_cliente", telefone)
      .limit(1)
      .maybeSingle();
    if (usoError) throw new Error(usoError.message);
    if (usoAnterior) throw new Error("Esse cliente já utilizou esse cupom");
  }

  if (opts.subtotal < Number(cupom.valor_minimo_pedido || 0)) {
    const minimo = Number(cupom.valor_minimo_pedido || 0).toFixed(2).replace(".", ",");
    throw new Error(`Pedido mínimo de R$${minimo} para usar esse cupom`);
  }

  if (cartTemPromocao(opts.cart)) {
    throw new Error("Não é possível usar cupom com produtos em promoção");
  }

  return {
    id: cupom.id,
    codigo: cupom.codigo,
    tipo: cupom.tipo as Cupom["tipo"],
    valor: cupom.valor == null ? null : Number(cupom.valor),
    valor_minimo_pedido: Number(cupom.valor_minimo_pedido || 0),
  };
}

/** Registra o uso (conta no limite e no relatório de cupons). Revalida no banco. */
export async function registrarUsoCupomBalcao(opts: {
  cupomId: string;
  pedidoId: string;
  telefone: string;
  clienteId: string | null;
  valorDesconto: number;
}): Promise<void> {
  const { error } = await sb.rpc("registrar_uso_cupom", {
    p_cupom_id: opts.cupomId,
    p_pedido_id: opts.pedidoId,
    p_cliente_id: opts.clienteId,
    p_telefone_cliente: normalizePhone(opts.telefone) || null,
    p_valor_desconto_aplicado: opts.valorDesconto,
  });
  if (error) {
    throw new Error(error.message.includes("utilizou") ? "Esse cliente já utilizou esse cupom" : error.message);
  }
}
