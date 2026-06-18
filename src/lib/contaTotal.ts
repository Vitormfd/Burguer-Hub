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
  const base = Number(item.preco_unitario) * item.quantidade;
  const adicionais = (item.adicionais || []).reduce(
    (sum, adicional) => sum + Number(adicional.preco_unitario) * adicional.quantidade,
    0,
  );
  return base + adicionais;
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
  const itemIds = itensAtivos.map((item) => item.id);

  let adicionaisTotal = 0;
  if (itemIds.length) {
    const { data: adicionais, error: adicionaisError } = await client
      .from("pedido_item_adicionais")
      .select("preco_unitario, quantidade")
      .in("pedido_item_id", itemIds);

    if (adicionaisError) throw adicionaisError;

    adicionaisTotal = (adicionais || []).reduce(
      (sum, adicional) => sum + Number(adicional.preco_unitario) * adicional.quantidade,
      0,
    );
  }

  const itensTotal = itensAtivos.reduce(
    (sum, item) => sum + Number(item.preco_unitario) * item.quantidade,
    0,
  );
  const novoTotal = Number((itensTotal + adicionaisTotal).toFixed(2));

  const { error: updateError } = await client.from("contas").update({ total: novoTotal }).eq("id", contaId);
  if (updateError) throw updateError;

  return novoTotal;
}
