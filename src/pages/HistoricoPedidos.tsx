import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bike,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  Phone,
  Printer,
  Search,
  Store,
  Utensils,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchFaturamentoPeriodo } from "@/lib/faturamento";
import { brl } from "@/lib/format";
import { printReceipt } from "@/lib/print";
import { toast } from "sonner";
import type { FormaPagamento, PedidoStatus, PedidoTipo, TipoEntrega } from "@/types/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type PeriodoFiltro = "hoje" | "ontem" | "7dias" | "30dias";
type TipoFiltro = "todos" | "mesa" | "delivery" | "retirada";

interface PedidoHistoricoRow {
  id: string;
  tipo: PedidoTipo;
  tipo_entrega: TipoEntrega | null;
  status: PedidoStatus;
  criado_em: string;
  subtotal: number;
  desconto: number;
  valor_desconto: number;
  total: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  mesa_numero: number | null;
  forma_pagamento: FormaPagamento | null;
  taxa_entrega: number;
  fechado_em: string | null;
}

interface ItemDetalhe {
  id: string;
  nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao: string | null;
  cancelado: boolean;
  adicionais: Array<{ nome: string; quantidade: number; preco_unitario: number }>;
}

const statusLabel: Record<PedidoStatus, string> = {
  pendente: "Pendente",
  em_preparo: "Em preparo",
  pronto: "Pronto",
  entregue: "Concluído",
  cancelado: "Cancelado",
};

const statusClass: Record<PedidoStatus, string> = {
  pendente: "bg-amber-100 text-amber-800 border-amber-200",
  em_preparo: "bg-orange-100 text-orange-800 border-orange-200",
  pronto: "bg-emerald-100 text-emerald-800 border-emerald-200",
  entregue: "bg-emerald-100 text-emerald-800 border-emerald-200",
  cancelado: "bg-red-100 text-red-800 border-red-200",
};

const formaLabel: Record<FormaPagamento, string> = {
  pix: "Pix",
  boleto: "Boleto",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
};

const periodoInicio = (periodo: PeriodoFiltro) => {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  if (periodo === "ontem") {
    base.setDate(base.getDate() - 1);
    return base;
  }
  if (periodo === "7dias") {
    base.setDate(base.getDate() - 6);
    return base;
  }
  if (periodo === "30dias") {
    base.setDate(base.getDate() - 29);
    return base;
  }
  return base;
};

const periodoFim = (periodo: PeriodoFiltro) => {
  if (periodo !== "ontem") return null;
  const fim = periodoInicio("ontem");
  fim.setHours(23, 59, 59, 999);
  return fim;
};

const periodoToIsoRange = (periodo: PeriodoFiltro) => {
  const ini = periodoInicio(periodo);
  const fim = periodoFim(periodo) ?? new Date();
  if (!periodoFim(periodo)) {
    fim.setHours(23, 59, 59, 999);
  }
  return { ini: ini.toISOString(), fim: fim.toISOString() };
};

const pedidoCodigo = (id: string) => id.slice(0, 8).toUpperCase();

const origemLabel = (row: PedidoHistoricoRow) => {
  if (row.tipo === "mesa") return row.mesa_numero ? `Mesa ${row.mesa_numero}` : "Mesa";
  if (row.tipo_entrega === "retirada") return "Retirada";
  return "Delivery";
};

const origemIcon = (row: PedidoHistoricoRow) => {
  if (row.tipo === "mesa") return Utensils;
  if (row.tipo_entrega === "retirada") return Store;
  return Bike;
};

