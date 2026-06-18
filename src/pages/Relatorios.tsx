import { useEffect, useMemo, useState, useCallback } from "react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart3, TrendingUp, TrendingDown, Info, ChevronRight,
  Utensils, Truck, ShoppingBag, Calendar as CalendarIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fetchFaturamentoPeriodo } from "@/lib/faturamento";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Range = 7 | 15 | 30;

interface TodayKpi {
  faturamento: number;
  emAnalise: number;
  emProducao: number;
  pronto: number;
}
interface RangeKpi {
  faturamento: number;
  pedidos: number;
  ticket: number;
  faturamentoPrev: number;
  pedidosPrev: number;
  ticketPrev: number;
  delivery: number;
  retirada: number;
  mesa: number;
  vendasPorProduto: { nome: string; quantidade: number; receita: number }[];
}

interface CancelamentoDetalhe {
  hora: string;
  origem: string;
  item: string;
  motivo: string;
  valor: number;
  canceladoEm: string;
}

const isCancelamentoReal = (motivo: string | null) => {
  const value = (motivo || "").trim();
  if (!value) return true;
  return !value.toLowerCase().startsWith("pedido editado");
};

interface CancelamentosHojeKpi {
  totalItens: number;
  valorTotal: number;
  motivoMaisFrequente: string;
  detalhes: CancelamentoDetalhe[];
}

const emptyToday: TodayKpi = { faturamento: 0, emAnalise: 0, emProducao: 0, pronto: 0 };
const emptyRange: RangeKpi = {
  faturamento: 0, pedidos: 0, ticket: 0,
  faturamentoPrev: 0, pedidosPrev: 0, ticketPrev: 0,
  delivery: 0, retirada: 0, mesa: 0, vendasPorProduto: [],
};

const emptyCancelamentos: CancelamentosHojeKpi = {
  totalItens: 0,
  valorTotal: 0,
  motivoMaisFrequente: "—",
  detalhes: [],
};

type VendasAcc = Map<string, { quantidade: number; receita: number }>;

const ADICIONAL_PREFIX = "adicional:";
const EXTRA_TAXA_ENTREGA = "__taxa_entrega__";
const EXTRA_DESCONTO = "__desconto__";

function addVenda(acc: VendasAcc, key: string, quantidade: number, receita: number) {
  const cur = acc.get(key) ?? { quantidade: 0, receita: 0 };
  cur.quantidade += quantidade;
  cur.receita += receita;
  acc.set(key, cur);
}

