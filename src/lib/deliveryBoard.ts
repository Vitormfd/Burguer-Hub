import { supabase } from "@/integrations/supabase/client";

const STATUS_ABERTOS = ["pendente", "em_preparo", "pronto"] as const;

export function startOfLocalDayIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

type PedidoDelivery = {
  id: string;
  criado_em: string;
  tipo_entrega: string | null;
  status: string;
};

/** Pedidos do dia + qualquer delivery ainda em aberto (não some à meia-noite). */
export async function loadPedidosDeliveryBoard(): Promise<{ data: PedidoDelivery[]; error: { message: string } | null }> {
  const startOfDay = startOfLocalDayIso();

  const [doDia, abertos] = await Promise.all([
    supabase
      .from("pedidos")
      .select("id, criado_em, tipo_entrega, status")
      .eq("tipo", "delivery")
      .neq("status", "cancelado")
      .gte("criado_em", startOfDay),
    supabase
      .from("pedidos")
      .select("id, criado_em, tipo_entrega, status")
      .eq("tipo", "delivery")
      .in("status", [...STATUS_ABERTOS]),
  ]);

  const error = doDia.error || abertos.error;
  if (error) return { data: [], error };

  const byId = new Map<string, PedidoDelivery>();
  for (const row of [...(doDia.data || []), ...(abertos.data || [])]) {
    byId.set(row.id, row as PedidoDelivery);
  }

  return {
    data: [...byId.values()].sort((a, b) => +new Date(b.criado_em) - +new Date(a.criado_em)),
    error: null,
  };
}

export async function countDeliveryPendentes(): Promise<number> {
  const { count } = await supabase
    .from("pedidos")
    .select("id", { head: true, count: "exact" })
    .eq("tipo", "delivery")
    .eq("status", "pendente");

  return count ?? 0;
}
