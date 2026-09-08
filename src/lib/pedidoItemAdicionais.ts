import { supabase } from "@/integrations/supabase/client";
import { fetchInBatches } from "@/lib/supabaseBatch";

export type PedidoItemAdicionalInsert = {
  pedido_item_id: string;
  adicional_id: string;
  nome?: string | null;
  quantidade: number;
  preco_unitario: number;
};

export type PedidoItemAdicionalRow = {
  pedido_item_id: string;
  adicional_id: string | null;
  nome: string | null;
  quantidade: number;
  preco_unitario: number;
};

function isNomeColumnMissing(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = (error.message || "").toLowerCase();
  return (
    (error.code === "PGRST204" || message.includes("schema cache")) &&
    message.includes("nome") &&
    message.includes("pedido_item_adicionais")
  );
}

export async function insertPedidoItemAdicionais(rows: PedidoItemAdicionalInsert[]) {
  if (!rows.length) return;

  const { error } = await supabase.from("pedido_item_adicionais").insert(rows);
  if (!error) return;
  if (!isNomeColumnMissing(error)) throw new Error(error.message);

  const { error: retryError } = await supabase
    .from("pedido_item_adicionais")
    .insert(rows.map((row) => ({
      pedido_item_id: row.pedido_item_id,
      adicional_id: row.adicional_id,
      quantidade: row.quantidade,
      preco_unitario: row.preco_unitario,
    })));
  if (retryError) throw new Error(retryError.message);
}

export async function selectPedidoItemAdicionais(itemIds: string[]): Promise<PedidoItemAdicionalRow[]> {
  return fetchInBatches(itemIds, async (batch) => {
    const withNome = await supabase
      .from("pedido_item_adicionais")
      .select("pedido_item_id, adicional_id, nome, quantidade, preco_unitario")
      .in("pedido_item_id", batch);

    if (!withNome.error) return withNome;
    if (!isNomeColumnMissing(withNome.error)) return withNome;

    const withoutNome = await supabase
      .from("pedido_item_adicionais")
      .select("pedido_item_id, adicional_id, quantidade, preco_unitario")
      .in("pedido_item_id", batch);

    if (withoutNome.error) return withoutNome;

    return {
      data: (withoutNome.data || []).map((row) => ({ ...row, nome: null })),
      error: null,
    };
  });
}