async function fetchRangeData(ini: string, fim: string) {
  const [faturamento, pedOnlineR, contasR] = await Promise.all([
    fetchFaturamentoPeriodo(ini, fim),
    supabase
      .from("pedidos")
      .select("id, tipo_entrega, desconto, valor_desconto")
      .eq("tipo", "delivery")
      .neq("status", "cancelado")
      .gte("criado_em", ini)
      .lte("criado_em", fim),
    supabase
      .from("contas")
      .select("id")
      .eq("status", "fechada")
      .gte("fechada_em", ini)
      .lte("fechada_em", fim),
  ]);

  if (pedOnlineR.error) throw pedOnlineR.error;
  if (contasR.error) throw contasR.error;

  const pedOnline = pedOnlineR.data || [];
  const onlineIds = pedOnline.map((p) => p.id);

  let mesaIds: string[] = [];
  const contaIds = (contasR.data || []).map((conta) => conta.id);
  if (contaIds.length) {
    const pedMesaR = await supabase
      .from("pedidos")
      .select("id")
      .eq("tipo", "mesa")
      .neq("status", "cancelado")
      .in("conta_id", contaIds);

    if (pedMesaR.error) throw pedMesaR.error;
    mesaIds = (pedMesaR.data || []).map((pedido) => pedido.id);
  }

  const allPedidoIds = [...new Set([...onlineIds, ...mesaIds])];
  const acc: VendasAcc = new Map();

  if (allPedidoIds.length) {
    const itensR = await supabase
      .from("pedido_itens")
      .select("id, produto_id, quantidade, preco_unitario")
      .in("pedido_id", allPedidoIds)
      .eq("cancelado", false);

    if (itensR.error) throw itensR.error;

    const itemIds: string[] = [];
    (itensR.data || []).forEach((item) => {
      itemIds.push(item.id);
      addVenda(acc, item.produto_id ?? "—", item.quantidade, Number(item.preco_unitario) * item.quantidade);
    });

    if (itemIds.length) {
      const adicionaisR = await supabase
        .from("pedido_item_adicionais")
        .select("adicional_id, quantidade, preco_unitario")
        .in("pedido_item_id", itemIds);

      if (adicionaisR.error) throw adicionaisR.error;

      (adicionaisR.data || []).forEach((adicional) => {
        addVenda(
          acc,
          `${ADICIONAL_PREFIX}${adicional.adicional_id}`,
          adicional.quantidade,
          Number(adicional.preco_unitario) * adicional.quantidade,
        );
      });
    }
  }

  if (onlineIds.length) {
    const entregasR = await supabase.from("entregas").select("pedido_id, taxa_entrega").in("pedido_id", onlineIds);
    if (entregasR.error) throw entregasR.error;

    const pedidoMap = new Map(pedOnline.map((pedido) => [pedido.id, pedido]));
    (entregasR.data || []).forEach((entrega) => {
      const pedido = pedidoMap.get(entrega.pedido_id);
      if (!pedido || pedido.tipo_entrega === "retirada") return;
      const taxa = Number(entrega.taxa_entrega || 0);
      if (taxa > 0) addVenda(acc, EXTRA_TAXA_ENTREGA, 1, taxa);
    });

    pedOnline.forEach((pedido) => {
      const desconto = Number(pedido.desconto || 0) + Number(pedido.valor_desconto || 0);
      if (desconto > 0) addVenda(acc, EXTRA_DESCONTO, 1, -desconto);
    });
  }

  const pedidos = faturamento.pedidos;
  const ticket = pedidos > 0 ? faturamento.total / pedidos : 0;

  return {
    faturamento: faturamento.total,
    pedidos,
    ticket,
    delivery: faturamento.delivery.quantidade,
    retirada: faturamento.retirada.quantidade,
    mesa: faturamento.mesas.quantidade,
    acc,
  };
}

async function buildVendasPorProduto(acc: VendasAcc) {
  const { data: produtos } = await supabase.from("produtos").select("id, nome").order("nome");
  const catalogIds = new Set((produtos || []).map((p) => p.id));

  const adicionalIds = [...acc.keys()]
    .filter((key) => key.startsWith(ADICIONAL_PREFIX))
    .map((key) => key.slice(ADICIONAL_PREFIX.length));

  const { data: adicionaisCatalogo } = adicionalIds.length
    ? await supabase.from("adicionais").select("id, nome").in("id", adicionalIds)
    : { data: [] as { id: string; nome: string }[] };

  const adicionalNomeMap = new Map((adicionaisCatalogo || []).map((adicional) => [adicional.id, adicional.nome]));

  const lista: { nome: string; quantidade: number; receita: number }[] = (produtos || []).map((p) => {
    const v = acc.get(p.id);
    return {
      nome: p.nome as string,
      quantidade: v?.quantidade ?? 0,
      receita: v?.receita ?? 0,
    };
  });

  for (const [pid, v] of acc) {
    if (pid.startsWith(ADICIONAL_PREFIX)) {
      const adicionalId = pid.slice(ADICIONAL_PREFIX.length);
      lista.push({
        nome: adicionalNomeMap.get(adicionalId) ? `+ ${adicionalNomeMap.get(adicionalId)}` : "Adicional removido",
        quantidade: v.quantidade,
        receita: v.receita,
      });
      continue;
    }
    if (pid === EXTRA_TAXA_ENTREGA || pid === EXTRA_DESCONTO || pid === "—" || catalogIds.has(pid)) continue;
    lista.push({ nome: "Produto removido", quantidade: v.quantidade, receita: v.receita });
  }

  if (acc.has("—")) {
    const v = acc.get("—")!;
    lista.push({ nome: "Produto removido (sem ID)", quantidade: v.quantidade, receita: v.receita });
  }

  if (acc.has(EXTRA_TAXA_ENTREGA)) {
    const v = acc.get(EXTRA_TAXA_ENTREGA)!;
    lista.push({ nome: "Taxa de entrega", quantidade: v.quantidade, receita: v.receita });
  }

  if (acc.has(EXTRA_DESCONTO)) {
    const v = acc.get(EXTRA_DESCONTO)!;
    lista.push({ nome: "Descontos aplicados", quantidade: v.quantidade, receita: v.receita });
  }

  return lista.sort((a, b) => b.receita - a.receita || b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));
}

