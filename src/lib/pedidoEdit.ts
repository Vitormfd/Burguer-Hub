import { supabase } from "@/integrations/supabase/client";
import type { Cart, CartAdicionalSelecionado, CartItem } from "@/components/cardapio/cartTypes";
import { cartSubtotal } from "@/components/cardapio/cartTypes";
import type { PedidoStatus, Produto } from "@/types/db";

export const pedidoEditavel = (status: PedidoStatus) =>
  status === "pendente" || status === "em_preparo";

export async function loadPedidoCart(pedidoId: string): Promise<Cart> {
  const { data: itens, error } = await supabase
    .from("pedido_itens")
    .select("id, produto_id, quantidade, preco_unitario, observacao")
    .eq("pedido_id", pedidoId)
    .eq("cancelado", false)
    .order("id");

  if (error) throw new Error(error.message);
  if (!itens?.length) return [];

  const itemIds = itens.map((i) => i.id);
  const produtoIds = Array.from(new Set(itens.map((i) => i.produto_id).filter(Boolean))) as string[];

  const [{ data: produtos }, { data: itemAdicionais }] = await Promise.all([
    produtoIds.length
      ? supabase.from("produtos").select("*").in("id", produtoIds)
      : Promise.resolve({ data: [] as Produto[] }),
    supabase
      .from("pedido_item_adicionais")
      .select("pedido_item_id, adicional_id, quantidade, preco_unitario")
      .in("pedido_item_id", itemIds),
  ]);

  const adicionalIds = Array.from(
    new Set((itemAdicionais || []).map((a) => a.adicional_id).filter(Boolean))
  ) as string[];

  const { data: adicionaisMeta } = adicionalIds.length
    ? await supabase.from("adicionais").select("id, nome, grupo_id").in("id", adicionalIds)
    : { data: [] as { id: string; nome: string; grupo_id: string }[] };

  const grupoIds = Array.from(
    new Set((adicionaisMeta || []).map((a) => a.grupo_id).filter(Boolean))
  ) as string[];

  const { data: grupos } = grupoIds.length
    ? await supabase.from("grupos_adicionais").select("id, nome").in("id", grupoIds)
    : { data: [] as { id: string; nome: string }[] };

  const prodMap = new Map((produtos || []).map((p) => [p.id, p as Produto]));
  const adicionalMap = new Map((adicionaisMeta || []).map((a) => [a.id, a]));
  const grupoMap = new Map((grupos || []).map((g) => [g.id, g.nome]));

  const adicionaisPorItem = new Map<string, CartAdicionalSelecionado[]>();
  (itemAdicionais || []).forEach((row) => {
    const meta = adicionalMap.get(row.adicional_id);
    const cur = adicionaisPorItem.get(row.pedido_item_id) ?? [];
    cur.push({
      grupoId: meta?.grupo_id ?? "",
      grupoNome: grupoMap.get(meta?.grupo_id ?? "") ?? "Adicional",
      adicionalId: row.adicional_id,
      adicionalNome: meta?.nome ?? "Adicional",
      quantidade: row.quantidade,
      precoUnitario: Number(row.preco_unitario),
    });
    adicionaisPorItem.set(row.pedido_item_id, cur);
  });

  return itens
    .map((item) => {
      const produto = item.produto_id ? prodMap.get(item.produto_id) : null;
      if (!produto) return null;

      const adicionais = adicionaisPorItem.get(item.id) ?? [];
      const precoAdicionaisUnit = adicionais.reduce(
        (sum, a) => sum + a.precoUnitario * a.quantidade,
        0
      );
      const precoUnit = Number(item.preco_unitario);
      const precoBaseUnit = Math.max(0, precoUnit - precoAdicionaisUnit);

      const cartItem: CartItem = {
        id: crypto.randomUUID(),
        produto,
        quantidade: item.quantidade,
        observacao: item.observacao ?? "",
        adicionais,
        precoBaseUnit,
        precoAdicionaisUnit,
        precoUnit,
      };
      return cartItem;
    })
    .filter((item): item is CartItem => item !== null);
}

export async function replacePedidoItens(
  pedidoId: string,
  cart: Cart,
  motivo = "Pedido editado"
): Promise<void> {
  if (!cart.length) throw new Error("Adicione pelo menos um item");

  const agora = new Date().toISOString();

  const { error: cancelError } = await supabase
    .from("pedido_itens")
    .update({
      cancelado: true,
      cancelado_em: agora,
      motivo_cancelamento: motivo,
    })
    .eq("pedido_id", pedidoId)
    .eq("cancelado", false);

  if (cancelError) throw new Error(cancelError.message);

  const rows = cart.map((item) => ({
    pedido_id: pedidoId,
    produto_id: item.produto.id,
    quantidade: item.quantidade,
    preco_unitario: item.precoUnit,
    observacao: item.observacao || null,
  }));

  const { data: insertedItems, error: insertError } = await supabase
    .from("pedido_itens")
    .insert(rows)
    .select("id");

  if (insertError) throw new Error(insertError.message);

  const adicionaisRows = cart.flatMap((item, idx) =>
    item.adicionais.map((adicional) => ({
      pedido_item_id: insertedItems?.[idx]?.id,
      adicional_id: adicional.adicionalId,
      quantidade: adicional.quantidade,
      preco_unitario: adicional.precoUnitario,
    }))
  ).filter((row) => !!row.pedido_item_id);

  if (adicionaisRows.length) {
    const { error: adicionaisError } = await supabase
      .from("pedido_item_adicionais")
      .insert(adicionaisRows);
    if (adicionaisError) throw new Error(adicionaisError.message);
  }
}

export async function updateDeliveryPedidoTotals(
  pedidoId: string,
  taxaEntrega: number
): Promise<void> {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select("tipo_entrega, desconto, valor_desconto")
    .eq("id", pedidoId)
    .maybeSingle();

  if (error || !pedido) throw new Error(error?.message || "Pedido não encontrado");

  const { data: itens } = await supabase
    .from("pedido_itens")
    .select("quantidade, preco_unitario")
    .eq("pedido_id", pedidoId)
    .eq("cancelado", false);

  const subtotal = (itens || []).reduce(
    (sum, item) => sum + Number(item.preco_unitario) * item.quantidade,
    0
  );

  const taxa = pedido.tipo_entrega === "retirada" ? 0 : taxaEntrega;
  const descontoFidelidade = Number(pedido.desconto || 0);
  const valorDesconto = Number(pedido.valor_desconto || 0);
  const total = Math.max(
    subtotal + taxa - descontoFidelidade - valorDesconto,
    subtotal > 0 ? 0.01 : 0
  );

  const { error: updateError } = await supabase
    .from("pedidos")
    .update({ subtotal, total })
    .eq("id", pedidoId);

  if (updateError) throw new Error(updateError.message);
}

export { cartSubtotal };
