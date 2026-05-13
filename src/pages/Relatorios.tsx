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
  mesa: number;
  topProdutos: { nome: string; quantidade: number; receita: number }[];
}

const emptyToday: TodayKpi = { faturamento: 0, emAnalise: 0, emProducao: 0, pronto: 0 };
const emptyRange: RangeKpi = {
  faturamento: 0, pedidos: 0, ticket: 0,
  faturamentoPrev: 0, pedidosPrev: 0, ticketPrev: 0,
  delivery: 0, mesa: 0, topProdutos: [],
};

async function fetchRangeData(ini: string, fim: string) {
  const [contasR, pedDelR, pedMesaR] = await Promise.all([
    supabase.from("contas").select("id, total")
      .eq("status", "fechada").gte("fechada_em", ini).lte("fechada_em", fim),
    supabase.from("pedidos").select("id")
      .eq("tipo", "delivery").gte("criado_em", ini).lte("criado_em", fim),
    supabase.from("pedidos").select("id")
      .eq("tipo", "mesa").gte("criado_em", ini).lte("criado_em", fim),
  ]);
  const contas = contasR.data || [];
  const pedDel = pedDelR.data || [];
  const pedMesa = pedMesaR.data || [];

  const allIds = [...pedDel, ...pedMesa].map((p) => p.id);
  let receitaDelItens = 0;
  let taxas = 0;
  const acc = new Map<string, { quantidade: number; receita: number }>();

  if (allIds.length) {
    const [{ data: itens }, entR] = await Promise.all([
      supabase.from("pedido_itens").select("pedido_id, produto_id, quantidade, preco_unitario").in("pedido_id", allIds),
      pedDel.length
        ? supabase.from("entregas").select("taxa_entrega").in("pedido_id", pedDel.map((p) => p.id))
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const delIds = new Set(pedDel.map((p) => p.id));
    (itens || []).forEach((i) => {
      const sub = Number(i.preco_unitario) * i.quantidade;
      if (delIds.has(i.pedido_id)) receitaDelItens += sub;
      const key = i.produto_id ?? "—";
      const cur = acc.get(key) ?? { quantidade: 0, receita: 0 };
      cur.quantidade += i.quantidade;
      cur.receita += sub;
      acc.set(key, cur);
    });
    taxas = (entR.data || []).reduce((s: number, e: any) => s + Number(e.taxa_entrega || 0), 0);
  }

  const totalContas = contas.reduce((s, c) => s + Number(c.total || 0), 0);
  const faturamento = totalContas + receitaDelItens + taxas;
  const pedidos = pedDel.length + pedMesa.length;
  const ticket = pedidos > 0 ? faturamento / pedidos : 0;

  return {
    faturamento, pedidos, ticket,
    delivery: pedDel.length, mesa: pedMesa.length,
    acc,
  };
}

export default function Relatorios() {
  const [range, setRange] = useState<Range>(7);
  const [today, setToday] = useState<TodayKpi>(emptyToday);
  const [data, setData] = useState<RangeKpi>(emptyRange);
  const [loading, setLoading] = useState(true);
  const [customDateStart, setCustomDateStart] = useState<Date | undefined>(undefined);
  const [customDateEnd, setCustomDateEnd] = useState<Date | undefined>(undefined);
  const [isCustom, setIsCustom] = useState(false);

  const loadToday = useCallback(async () => {
    const ini = startOfDay(new Date()).toISOString();
    const fim = endOfDay(new Date()).toISOString();

    const [contasR, statusR] = await Promise.all([
      supabase.from("contas").select("total")
        .eq("status", "fechada").gte("fechada_em", ini).lte("fechada_em", fim),
      supabase.from("pedidos").select("status, criado_em")
        .gte("criado_em", ini).lte("criado_em", fim),
    ]);
    if (contasR.error || statusR.error) {
      toast.error((contasR.error || statusR.error)!.message);
      return;
    }

    // somar receita delivery do dia
    const { data: pedDel } = await supabase.from("pedidos").select("id")
      .eq("tipo", "delivery").gte("criado_em", ini).lte("criado_em", fim);
    let extra = 0;
    if (pedDel?.length) {
      const ids = pedDel.map((p) => p.id);
      const [{ data: itens }, { data: ents }] = await Promise.all([
        supabase.from("pedido_itens").select("quantidade, preco_unitario").in("pedido_id", ids),
        supabase.from("entregas").select("taxa_entrega").in("pedido_id", ids),
      ]);
      extra += (itens || []).reduce((s, i) => s + Number(i.preco_unitario) * i.quantidade, 0);
      extra += (ents || []).reduce((s, e) => s + Number(e.taxa_entrega || 0), 0);
    }

    const faturamento = (contasR.data || []).reduce((s, c) => s + Number(c.total || 0), 0) + extra;
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

    const [cur, prev] = await Promise.all([
      fetchRangeData(ini, fim),
      fetchRangeData(iniPrev, fimPrev),
    ]);

    const prodIds = Array.from(cur.acc.keys()).filter((k) => k !== "—");
    const { data: produtos } = prodIds.length
      ? await supabase.from("produtos").select("id, nome").in("id", prodIds)
      : { data: [] };
    const nameMap = new Map((produtos || []).map((p) => [p.id, p.nome as string]));
    const topProdutos = Array.from(cur.acc.entries())
      .map(([pid, v]) => ({ nome: pid === "—" ? "Produto removido" : (nameMap.get(pid) ?? "—"), ...v }))
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 5);

    setData({
      faturamento: cur.faturamento, pedidos: cur.pedidos, ticket: cur.ticket,
      faturamentoPrev: prev.faturamento, pedidosPrev: prev.pedidos, ticketPrev: prev.ticket,
      delivery: cur.delivery, mesa: cur.mesa,
      topProdutos,
    });
    setLoading(false);
  }, []);

  const loadCustomRange = useCallback(async (dateStart: Date, dateEnd: Date) => {
    setLoading(true);
    const ini = startOfDay(dateStart).toISOString();
    const fim = endOfDay(dateEnd).toISOString();
    
    // Para período anterior, use a mesma duração
    const duration = dateEnd.getTime() - dateStart.getTime();
    const iniPrev = startOfDay(new Date(dateStart.getTime() - duration)).toISOString();
    const fimPrev = endOfDay(new Date(dateStart.getTime() - 86400000)).toISOString();

    const [cur, prev] = await Promise.all([
      fetchRangeData(ini, fim),
      fetchRangeData(iniPrev, fimPrev),
    ]);

    const prodIds = Array.from(cur.acc.keys()).filter((k) => k !== "—");
    const { data: produtos } = prodIds.length
      ? await supabase.from("produtos").select("id, nome").in("id", prodIds)
      : { data: [] };
    const nameMap = new Map((produtos || []).map((p) => [p.id, p.nome as string]));
    const topProdutos = Array.from(cur.acc.entries())
      .map(([pid, v]) => ({ nome: pid === "—" ? "Produto removido" : (nameMap.get(pid) ?? "—"), ...v }))
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 5);

    setData({
      faturamento: cur.faturamento, pedidos: cur.pedidos, ticket: cur.ticket,
      faturamentoPrev: prev.faturamento, pedidosPrev: prev.pedidos, ticketPrev: prev.ticket,
      delivery: cur.delivery, mesa: cur.mesa,
      topProdutos,
    });
    setLoading(false);
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);
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

  const totalModalidade = data.delivery + data.mesa || 1;
  const maxQtd = data.topProdutos[0]?.quantidade ?? 1;

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
          <div className="grid grid-cols-2 gap-6 place-items-center">
            <ModalidadeGauge
              icon={<Truck className="w-4 h-4" />}
              label="Entrega"
              value={data.delivery}
              total={totalModalidade}
              color="hsl(210 90% 55%)"
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

      {/* Top 5 produtos */}
      <Card className="shadow-card">
        <div className="p-5 border-b flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="font-display text-2xl">Top 5 produtos</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Calculando...</div>
        ) : data.topProdutos.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">Nenhum item vendido neste período.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="w-[35%]">Volume</TableHead>
                <TableHead className="text-right w-24">Qtd.</TableHead>
                <TableHead className="text-right w-32">Receita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topProdutos.map((p, i) => (
                <TableRow key={p.nome + i}>
                  <TableCell className="font-display text-xl text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-gradient-primary" style={{ width: `${(p.quantidade / maxQtd) * 100}%` }} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{p.quantidade}</TableCell>
                  <TableCell className="text-right text-primary font-semibold">{brl(p.receita)}</TableCell>
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
