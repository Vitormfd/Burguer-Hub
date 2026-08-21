import { supabase } from "@/integrations/supabase/client";

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

/** Somente deliveries criados hoje (horário local). */
export async function loadPedidosDeliveryBoard(): Promise<{ data: PedidoDelivery[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("pedidos")
    .select("id, criado_em, tipo_entrega, status")
    .eq("tipo", "delivery")
    .neq("status", "cancelado")
    .gte("criado_em", startOfLocalDayIso())
    .order("criado_em", { ascending: false });

  if (error) return { data: [], error };

  return { data: (data || []) as PedidoDelivery[], error: null };
}

export async function countDeliveryPendentes(): Promise<number> {
  const { count } = await supabase
    .from("pedidos")
    .select("id", { head: true, count: "exact" })
    .eq("tipo", "delivery")
    .eq("status", "pendente")
    .gte("criado_em", startOfLocalDayIso());

  return count ?? 0;
}