export default function Relatorios() {
  const [range, setRange] = useState<Range>(7);
  const [today, setToday] = useState<TodayKpi>(emptyToday);
  const [data, setData] = useState<RangeKpi>(emptyRange);
  const [loading, setLoading] = useState(true);
  const [cancelamentosHoje, setCancelamentosHoje] = useState<CancelamentosHojeKpi>(emptyCancelamentos);
  const [customDateStart, setCustomDateStart] = useState<Date | undefined>(undefined);
  const [customDateEnd, setCustomDateEnd] = useState<Date | undefined>(undefined);
  const [isCustom, setIsCustom] = useState(false);

  const loadToday = useCallback(async () => {
    const ini = startOfDay(new Date()).toISOString();
    const fim = endOfDay(new Date()).toISOString();

    const [faturamentoHoje, statusR] = await Promise.all([
      fetchFaturamentoPeriodo(ini, fim),
      supabase.from("pedidos").select("status, criado_em")
        .gte("criado_em", ini).lte("criado_em", fim),
    ]);
    if (statusR.error) {
      toast.error(statusR.error.message);
      return;
    }

    const faturamento = faturamentoHoje.total;
    const emAnalise = (statusR.data || []).filter((p) => p.status === "pendente").length;
    const emProducao = (statusR.data || []).filter((p) => p.status === "em_preparo").length;
    const pronto = (statusR.data || []).filter((p) => p.status === "pronto").length;

    setToday({ faturamento, emAnalise, emProducao, pronto });
  }, []);

  const loadRange = useCallback(async (r: Range) => {
    setLoading(true);
    const now = new Date();
    const ini = startOfDay(subDays(now, r - 1)).toISOString();
    const fim = endOfDay(now).toISOString();
    const iniPrev = startOfDay(subDays(now, r * 2 - 1)).toISOString();
    const fimPrev = endOfDay(subDays(now, r)).toISOString();

    try {
      const [cur, prev] = await Promise.all([
        fetchRangeData(ini, fim),
        fetchRangeData(iniPrev, fimPrev),
      ]);

      const vendasPorProduto = await buildVendasPorProduto(cur.acc);

      setData({
        faturamento: cur.faturamento, pedidos: cur.pedidos, ticket: cur.ticket,
        faturamentoPrev: prev.faturamento, pedidosPrev: prev.pedidos, ticketPrev: prev.ticket,
        delivery: cur.delivery, retirada: cur.retirada, mesa: cur.mesa,
        vendasPorProduto,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao carregar relatório");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCancelamentosHoje = useCallback(async () => {
    const ini = startOfDay(new Date()).toISOString();
    const fim = endOfDay(new Date()).toISOString();

    const { data: itens, error } = await supabase
      .from("pedido_itens")
      .select("pedido_id, produto_id, quantidade, preco_unitario, cancelado_em, motivo_cancelamento")
      .eq("cancelado", true)
      .not("cancelado_em", "is", null)
      .gte("cancelado_em", ini)
      .lte("cancelado_em", fim);

    if (error) {
      toast.error(error.message);
      return;
    }

    const itensReais = (itens || []).filter((item) => isCancelamentoReal(item.motivo_cancelamento));

    if (!itensReais.length) {
      setCancelamentosHoje(emptyCancelamentos);
      return;
    }

    const pedidoIds = Array.from(new Set(itensReais.map((i) => i.pedido_id)));
    const produtoIds = Array.from(new Set(itensReais.map((i) => i.produto_id).filter(Boolean))) as string[];

    const [{ data: pedidos }, { data: produtos }, { data: entregas }] = await Promise.all([
      supabase.from("pedidos").select("id, conta_id, tipo, tipo_entrega").in("id", pedidoIds),
      produtoIds.length
        ? supabase.from("produtos").select("id, nome").in("id", produtoIds)
        : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
      supabase.from("entregas").select("pedido_id, cliente_nome").in("pedido_id", pedidoIds),
    ]);

    const contaIds = Array.from(new Set((pedidos || []).map((p) => p.conta_id).filter(Boolean))) as string[];
    const { data: contas } = contaIds.length
      ? await supabase.from("contas").select("id, mesa_id").in("id", contaIds)
      : { data: [] as { id: string; mesa_id: string | null }[] };

    const mesaIds = Array.from(new Set((contas || []).map((c) => c.mesa_id).filter(Boolean))) as string[];
    const { data: mesas } = mesaIds.length
      ? await supabase.from("mesas").select("id, numero").in("id", mesaIds)
      : { data: [] as { id: string; numero: number }[] };

    const pedidoMap = new Map((pedidos || []).map((p) => [p.id, p]));
    const pedidoContaMap = new Map((pedidos || []).map((p) => [p.id, p.conta_id as string | null]));
    const contaMesaMap = new Map((contas || []).map((c) => [c.id, c.mesa_id as string | null]));
    const mesaNumeroMap = new Map((mesas || []).map((m) => [m.id, m.numero]));
    const produtoMap = new Map((produtos || []).map((p) => [p.id, p.nome]));
    const entregaMap = new Map((entregas || []).map((e) => [e.pedido_id, e.cliente_nome as string]));

    const resolveOrigem = (pedidoId: string) => {
      const pedido = pedidoMap.get(pedidoId);
      if (!pedido) return "—";

      if (pedido.tipo === "delivery") {
        const cliente = entregaMap.get(pedidoId);
        return pedido.tipo_entrega === "retirada"
          ? `Retirada${cliente ? ` — ${cliente}` : ""}`
          : `Delivery${cliente ? ` — ${cliente}` : ""}`;
      }

      const contaId = pedidoContaMap.get(pedidoId);
      const mesaId = contaId ? contaMesaMap.get(contaId) : null;
      const numeroMesa = mesaId ? mesaNumeroMap.get(mesaId) : null;
      return numeroMesa != null ? `Mesa ${String(numeroMesa).padStart(2, "0")}` : "Mesa";
    };

    const motivoBase = (motivo: string | null) => {
      const value = motivo || "Não informado";
      const [base] = value.split("| Obs:");
      return base.trim() || "Não informado";
    };

    const freq = new Map<string, number>();
    let totalItens = 0;
    let valorTotal = 0;

    const detalhes: CancelamentoDetalhe[] = itensReais
      .map((item) => {
        totalItens += item.quantidade;
        const subtotal = Number(item.preco_unitario) * item.quantidade;
        valorTotal += subtotal;

        const base = motivoBase(item.motivo_cancelamento);
        freq.set(base, (freq.get(base) || 0) + item.quantidade);

        return {
          hora: item.cancelado_em ? new Date(item.cancelado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—",
          origem: resolveOrigem(item.pedido_id),
          item: item.produto_id ? (produtoMap.get(item.produto_id) || "Produto removido") : "Produto removido",
          motivo: base,
          valor: subtotal,
          canceladoEm: item.cancelado_em || "",
        };
      })
      .sort((a, b) => b.canceladoEm.localeCompare(a.canceladoEm));

    const motivoMaisFrequente = Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    setCancelamentosHoje({
      totalItens,
      valorTotal,
      motivoMaisFrequente,
      detalhes,
    });
  }, []);

  const loadCustomRange = useCallback(async (dateStart: Date, dateEnd: Date) => {
    setLoading(true);
    const ini = startOfDay(dateStart).toISOString();
    const fim = endOfDay(dateEnd).toISOString();
    
    // Para período anterior, use a mesma duração
    const duration = dateEnd.getTime() - dateStart.getTime();
    const iniPrev = startOfDay(new Date(dateStart.getTime() - duration)).toISOString();
    const fimPrev = endOfDay(new Date(dateStart.getTime() - 86400000)).toISOString();

    try {
      const [cur, prev] = await Promise.all([
        fetchRangeData(ini, fim),
        fetchRangeData(iniPrev, fimPrev),
      ]);

      const vendasPorProduto = await buildVendasPorProduto(cur.acc);

      setData({
        faturamento: cur.faturamento, pedidos: cur.pedidos, ticket: cur.ticket,
        faturamentoPrev: prev.faturamento, pedidosPrev: prev.pedidos, ticketPrev: prev.ticket,
        delivery: cur.delivery, retirada: cur.retirada, mesa: cur.mesa,
        vendasPorProduto,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao carregar relatório");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { loadCancelamentosHoje(); }, [loadCancelamentosHoje]);
  useEffect(() => { 
    if (isCustom && customDateStart && customDateEnd) {
      loadCustomRange(customDateStart, customDateEnd);
    } else {
      loadRange(range);
    }
  }, [range, loadRange, isCustom, customDateStart, customDateEnd, loadCustomRange]);

  const periodLabel = useMemo(() => {
    if (isCustom && customDateStart && customDateEnd) {
      return `${format(customDateStart, "dd/MM/yyyy")} a ${format(customDateEnd, "dd/MM/yyyy")}`;
    }
    const ini = subDays(new Date(), range - 1);
    return `${format(ini, "dd/MM/yyyy")} a ${format(new Date(), "dd/MM/yyyy")}`;
  }, [range, isCustom, customDateStart, customDateEnd]);

  const trendPct = (cur: number, prev: number) => {
    if (prev === 0) return cur === 0 ? 0 : 100;
    return ((cur - prev) / prev) * 100;
  };

  const totalModalidade = data.delivery + data.retirada + data.mesa || 1;
  const vendasComMovimento = data.vendasPorProduto.filter((p) => p.quantidade > 0 || p.receita !== 0);
  const maxQtd = Math.max(...vendasComMovimento.map((p) => p.quantidade), 1);
  const totalItensVendidos = data.vendasPorProduto.reduce((s, p) => s + (p.receita >= 0 ? p.quantidade : 0), 0);
  const totalReceitaItens = data.vendasPorProduto.reduce((s, p) => s + p.receita, 0);
  const diferencaFaturamento = data.faturamento - totalReceitaItens;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-5xl text-foreground flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-primary" /> Meu desempenho
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Início <ChevronRight className="inline w-3 h-3" /> <span className="text-primary font-medium">Meu desempenho</span>
        </p>
      </div>

      {/* Today KPIs com top color bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <TodayCard color="hsl(210 90% 50%)" label="Faturamento de hoje" value={brl(today.faturamento)} icon={<Info className="w-4 h-4 opacity-70" />} />
        <TodayCard color="hsl(20 90% 55%)" label="Em análise agora" value={String(today.emAnalise)} />
        <TodayCard color="hsl(45 95% 55%)" label="Em produção agora" value={String(today.emProducao)} />
        <TodayCard color="hsl(142 65% 45%)" label="Pronto para entrega" value={String(today.pronto)} />
      </div>

      <Card className="p-5 shadow-soft border-destructive/20">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-2xl text-destructive">Cancelamentos hoje</h2>
            <p className="text-sm text-muted-foreground">Visão rápida dos cancelamentos do dia</p>
          </div>
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Itens cancelados</div>
              <div className="font-display text-3xl text-destructive">{cancelamentosHoje.totalItens}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Valor cancelado</div>
              <div className="font-display text-3xl text-destructive">{brl(cancelamentosHoje.valorTotal)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Motivo mais frequente</div>
              <div className="text-sm font-semibold">{cancelamentosHoje.motivoMaisFrequente}</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Period selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-muted-foreground">{periodLabel}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border bg-card p-1 shadow-soft">
            {([7, 15, 30] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => { setIsCustom(false); setRange(r); }}
                className={cn(
                  "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                  !isCustom && range === r ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Últimos {r} dias
              </button>
            ))}
          </div>

          {/* Custom date range picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "gap-2",
                  isCustom && "bg-primary text-primary-foreground"
                )}
              >
                <CalendarIcon className="w-4 h-4" />
                Período customizado
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 flex flex-col" align="end">
              <div className="p-4 border-b">
                <p className="text-sm font-medium mb-3">Selecione o período</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-2">Data inicial</p>
                    <Calendar
                      mode="single"
                      selected={customDateStart}
                      onSelect={(date) => setCustomDateStart(date)}
                      locale={ptBR}
                      disabled={(date) => customDateEnd ? date > customDateEnd : false}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-2">Data final</p>
                    <Calendar
                      mode="single"
                      selected={customDateEnd}
                      onSelect={(date) => setCustomDateEnd(date)}
                      locale={ptBR}
                      disabled={(date) => customDateStart ? date < customDateStart : false}
                    />
                  </div>
                </div>
              </div>
              <div className="p-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCustomDateStart(undefined);
                    setCustomDateEnd(undefined);
                    setIsCustom(false);
                  }}
                  className="flex-1"
                >
                  Limpar
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (customDateStart && customDateEnd) {
                      setIsCustom(true);
                    }
                  }}
                  disabled={!customDateStart || !customDateEnd}
                  className="flex-1"
                >
                  Aplicar
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Range metrics with trend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard label="Faturamento" value={loading ? "—" : brl(data.faturamento)} trend={trendPct(data.faturamento, data.faturamentoPrev)} />
        <MetricCard label="Pedidos" value={loading ? "—" : String(data.pedidos)} trend={trendPct(data.pedidos, data.pedidosPrev)} />
        <MetricCard label="Ticket médio" value={loading ? "—" : brl(data.ticket)} trend={trendPct(data.ticket, data.ticketPrev)} />
      </div>

      {/* Modalidade + Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-6 shadow-card">
          <h3 className="font-semibold text-foreground">Qualidade do Cardápio</h3>
          <p className="text-xs text-muted-foreground mt-1">Quanto maior a pontuação, mais pedidos você pode receber!</p>
          <div className="flex flex-col items-center mt-6">
            <Gauge value={99} max={100} color="hsl(var(--status-livre))" big />
            <p className="text-sm text-muted-foreground mt-2">do cardápio otimizado</p>
            <button className="text-primary text-sm font-medium mt-3 hover:underline">Saiba mais</button>
          </div>
        </Card>

        <Card className="p-6 shadow-card lg:col-span-2">
          <div className="border-b mb-6 -mx-6 px-6">
            <div className="inline-flex">
              <div className="px-1 pb-3 border-b-2 border-primary text-primary font-semibold text-sm">
                Pedidos por modalidade
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 place-items-center md:grid-cols-3">
            <ModalidadeGauge
              icon={<Truck className="w-4 h-4" />}
              label="Delivery"
              value={data.delivery}
              total={totalModalidade}
              color="hsl(210 90% 55%)"
            />
            <ModalidadeGauge
              icon={<ShoppingBag className="w-4 h-4" />}
              label="Retirada"
              value={data.retirada}
              total={totalModalidade}
              color="hsl(212 85% 60%)"
            />
            <ModalidadeGauge
              icon={<Utensils className="w-4 h-4" />}
              label="Consumo no local"
              value={data.mesa}
              total={totalModalidade}
              color="hsl(var(--primary))"
            />
          </div>
        </Card>
      </div>

      <Card className="shadow-card">
        <div className="p-5 border-b flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-display text-2xl">Vendas por produto</h2>
              <p className="text-sm text-muted-foreground">
                Mesa, delivery e retirada — inclui produtos, adicionais, taxas e descontos do período.
              </p>
            </div>
          </div>
          {!loading && (
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Itens vendidos</div>
                <div className="font-display text-2xl">{totalItensVendidos}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Receita de itens</div>
                <div className="font-display text-2xl text-primary">{brl(totalReceitaItens)}</div>
              </div>
              {Math.abs(diferencaFaturamento) >= 0.01 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Diferença p/ faturamento</div>
                  <div className="font-display text-2xl text-muted-foreground">{brl(diferencaFaturamento)}</div>
                </div>
              )}
            </div>
          )}
        </div>
        {!loading && Math.abs(diferencaFaturamento) >= 0.01 && (
          <p className="px-5 pb-4 text-xs text-muted-foreground border-b">
            O faturamento usa o total fechado de cada venda. A receita de itens detalha produto a produto — pequenas diferenças podem ocorrer por arredondamentos ou ajustes manuais na conta.
          </p>
        )}
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Calculando...</div>
        ) : vendasComMovimento.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">Nenhuma venda registrada no período.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-[35%]">Participação</TableHead>
                <TableHead className="text-right w-24">Qtd. vendida</TableHead>
                <TableHead className="text-right w-32">Receita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendasComMovimento.map((p) => (
                <TableRow key={p.nome}>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-gradient-primary"
                        style={{ width: `${(Math.max(p.quantidade, 0) / maxQtd) * 100}%` }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{p.receita < 0 ? "—" : p.quantidade}</TableCell>
                  <TableCell className={cn("text-right font-semibold", p.receita < 0 ? "text-destructive" : "text-primary")}>
                    {brl(p.receita)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="shadow-card">
        <div className="p-5 border-b">
          <h2 className="font-display text-2xl">Detalhamento de cancelamentos do dia</h2>
        </div>
        {cancelamentosHoje.detalhes.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">Nenhum cancelamento registrado hoje.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Hora</TableHead>
                <TableHead className="w-40">Origem</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right w-32">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cancelamentosHoje.detalhes.map((linha, idx) => (
                <TableRow key={`${linha.hora}-${linha.item}-${idx}`}>
                  <TableCell>{linha.hora}</TableCell>
                  <TableCell>{linha.origem}</TableCell>
                  <TableCell className="font-medium">{linha.item}</TableCell>
                  <TableCell>{linha.motivo}</TableCell>
                  <TableCell className="text-right text-destructive font-semibold">{brl(linha.valor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function TodayCard({ color, label, value, icon }: { color: string; label: string; value: string; icon?: React.ReactNode }) {
  return (
    <Card className="overflow-hidden shadow-soft">
      <div className="px-4 py-2.5 flex items-center justify-between text-white" style={{ backgroundColor: color }}>
        <span className="text-sm font-semibold">{label}</span>
        {icon}
      </div>
      <div className="px-4 py-5">
        <div className="font-display text-3xl">{value}</div>
      </div>
    </Card>
  );
}

function MetricCard({ label, value, trend }: { label: string; value: string; trend: number }) {
  const up = trend >= 0;
  return (
    <Card className="p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground font-medium">{label}</span>
        <span className={cn("text-xs font-semibold inline-flex items-center gap-1", up ? "text-status-livre" : "text-accent")}>
          {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(trend).toFixed(2)}%
        </span>
      </div>
      <div className="font-display text-3xl mt-2">{value}</div>
    </Card>
  );
}

function Gauge({ value, max, color, big = false }: { value: number; max: number; color: string; big?: boolean }) {
  const size = big ? 180 : 140;
  const stroke = big ? 18 : 14;
  const r = (size - stroke) / 2;
  const c = Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <div className="relative inline-block" style={{ width: size, height: size / 2 + 10 }}>
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
        <path
          d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} strokeLinecap="round"
        />
        <path
          d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <div className="absolute inset-x-0 top-1/2 -translate-y-2 text-center">
        <div className={cn("font-display", big ? "text-4xl" : "text-3xl")}>
          {big ? `${Math.round(pct * 100)}%` : value}
        </div>
      </div>
    </div>
  );
}

function ModalidadeGauge({ icon, label, value, total, color }: { icon: React.ReactNode; label: string; value: number; total: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <Gauge value={value} max={total} color={color} />
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
        {icon}{label}
      </div>
    </div>
  );
}
