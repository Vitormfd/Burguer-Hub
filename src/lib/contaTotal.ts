import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type ItemAdicionalLike = { preco_unitario: number; quantidade: number };
type ItemLike = {
  preco_unitario: number;
  quantidade: number;
  cancelado?: boolean;
  adicionais?: ItemAdicionalLike[];
};

export function itemPedidoSubtotal(item: ItemLike): number {
  if (item.cancelado) return 0;
  // preco_unitario já inclui os adicionais; a lista de adicionais é só para exibição.
  return Number(item.preco_unitario) * item.quantidade;
}

export async function refreshContaTotalInDb(
  contaId: string,
  client: SupabaseClient = supabase,
): Promise<number> {
  const { data: peds, error: pedsError } = await client
    .from("pedidos")
    .select("id, status, cancelado_em")
    .eq("conta_id", contaId);

  if (pedsError) throw pedsError;

  const pedidosAtivos = (peds || []).filter((pedido) => pedido.status !== "cancelado" && !pedido.cancelado_em);
  if (!pedidosAtivos.length) {
    const { error } = await client.from("contas").update({ total: 0 }).eq("id", contaId);
    if (error) throw error;
    return 0;
  }

  const pedidoIds = pedidosAtivos.map((pedido) => pedido.id);
  const { data: itens, error: itensError } = await client
    .from("pedido_itens")
    .select("id, quantidade, preco_unitario, cancelado")
    .in("pedido_id", pedidoIds);

  if (itensError) throw itensError;

  const itensAtivos = (itens || []).filter((item) => !item.cancelado);
  const novoTotal = Number(
    itensAtivos
      .reduce((sum, item) => sum + Number(item.preco_unitario) * item.quantidade, 0)
      .toFixed(2),
  );

  const { error: updateError } = await client.from("contas").update({ total: novoTotal }).eq("id", contaId);
  if (updateError) throw updateError;

  return novoTotal;
}
