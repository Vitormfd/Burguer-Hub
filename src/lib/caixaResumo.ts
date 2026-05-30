import { supabase } from "@/integrations/supabase/client";
import type { CashSummary } from "@/lib/print";

const FORMA_ORDER = ["dinheiro", "pix", "cartao", "boleto", "outros"] as const;

export const FORMA_PAGAMENTO_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao: "Cartão",
  boleto: "Boleto",
  outros: "Outros",
};

function normalizeForma(forma: string | null | undefined): string {
  const key = (forma || "outros").toLowerCase();
  return FORMA_PAGAMENTO_LABEL[key] ? key : "outros";
}

function addPagamento(map: Record<string, number>, forma: string | null | undefined, valor: number) {
  if (!valor || valor <= 0) return;
  const key = normalizeForma(forma);
  map[key] = (map[key] || 0) + valor;
}

function mapToPagamentos(map: Record<string, number>) {
  return FORMA_ORDER.filter((f) => (map[f] || 0) > 0)
    .concat(
      Object.keys(map).filter((k) => !FORMA_ORDER.includes(k as (typeof FORMA_ORDER)[number]) && (map[k] || 0) > 0),
    )
    .map((forma) => ({
      forma: FORMA_PAGAMENTO_LABEL[forma] || forma,
      valor: Number((map[forma] || 0).toFixed(2)),
    }));
}

export async function buildCaixaResumo(caixaId: string): Promise<CashSummary | null> {
  const { data: caixa, error } = await supabase.from("caixas").select("*").eq("id", caixaId).single();
  if (error || !caixa) return null;

  const abertoEm = caixa.aberto_em as string;
  const fechadoEm = (caixa.fechado_em as string | null) ?? new Date().toISOString();

  const pagamentosMap: Record<string, number> = {};

  const { data: contas } = await supabase
    .from("contas")
    .select("id, total, forma_pagamento, conta_pagamentos(forma_pagamento, valor)")
    .eq("status", "fechada")
    .gte("fechada_em", abertoEm)
    .lte("fechada_em", fechadoEm);

  const contasList = (contas || []) as Array<{
    id: string;
    total: number | null;
    forma_pagamento: string | null;
    conta_pagamentos?: Array<{ forma_pagamento: string; valor: number }> | null;
  }>;

  let vendasMesas = 0;
  contasList.forEach((conta) => {
    const totalConta = Number(conta.total || 0);
    vendasMesas += totalConta;

    const pagos = conta.conta_pagamentos || [];
    if (pagos.length) {
      pagos.forEach((p) => addPagamento(pagamentosMap, p.forma_pagamento, Number(p.valor || 0)));
    } else if (totalConta > 0) {
      addPagamento(pagamentosMap, conta.forma_pagamento, totalConta);
    }
  });

  const { data: pedidos } = await supabase
    .from("pedidos")
    .select("id")
    .eq("tipo", "delivery")
    .neq("status", "cancelado")
    .gte("criado_em", abertoEm)
    .lte("criado_em", fechadoEm);

  const pedidoIds = ((pedidos || []) as Array<{ id: string }>).map((p) => p.id);
  let vendasDelivery = 0;
  let deliveryCount = 0;

  if (pedidoIds.length) {
    const [{ data: itens }, { data: entregas }] = await Promise.all([
      supabase
        .from("pedido_itens")
        .select("pedido_id, quantidade, preco_unitario, cancelado")
        .in("pedido_id", pedidoIds),
      supabase
        .from("entregas")
        .select("pedido_id, taxa_entrega, forma_pagamento")
        .in("pedido_id", pedidoIds),
    ]);

    const totalPorPedido = new Map<string, number>();
    (itens || []).forEach((item) => {
      if (item.cancelado) return;
      const pid = item.pedido_id as string;
      totalPorPedido.set(
        pid,
        (totalPorPedido.get(pid) || 0) + Number(item.preco_unitario || 0) * Number(item.quantidade || 0),
      );
    });

    const entregaPorPedido = new Map(
      (entregas || []).map((e) => [
        e.pedido_id as string,
        { taxa: Number(e.taxa_entrega || 0), forma: e.forma_pagamento as string | null },
      ]),
    );

    pedidoIds.forEach((pid) => {
      const itensTotal = totalPorPedido.get(pid) || 0;
      const entrega = entregaPorPedido.get(pid);
      const taxa = entrega?.taxa || 0;
      const totalPedido = itensTotal + taxa;
      if (totalPedido <= 0) return;

      deliveryCount += 1;
      vendasDelivery += totalPedido;
      addPagamento(pagamentosMap, entrega?.forma ?? null, totalPedido);
    });
  }

  const { data: movs } = await supabase
    .from("caixa_movimentacoes")
    .select("tipo, valor")
    .eq("caixa_id", caixaId);

  const movsList = (movs || []) as Array<{ tipo: string; valor: number }>;
  const retirada = movsList
    .filter((m) => m.tipo === "retirada")
    .reduce((s, m) => s + Number(m.valor || 0), 0);
  const suprimento = movsList
    .filter((m) => m.tipo === "suprimento")
    .reduce((s, m) => s + Number(m.valor || 0), 0);

  const valorInicial = Number(caixa.valor_inicial || 0);
  const valorFinal = caixa.valor_final != null ? Number(caixa.valor_final) : null;
  const vendasDinheiro = pagamentosMap.dinheiro || 0;
  const dinheiroEsperado = Number(
    (valorInicial + vendasDinheiro + suprimento - retirada).toFixed(2),
  );
  const diferenca =
    valorFinal != null ? Number((valorFinal - dinheiroEsperado).toFixed(2)) : null;

  const { data: cfg } = await supabase.from("configuracoes").select("nome_loja").limit(1).maybeSingle();

  return {
    loja_nome: (cfg as { nome_loja?: string } | null)?.nome_loja,
    caixa: {
      id: caixa.id as string,
      valor_inicial: valorInicial,
      valor_final: valorFinal,
      aberto_em: abertoEm,
      fechado_em: caixa.fechado_em as string | null,
      observacoes: (caixa.observacoes as string | null) || null,
    },
    vendas_mesas: {
      total: Number(vendasMesas.toFixed(2)),
      quantidade: contasList.length,
    },
    vendas_delivery: {
      total: Number(vendasDelivery.toFixed(2)),
      quantidade: deliveryCount,
    },
    total_vendas: Number((vendasMesas + vendasDelivery).toFixed(2)),
    contas_count: contasList.length,
    delivery_count: deliveryCount,
    pagamentos: mapToPagamentos(pagamentosMap),
    movimentacoes: { retirada, suprimento },
    dinheiro_esperado: dinheiroEsperado,
    diferenca,
  };
}