export default function HistoricoPedidos() {
  const [rows, setRows] = useState<PedidoHistoricoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("hoje");
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>("todos");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [itensCache, setItensCache] = useState<Record<string, ItemDetalhe[]>>({});
  const [itensLoading, setItensLoading] = useState<string | null>(null);
  const [resumoPeriodo, setResumoPeriodo] = useState({ vendas: 0, faturamento: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const inicio = periodoInicio(periodo);
    const fim = periodoFim(periodo);

    let query = supabase
      .from("pedidos")
      .select("id, tipo, status, criado_em, subtotal, desconto, valor_desconto, total, tipo_entrega, conta_id, cliente_id")
      .gte("criado_em", inicio.toISOString())
      .order("criado_em", { ascending: false })
      .limit(200);

    if (fim) {
      query = query.lte("criado_em", fim.toISOString());
    }

    if (tipoFiltro === "mesa") {
      query = query.eq("tipo", "mesa");
    } else if (tipoFiltro === "delivery") {
      query = query.eq("tipo", "delivery").eq("tipo_entrega", "delivery");
    } else if (tipoFiltro === "retirada") {
      query = query.eq("tipo", "delivery").eq("tipo_entrega", "retirada");
    }

    const { data: pedidos, error } = await query;
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    const lista = pedidos || [];
    if (!lista.length) {
      setRows([]);
      setLoading(false);
      return;
    }

    const pedidoIds = lista.map((p) => p.id);
    const contaIds = Array.from(new Set(lista.map((p) => p.conta_id).filter(Boolean))) as string[];
    const clienteIds = Array.from(new Set(lista.map((p) => p.cliente_id).filter(Boolean))) as string[];

    const [{ data: entregas }, { data: contas }, { data: clientes }, { data: itensResumo }] = await Promise.all([
      supabase
        .from("entregas")
        .select("pedido_id, cliente_nome, cliente_telefone, taxa_entrega, forma_pagamento")
        .in("pedido_id", pedidoIds),
      contaIds.length
        ? supabase.from("contas").select("id, fechada_em, forma_pagamento, mesa_id, total, mesas(numero)").in("id", contaIds)
        : Promise.resolve({ data: [] as Array<{ id: string; fechada_em: string | null; forma_pagamento: FormaPagamento | null; mesa_id: string | null; total: number; mesas: { numero: number } | null }> }),
      clienteIds.length
        ? supabase.from("clientes").select("id, nome, telefone").in("id", clienteIds)
        : Promise.resolve({ data: [] as Array<{ id: string; nome: string; telefone: string }> }),
      supabase
        .from("pedido_itens")
        .select("pedido_id, quantidade, preco_unitario, cancelado")
        .in("pedido_id", pedidoIds),
    ]);

    const itemTotals = new Map<string, number>();
    (itensResumo || []).forEach((item) => {
      if (item.cancelado) return;
      itemTotals.set(
        item.pedido_id,
        (itemTotals.get(item.pedido_id) || 0) + Number(item.preco_unitario) * item.quantidade
      );
    });

    const entregaMap = new Map((entregas || []).map((e) => [e.pedido_id, e]));
    const contaMap = new Map((contas || []).map((c) => [c.id, c]));
    const clienteMap = new Map((clientes || []).map((c) => [c.id, c]));

    const montados: PedidoHistoricoRow[] = lista.map((pedido) => {
      const entrega = entregaMap.get(pedido.id);
      const conta = pedido.conta_id ? contaMap.get(pedido.conta_id) : null;
      const cliente = pedido.cliente_id ? clienteMap.get(pedido.cliente_id) : null;
      const taxa = Number(entrega?.taxa_entrega || 0);
      const subtotalItens = itemTotals.get(pedido.id) || 0;
      const subtotal = Number(pedido.subtotal || 0) || subtotalItens;
      const desconto = Number(pedido.desconto || 0) + Number(pedido.valor_desconto || 0);
      const totalPedido = Number(pedido.total || 0);
      const totalCalculado = totalPedido > 0 ? totalPedido : Math.max(subtotal + taxa - desconto, subtotalItens + taxa - desconto, 0);

      return {
        id: pedido.id,
        tipo: pedido.tipo as PedidoTipo,
        tipo_entrega: (pedido.tipo_entrega as TipoEntrega | null) ?? null,
        status: pedido.status as PedidoStatus,
        criado_em: pedido.criado_em,
        subtotal,
        desconto,
        valor_desconto: Number(pedido.valor_desconto || 0),
        total: totalCalculado,
        cliente_nome: entrega?.cliente_nome || cliente?.nome || null,
        cliente_telefone: entrega?.cliente_telefone || cliente?.telefone || null,
        mesa_numero: conta?.mesas?.numero ?? null,
        forma_pagamento: (entrega?.forma_pagamento || conta?.forma_pagamento || null) as FormaPagamento | null,
        taxa_entrega: taxa,
        fechado_em: conta?.fechada_em ?? null,
      };
    });

    setRows(montados);

    try {
      const { ini, fim } = periodoToIsoRange(periodo);
      const fat = await fetchFaturamentoPeriodo(ini, fim);
      if (tipoFiltro === "mesa") {
        setResumoPeriodo({ vendas: fat.mesas.quantidade, faturamento: fat.mesas.total });
      } else if (tipoFiltro === "delivery") {
        setResumoPeriodo({ vendas: fat.delivery.quantidade, faturamento: fat.delivery.total });
      } else if (tipoFiltro === "retirada") {
        setResumoPeriodo({ vendas: fat.retirada.quantidade, faturamento: fat.retirada.total });
      } else {
        setResumoPeriodo({ vendas: fat.pedidos, faturamento: fat.total });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao calcular faturamento";
      toast.error(message);
      setResumoPeriodo({ vendas: 0, faturamento: 0 });
    }

    setLoading(false);
  }, [periodo, tipoFiltro]);

  useEffect(() => {
    void load();
  }, [load]);

  const rowsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase().replace(/\D/g, "");
    const termoTexto = busca.trim().toLowerCase();
    if (!termo && !termoTexto) return rows;

    return rows.filter((row) => {
      const codigo = pedidoCodigo(row.id).toLowerCase();
      const nome = (row.cliente_nome || "").toLowerCase();
      const telefone = (row.cliente_telefone || "").replace(/\D/g, "");
      const mesa = row.mesa_numero ? String(row.mesa_numero) : "";

      if (termoTexto && codigo.includes(termoTexto.replace("#", ""))) return true;
      if (termoTexto && nome.includes(termoTexto)) return true;
      if (termo && telefone.includes(termo)) return true;
      if (termoTexto && mesa.includes(termoTexto)) return true;
      return false;
    });
  }, [busca, rows]);

  const carregarItens = async (pedidoId: string): Promise<ItemDetalhe[]> => {
    if (itensCache[pedidoId]) return itensCache[pedidoId];
    setItensLoading(pedidoId);

    const { data: itens, error } = await supabase
      .from("pedido_itens")
      .select("id, quantidade, preco_unitario, observacao, produto_id, cancelado")
      .eq("pedido_id", pedidoId);

    if (error) {
      setItensLoading(null);
      toast.error(error.message);
      return [];
    }

    const itensList = itens || [];
    const prodIds = Array.from(new Set(itensList.map((i) => i.produto_id).filter(Boolean))) as string[];
    const itemIds = itensList.map((i) => i.id);

    const [{ data: produtos }, { data: itemAdicionais }] = await Promise.all([
      prodIds.length
        ? supabase.from("produtos").select("id, nome").in("id", prodIds)
        : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
      itemIds.length
        ? supabase.from("pedido_item_adicionais").select("pedido_item_id, adicional_id, quantidade, preco_unitario").in("pedido_item_id", itemIds)
        : Promise.resolve({ data: [] as { pedido_item_id: string; adicional_id: string; quantidade: number; preco_unitario: number }[] }),
    ]);

    const adicionalIds = Array.from(new Set((itemAdicionais || []).map((a) => a.adicional_id).filter(Boolean)));
    const { data: adicionais } = adicionalIds.length
      ? await supabase.from("adicionais").select("id, nome").in("id", adicionalIds)
      : { data: [] as { id: string; nome: string }[] };

    const prodMap = new Map((produtos || []).map((p) => [p.id, p.nome]));
    const adicionalMap = new Map((adicionais || []).map((a) => [a.id, a.nome]));
    const adPorItem = new Map<string, ItemDetalhe["adicionais"]>();

    (itemAdicionais || []).forEach((adicional) => {
      const atual = adPorItem.get(adicional.pedido_item_id) ?? [];
      atual.push({
        nome: adicionalMap.get(adicional.adicional_id) ?? "Adicional",
        quantidade: adicional.quantidade,
        preco_unitario: Number(adicional.preco_unitario),
      });
      adPorItem.set(adicional.pedido_item_id, atual);
    });

    const detalhes: ItemDetalhe[] = itensList.map((item) => ({
      id: item.id,
      nome: item.produto_id ? prodMap.get(item.produto_id) ?? "Item" : "Item",
      quantidade: item.quantidade,
      preco_unitario: Number(item.preco_unitario),
      observacao: item.observacao,
      cancelado: !!item.cancelado,
      adicionais: adPorItem.get(item.id) ?? [],
    }));

    setItensCache((current) => ({ ...current, [pedidoId]: detalhes }));
    setItensLoading(null);
    return detalhes;
  };

  const toggleExpandir = async (pedidoId: string) => {
    if (expandido === pedidoId) {
      setExpandido(null);
      return;
    }
    setExpandido(pedidoId);
    await carregarItens(pedidoId);
  };

  const imprimirPedido = async (row: PedidoHistoricoRow) => {
    const lista = await carregarItens(row.id);
    const { data: cfgData } = await supabase.from("configuracoes").select("nome_loja").limit(1).maybeSingle();

    if (row.tipo === "mesa") {
      printReceipt({
        tipo: "mesa",
        loja_nome: cfgData?.nome_loja,
        mesa_numero: row.mesa_numero || 0,
        pedidos: [{
          numero: 1,
          criado_em: row.criado_em,
          itens: lista.filter((i) => !i.cancelado).map((i) => ({
            nome: i.nome,
            quantidade: i.quantidade,
            preco_unitario: i.preco_unitario,
            observacao: i.observacao,
            adicionais: i.adicionais,
          })),
        }],
        total: row.total,
        forma_pagamento: row.forma_pagamento,
      });
      return;
    }

    const { data: entrega } = await supabase
      .from("entregas")
      .select("endereco, numero, complemento, bairro, troco_para")
      .eq("pedido_id", row.id)
      .maybeSingle();

    printReceipt({
      tipo: row.tipo_entrega === "retirada" ? "retirada" : "delivery",
      loja_nome: cfgData?.nome_loja,
      cliente_nome: row.cliente_nome || "Cliente",
      cliente_telefone: row.cliente_telefone || "",
      endereco: entrega?.endereco || "Retirada no balcão",
      numero: entrega?.numero,
      complemento: entrega?.complemento,
      bairro: entrega?.bairro,
      taxa_entrega: row.taxa_entrega,
      forma_pagamento: row.forma_pagamento,
      troco_para: entrega?.troco_para != null ? Number(entrega.troco_para) : null,
      itens: lista.filter((i) => !i.cancelado).map((i) => ({
        nome: i.nome,
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
        observacao: i.observacao,
        adicionais: i.adicionais,
      })),
      subtotal: row.subtotal,
      total: row.total,
      criado_em: row.criado_em,
    });
  };

  const resumoDia = useMemo(() => {
    if (busca.trim()) {
      const concluidos = rowsFiltrados.filter((r) => r.status !== "cancelado");
      return {
        vendas: concluidos.length,
        faturamento: concluidos.reduce((s, r) => s + r.total, 0),
      };
    }
    return resumoPeriodo;
  }, [busca, rowsFiltrados, resumoPeriodo]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-foreground flex items-center gap-3">
            <History className="w-8 h-8 text-primary" /> Histórico
          </h1>
          <p className="text-muted-foreground mt-1">
            Registro de vendas para consultar quando o cliente questionar um pedido.
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="text-muted-foreground">No período filtrado</div>
          <div className="font-display text-2xl text-primary">{brl(resumoDia.faturamento)}</div>
          <div className="text-xs text-muted-foreground">{resumoDia.vendas} venda(s)</div>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por nome, telefone, mesa ou # do pedido"
              className="pl-9"
            />
          </div>
          <Select value={periodo} onValueChange={(value) => setPeriodo(value as PeriodoFiltro)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="ontem">Ontem</SelectItem>
              <SelectItem value="7dias">Últimos 7 dias</SelectItem>
              <SelectItem value="30dias">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tipoFiltro} onValueChange={(value) => setTipoFiltro(value as TipoFiltro)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="mesa">Mesas</SelectItem>
              <SelectItem value="delivery">Delivery</SelectItem>
              <SelectItem value="retirada">Retirada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground grid grid-cols-[90px_1fr_120px_100px_40px] gap-3">
          <span>Hora</span>
          <span>Pedido / Cliente</span>
          <span>Origem</span>
          <span className="text-right">Total</span>
          <span />
        </div>

        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Carregando histórico...</div>
        ) : rowsFiltrados.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Nenhum pedido encontrado para os filtros selecionados.
          </div>
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-y-auto divide-y">
            {rowsFiltrados.map((row) => {
              const aberto = expandido === row.id;
              const Icon = origemIcon(row);
              const itens = itensCache[row.id] || [];

              return (
                <div key={row.id} className="bg-card">
                  <button
                    type="button"
                    onClick={() => void toggleExpandir(row.id)}
                    className="w-full px-4 py-3 grid grid-cols-[90px_1fr_120px_100px_40px] gap-3 items-center text-left hover:bg-muted/30 transition-colors"
                  >
                    <div className="text-sm">
                      <div className="font-medium">
                        {new Date(row.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(row.criado_em).toLocaleDateString("pt-BR")}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                          #{pedidoCodigo(row.id)}
                        </span>
                        <Badge variant="outline" className={statusClass[row.status]}>
                          {statusLabel[row.status]}
                        </Badge>
                      </div>
                      <div className="font-medium truncate mt-1">
                        {row.cliente_nome || (row.tipo === "mesa" ? `Conta mesa ${row.mesa_numero ?? "—"}` : "Sem cliente")}
                      </div>
                      {row.cliente_telefone && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Phone className="h-3 w-3" />
                          {row.cliente_telefone}
                        </div>
                      )}
                    </div>

                    <div className="text-sm flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {origemLabel(row)}
                    </div>

                    <div className="text-right">
                      <div className="font-display text-lg text-primary">{brl(row.total)}</div>
                      {row.forma_pagamento && (
                        <div className="text-[11px] text-muted-foreground">
                          {formaLabel[row.forma_pagamento]}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end text-muted-foreground">
                      {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>

                  {aberto && (
                    <div className="px-4 pb-4 bg-muted/20 border-t">
                      {itensLoading === row.id ? (
                        <div className="py-4 text-sm text-muted-foreground">Carregando itens...</div>
                      ) : (
                        <div className="space-y-3 pt-3">
                          <div className="rounded-xl border bg-card p-3 space-y-2">
                            {itens.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Nenhum item registrado.</p>
                            ) : (
                              itens.map((item) => (
                                <div
                                  key={item.id}
                                  className={cn(
                                    "flex items-start justify-between gap-3 text-sm",
                                    item.cancelado && "opacity-50 line-through"
                                  )}
                                >
                                  <div>
                                    <div className="font-medium">
                                      {item.quantidade}x {item.nome}
                                      {item.cancelado && " (cancelado)"}
                                    </div>
                                    {item.observacao && (
                                      <div className="text-xs text-muted-foreground">Obs: {item.observacao}</div>
                                    )}
                                    {item.adicionais.map((adicional, idx) => (
                                      <div key={idx} className="text-xs text-muted-foreground pl-3">
                                        + {adicional.quantidade}x {adicional.nome}
                                      </div>
                                    ))}
                                  </div>
                                  <div className="font-medium shrink-0">
                                    {brl(item.preco_unitario * item.quantidade + item.adicionais.reduce((s, a) => s + a.preco_unitario * a.quantidade, 0))}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <div className="space-y-1 text-muted-foreground">
                              {row.taxa_entrega > 0 && <div>Taxa de entrega: {brl(row.taxa_entrega)}</div>}
                              {row.desconto > 0 && <div>Desconto: -{brl(row.desconto)}</div>}
                              {row.fechado_em && (
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  Fechado em {new Date(row.fechado_em).toLocaleString("pt-BR")}
                                </div>
                              )}
                            </div>
                            <Button variant="outline" size="sm" onClick={() => void imprimirPedido(row)}>
                              <Printer className="h-3.5 w-3.5 mr-1" />
                              Reimprimir
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
