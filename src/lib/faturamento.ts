import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchInBatches } from "@/lib/supabaseBatch";

export interface FaturamentoPeriodo {
  total: number;
  mesas: { total: number; quantidade: number };
  delivery: { total: number; quantidade: number };
  retirada: { total: number; quantidade: number };
  pedidos: number;
}

type PedidoDeliveryRow = {
  id: string;
  tipo_entrega: string | null;
  total: number | null;
  subtotal: number | null;
  desconto: number | null;
  valor_desconto: number | null;
};

export function totalPedidoDelivery(
  pedido: Pick<PedidoDeliveryRow, "total" | "subtotal" | "desconto" | "valor_desconto">,
  subtotalItens: number,
  taxaEntrega: number,
): number {
  const total = Number(pedido.total || 0);
  if (total > 0) return total;

  const subtotal = Number(pedido.subtotal || 0) || subtotalItens;
  const desconto = Number(pedido.desconto || 0) + Number(pedido.valor_desconto || 0);
  return Math.max(subtotal + taxaEntrega - desconto, 0);
}

export async function fetchFaturamentoPeriodo(
  ini: string,
  fim: string,
  client: SupabaseClient = supabase,
): Promise<FaturamentoPeriodo> {
  const [contasRes, pedidosRes] = await Promise.all([
    client
      .from("contas")
      .select("id, total")
      .eq("status", "fechada")
      .gte("fechada_em", ini)
      .lte("fechada_em", fim),
    client
      .from("pedidos")
      .select("id, tipo_entrega, total, subtotal, desconto, valor_desconto")
      .eq("tipo", "delivery")
      .neq("status", "cancelado")
      .gte("criado_em", ini)
      .lte("criado_em", fim),
  ]);

  if (contasRes.error) throw contasRes.error;
  if (pedidosRes.error) throw pedidosRes.error;

  const contas = contasRes.data || [];
  const pedidos = (pedidosRes.data || []) as PedidoDeliveryRow[];

  const mesasTotal = contas.reduce((sum, conta) => sum + Number(conta.total || 0), 0);
  const mesasQtd = contas.length;

  let deliveryTotal = 0;
  let deliveryQtd = 0;
  let retiradaTotal = 0;
  let retiradaQtd = 0;

  if (pedidos.length) {
    const pedidoIds = pedidos.map((pedido) => pedido.id);
    const [itens, entregas] = await Promise.all([
      fetchInBatches(pedidoIds, (batch) =>
        client
          .from("pedido_itens")
          .select("pedido_id, quantidade, preco_unitario, cancelado")
          .in("pedido_id", batch),
      ),
      fetchInBatches(pedidoIds, (batch) =>
        client.from("entregas").select("pedido_id, taxa_entrega").in("pedido_id", batch),
      ),
    ]);

    const itemTotals = new Map<string, number>();
    itens.forEach((item) => {
      if (item.cancelado) return;
      itemTotals.set(
        item.pedido_id,
        (itemTotals.get(item.pedido_id) || 0) + Number(item.preco_unitario || 0) * Number(item.quantidade || 0),
      );
    });

    const taxaMap = new Map(entregas.map((entrega) => [entrega.pedido_id, Number(entrega.taxa_entrega || 0)]));

    pedidos.forEach((pedido) => {
      const taxa = pedido.tipo_entrega === "retirada" ? 0 : (taxaMap.get(pedido.id) || 0);
      const total = totalPedidoDelivery(pedido, itemTotals.get(pedido.id) || 0, taxa);

      if (pedido.tipo_entrega === "retirada") {
        retiradaTotal += total;
        retiradaQtd += 1;
      } else {
        deliveryTotal += total;
        deliveryQtd += 1;
      }
    });
  }

  const total = mesasTotal + deliveryTotal + retiradaTotal;

  return {
    total: Number(total.toFixed(2)),
    mesas: { total: Number(mesasTotal.toFixed(2)), quantidade: mesasQtd },
    delivery: { total: Number(deliveryTotal.toFixed(2)), quantidade: deliveryQtd },
    retirada: { total: Number(retiradaTotal.toFixed(2)), quantidade: retiradaQtd },
    pedidos: mesasQtd + deliveryQtd + retiradaQtd,
  };
}
