import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgePercent,
  CalendarDays,
  CheckCircle2,
  CopyPlus,
  Eye,
  FileDown,
  Pencil,
  Percent,
  RefreshCw,
  Trash2,
  Ticket,
  TicketPercent,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type CupomTipo = "percentual" | "fixo" | "frete_gratis";

interface CupomRow {
  id: string;
  codigo: string;
  descricao: string | null;
  tipo: CupomTipo;
  valor: number | null;
  valor_minimo_pedido: number;
  limite_usos_total: number | null;
  usos_realizados: number;
  uso_unico_por_cliente: boolean;
  data_inicio: string | null;
  data_expiracao: string | null;
  ativo: boolean;
  criado_em: string;
}

interface CupomUsoRow {
  id: string;
  cupom_id: string;
  cliente_id: string | null;
  pedido_id: string;
  telefone_cliente: string | null;
  valor_desconto_aplicado: number;
  usado_em: string;
  cupons?: { id: string; codigo: string; tipo: CupomTipo } | null;
  pedidos?: { id: string; subtotal: number; total: number; desconto: number; valor_desconto: number; criado_em: string } | null;
}

interface PedidoRow {
  id: string;
  criado_em: string;
  cupom_id: string | null;
  subtotal: number;
  desconto: number;
  valor_desconto: number;
  total: number;
}

interface CupomFormState {
  codigo: string;
  descricao: string;
  tipo: CupomTipo;
  valor: string;
  valor_minimo_pedido: string;
  limite_usos_total: string;
  ilimitado: boolean;
  uso_unico_por_cliente: boolean;
  data_inicio: string;
  data_expiracao: string;
  ativo: boolean;
}

const sb = supabase as any;

const todayKey = () => new Date().toISOString().slice(0, 10);
const currentMonthKey = () => new Date().toISOString().slice(0, 7);

const emptyForm = (): CupomFormState => ({
  codigo: "",
  descricao: "",
  tipo: "percentual",
  valor: "10",
  valor_minimo_pedido: "0",
  limite_usos_total: "",
  ilimitado: true,
  uso_unico_por_cliente: true,
  data_inicio: "",
  data_expiracao: "",
  ativo: true,
});

const randomCode = (tipo: CupomTipo) => {
  const prefixes = tipo === "frete_gratis"
    ? ["FRETE", "DELIVERY", "SHIP", "GRATIS"]
    : ["BURGER", "SAVE", "PROMO", "LANCHE", "DEAL"];
  const suffix = String(Math.floor(10 + Math.random() * 90));
  return `${prefixes[Math.floor(Math.random() * prefixes.length)]}${suffix}`;
};

const money = (value: string) => {
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "-";
  return new Date(value + (value.length === 10 ? "T00:00:00" : "")).toLocaleDateString("pt-BR");
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

const isExpired = (cupom: CupomRow) => {
  const today = todayKey();
  return Boolean(cupom.data_expiracao && cupom.data_expiracao < today);
};

const statusInfo = (cupom: CupomRow) => {
  if (isExpired(cupom)) {
    return { label: "Expirado", className: "border-red-500/30 bg-red-500/10 text-red-700" };
  }

  if (!cupom.ativo) {
    return { label: "Inativo", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700" };
  }

  return { label: "Ativo", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" };
};

const typeLabel: Record<CupomTipo, string> = {
  percentual: "Percentual",
  fixo: "Fixo",
  frete_gratis: "Frete grátis",
};

export default function CuponsAdmin() {
  const [loading, setLoading] = useState(true);
  const [cupons, setCupons] = useState<CupomRow[]>([]);
  const [usos, setUsos] = useState<CupomUsoRow[]>([]);
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [selectedCoupon, setSelectedCoupon] = useState<CupomRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<CupomFormState>(emptyForm());
  const [reportMonth, setReportMonth] = useState(currentMonthKey());
  const [reportCouponFilter, setReportCouponFilter] = useState("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    const [cupomRes, usoRes, pedidosRes] = await Promise.all([
      sb.from("cupons").select("*").order("criado_em", { ascending: false }),
      sb
        .from("cupom_usos")
        .select("id, cupom_id, cliente_id, pedido_id, telefone_cliente, valor_desconto_aplicado, usado_em, cupons(id, codigo, tipo), pedidos(id, subtotal, total, desconto, valor_desconto, criado_em)")
        .order("usado_em", { ascending: false }),
      sb.from("pedidos").select("id, criado_em, cupom_id, subtotal, desconto, valor_desconto, total").eq("tipo", "delivery").order("criado_em", { ascending: false }),
    ]);

    setLoading(false);

    if (cupomRes.error || usoRes.error || pedidosRes.error) {
      return toast.error(cupomRes.error?.message || usoRes.error?.message || pedidosRes.error?.message || "Erro ao carregar cupons");
    }

    setCupons((cupomRes.data || []) as CupomRow[]);
    setUsos((usoRes.data || []) as CupomUsoRow[]);
    setPedidos((pedidosRes.data || []) as PedidoRow[]);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (cupom: CupomRow) => {
    setEditId(cupom.id);
    setForm({
      codigo: cupom.codigo,
      descricao: cupom.descricao || "",
      tipo: cupom.tipo,
      valor: cupom.valor == null ? "" : String(cupom.valor),
      valor_minimo_pedido: String(cupom.valor_minimo_pedido ?? 0),
      limite_usos_total: cupom.limite_usos_total == null ? "" : String(cupom.limite_usos_total),
      ilimitado: cupom.limite_usos_total == null,
      uso_unico_por_cliente: cupom.uso_unico_por_cliente,
      data_inicio: cupom.data_inicio || "",
      data_expiracao: cupom.data_expiracao || "",
      ativo: cupom.ativo,
    });
    setFormOpen(true);
  };

  const openDetail = (cupom: CupomRow) => {
    setSelectedCoupon(cupom);
    setDetailOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditId(null);
    setForm(emptyForm());
  };

  const saveCupom = async () => {
    const codigo = form.codigo.trim().toUpperCase();
    if (!codigo) return toast.error("Informe o código do cupom");
    if (form.tipo !== "frete_gratis" && money(form.valor) <= 0) return toast.error("Informe o valor do desconto");
    if (money(form.valor_minimo_pedido) < 0) return toast.error("Valor mínimo inválido");
    if (!form.ilimitado && !form.limite_usos_total.trim()) return toast.error("Informe o limite de usos ou marque ilimitado");

    const payload = {
      codigo,
      descricao: form.descricao.trim() || null,
      tipo: form.tipo,
      valor: form.tipo === "frete_gratis" ? null : Number(money(form.valor).toFixed(2)),
      valor_minimo_pedido: Number(money(form.valor_minimo_pedido).toFixed(2)),
      limite_usos_total: form.ilimitado ? null : Number.parseInt(form.limite_usos_total, 10),
      uso_unico_por_cliente: form.uso_unico_por_cliente,
      data_inicio: form.data_inicio || null,
      data_expiracao: form.data_expiracao || null,
      ativo: isExpired({
        id: editId || "",
        codigo,
        descricao: null,
        tipo: form.tipo,
        valor: form.tipo === "frete_gratis" ? null : money(form.valor),
        valor_minimo_pedido: money(form.valor_minimo_pedido),
        limite_usos_total: form.ilimitado ? null : Number.parseInt(form.limite_usos_total, 10),
        usos_realizados: 0,
        uso_unico_por_cliente: form.uso_unico_por_cliente,
        data_inicio: form.data_inicio || null,
        data_expiracao: form.data_expiracao || null,
        ativo: form.ativo,
        criado_em: new Date().toISOString(),
      }) ? false : form.ativo,
    };

    setBusy(true);
    const query = editId ? sb.from("cupons").update(payload).eq("id", editId) : sb.from("cupons").insert(payload);
    const { error } = await query;
    setBusy(false);

    if (error) {
      return toast.error(error.message);
    }

    toast.success(editId ? "Cupom atualizado" : "Cupom criado");
    closeForm();
    await loadData();
  };

  const toggleAtivo = async (cupom: CupomRow) => {
    if (isExpired(cupom)) {
      return toast.error("Cupom expirado não pode ser reativado");
    }

    const { error } = await sb.from("cupons").update({ ativo: !cupom.ativo }).eq("id", cupom.id);
    if (error) return toast.error(error.message);
    toast.success(cupom.ativo ? "Cupom desativado" : "Cupom ativado");
    await loadData();
  };

  const removeCupom = async (cupom: CupomRow) => {
    if (!window.confirm(`Excluir o cupom ${cupom.codigo}?`)) return;
    const { error } = await sb.from("cupons").delete().eq("id", cupom.id);
    if (error) return toast.error(error.message);
    toast.success("Cupom excluído");
    await loadData();
  };

  const couponSummary = useMemo(() => {
    const now = new Date();
    const today = todayKey();
    const month = currentMonthKey();
    const active = cupons.filter((cupom) => cupom.ativo && !isExpired(cupom)).length;
    const expired = cupons.filter((cupom) => isExpired(cupom)).length;
    const usosHoje = usos.filter((uso) => uso.usado_em.slice(0, 10) === today).length;
    const descontoMes = usos
      .filter((uso) => uso.usado_em.startsWith(month))
      .reduce((sum, uso) => sum + Number(uso.valor_desconto_aplicado || 0), 0);

    return { active, expired, usosHoje, descontoMes };
  }, [cupons, usos]);

  const reportData = useMemo(() => {
    const [year, month] = reportMonth.split("-").map(Number);
    const periodStart = new Date(year, month - 1, 1).toISOString().slice(0, 10);
    const periodEnd = new Date(year, month, 0).toISOString().slice(0, 10);

    const inPeriod = (dateValue: string) => dateValue.slice(0, 10) >= periodStart && dateValue.slice(0, 10) <= periodEnd;
    const periodUsos = usos.filter((uso) => inPeriod(uso.usado_em));
    const periodPedidos = pedidos.filter((pedido) => inPeriod(pedido.criado_em));

    const totalUsos = periodUsos.length;
    const totalDesconto = periodUsos.reduce((sum, uso) => sum + Number(uso.valor_desconto_aplicado || 0), 0);
    const pedidosComCupom = periodPedidos.filter((pedido) => Boolean(pedido.cupom_id)).length;
    const pedidosSemCupom = Math.max(periodPedidos.length - pedidosComCupom, 0);

    const groupedByDay = new Map<string, number>();
    periodUsos.forEach((uso) => {
      const day = uso.usado_em.slice(0, 10);
      groupedByDay.set(day, (groupedByDay.get(day) || 0) + 1);
    });

    const groupedByCoupon = new Map<string, { codigo: string; tipo: CupomTipo; usos: number; desconto: number; ticketTotal: number; pedidos: number }>();
    periodUsos.forEach((uso) => {
      const codigo = uso.cupons?.codigo || "-";
      const tipo = uso.cupons?.tipo || "percentual";
      const current = groupedByCoupon.get(uso.cupom_id) || { codigo, tipo, usos: 0, desconto: 0, ticketTotal: 0, pedidos: 0 };
      current.usos += 1;
      current.desconto += Number(uso.valor_desconto_aplicado || 0);
      if (uso.pedidos) {
        current.ticketTotal += Number(uso.pedidos.total || 0);
        current.pedidos += 1;
      }
      groupedByCoupon.set(uso.cupom_id, current);
    });

    const performance = Array.from(groupedByCoupon.values())
      .map((item) => ({
        codigo: item.codigo,
        tipo: item.tipo,
        usos: item.usos,
        desconto: item.desconto,
        ticketMedio: item.pedidos > 0 ? item.ticketTotal / item.pedidos : 0,
      }))
      .sort((left, right) => right.usos - left.usos);

    const topCoupon = performance[0] || null;
    const usosDiarios = Array.from(groupedByDay.entries())
      .map(([dia, usosDia]) => ({ dia, usos: usosDia }))
      .sort((left, right) => left.dia.localeCompare(right.dia));

    const detailedUsos = periodUsos
      .filter((uso) => reportCouponFilter === "all" || uso.cupom_id === reportCouponFilter)
      .map((uso) => ({
        ...uso,
        valor_final: Number(uso.pedidos?.total || 0),
        valor_pedido: Number(uso.pedidos?.total || 0) + Number(uso.pedidos?.desconto || 0) + Number(uso.pedidos?.valor_desconto || 0),
      }))
      .sort((left, right) => right.usado_em.localeCompare(left.usado_em));

    return {
      totalUsos,
      totalDesconto,
      pedidosComCupom,
      pedidosSemCupom,
      topCoupon,
      usosDiarios,
      performance,
      detailedUsos,
    };
  }, [pedidos, reportCouponFilter, reportMonth, usos]);

  const detailedSelectedUsos = useMemo(() => {
    if (!selectedCoupon) return [] as CupomUsoRow[];
    return usos.filter((uso) => uso.cupom_id === selectedCoupon.id).sort((left, right) => right.usado_em.localeCompare(left.usado_em));
  }, [selectedCoupon, usos]);

  const reportPeriodLabel = useMemo(() => {
    const [year, month] = reportMonth.split("-");
    return `${month}/${year}`;
  }, [reportMonth]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl text-foreground flex items-center gap-3">
            <TicketPercent className="h-8 w-8 text-primary" /> Cupons
          </h1>
          <p className="mt-1 text-muted-foreground">Gerencie descontos e acompanhe a performance dos cupons do delivery.</p>
        </div>
      </div>

      <Tabs defaultValue="gerenciar" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="gerenciar">Gerenciar Cupons</TabsTrigger>
          <TabsTrigger value="relatorio">Relatório de Cupons</TabsTrigger>
        </TabsList>

        <TabsContent value="gerenciar" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Ticket className="h-4 w-4" /> Ativos</p>
              <p className="mt-1 text-2xl font-semibold">{couponSummary.active}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><XCircle className="h-4 w-4" /> Expirados</p>
              <p className="mt-1 text-2xl font-semibold">{couponSummary.expired}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Users className="h-4 w-4" /> Usos hoje</p>
              <p className="mt-1 text-2xl font-semibold">{couponSummary.usosHoje}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><BadgePercent className="h-4 w-4" /> Desconto no mês</p>
              <p className="mt-1 text-2xl font-semibold">{brl(couponSummary.descontoMes)}</p>
            </Card>
          </div>

          <div className="flex justify-end">
            <Button onClick={openCreate}>
              <CopyPlus className="mr-2 h-4 w-4" /> Novo cupom
            </Button>
          </div>

          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Usos</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Carregando cupons...
                    </TableCell>
                  </TableRow>
                ) : cupons.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Nenhum cupom cadastrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  cupons.map((cupom) => {
                    const status = statusInfo(cupom);
                    const validade = [formatDate(cupom.data_inicio), formatDate(cupom.data_expiracao)].join(" até ");
                    const usosLabel = `${cupom.usos_realizados}/${cupom.limite_usos_total == null ? "∞" : cupom.limite_usos_total}`;

                    return (
                      <TableRow key={cupom.id} className="cursor-pointer" onClick={() => openDetail(cupom)}>
                        <TableCell className="font-semibold">{cupom.codigo}</TableCell>
                        <TableCell>{typeLabel[cupom.tipo]}</TableCell>
                        <TableCell>
                          {cupom.tipo === "frete_gratis"
                            ? "Frete grátis"
                            : cupom.tipo === "percentual"
                              ? `${Number(cupom.valor || 0)}%`
                              : brl(Number(cupom.valor || 0))}
                        </TableCell>
                        <TableCell>{usosLabel}</TableCell>
                        <TableCell>{validade}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={status.className}>
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); openDetail(cupom); }}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); openEdit(cupom); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); void toggleAtivo(cupom); }}>
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="hover:text-destructive" onClick={(event) => { event.stopPropagation(); void removeCupom(cupom); }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="relatorio" className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>Mês de referência</Label>
                <Input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} className="w-[190px]" />
              </div>
              <div className="space-y-1">
                <Label>Filtrar cupom</Label>
                <Select value={reportCouponFilter} onValueChange={setReportCouponFilter}>
                  <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos cupons</SelectItem>
                    {cupons.map((cupom) => (
                      <SelectItem key={cupom.id} value={cupom.id}>{cupom.codigo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={() => window.print()}>
                <FileDown className="mr-2 h-4 w-4" /> Exportar
              </Button>
            </div>
          </Card>

          <div className="grid gap-3 md:grid-cols-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Ticket className="h-4 w-4" /> Total de cupons utilizados</p>
              <p className="mt-1 text-2xl font-semibold">{reportData.totalUsos}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><BadgePercent className="h-4 w-4" /> Total de desconto concedido</p>
              <p className="mt-1 text-2xl font-semibold">{brl(reportData.totalDesconto)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Pedidos com cupom vs sem cupom</p>
              <p className="mt-1 text-2xl font-semibold">{reportData.pedidosComCupom} / {reportData.pedidosSemCupom}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Percent className="h-4 w-4" /> Cupom mais usado</p>
              <p className="mt-1 text-2xl font-semibold">{reportData.topCoupon ? reportData.topCoupon.codigo : "-"}</p>
              {reportData.topCoupon && <p className="text-xs text-muted-foreground">{reportData.topCoupon.usos} usos</p>}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="h-[360px] p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Usos por dia</h3>
                <span className="text-xs text-muted-foreground">{reportPeriodLabel}</span>
              </div>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={reportData.usosDiarios}>
                  <XAxis dataKey="dia" />
                  <YAxis />
                  <ChartTooltip />
                  <Bar dataKey="usos" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Usos</TableHead>
                    <TableHead className="text-right">Desconto</TableHead>
                    <TableHead className="text-right">Ticket médio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.performance.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Sem cupons no período.</TableCell>
                    </TableRow>
                  ) : (
                    reportData.performance.map((item) => (
                      <TableRow key={item.codigo}>
                        <TableCell className="font-medium">{item.codigo}</TableCell>
                        <TableCell>{typeLabel[item.tipo]}</TableCell>
                        <TableCell className="text-right">{item.usos}</TableCell>
                        <TableCell className="text-right">{brl(item.desconto)}</TableCell>
                        <TableCell className="text-right">{brl(item.ticketMedio)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Cupom</TableHead>
                  <TableHead className="text-right">Valor do pedido</TableHead>
                  <TableHead className="text-right">Desconto</TableHead>
                  <TableHead className="text-right">Valor final pago</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.detailedUsos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Sem usos detalhados no período.</TableCell>
                  </TableRow>
                ) : (
                  reportData.detailedUsos.map((uso) => (
                    <TableRow key={uso.id}>
                      <TableCell>{formatDateTime(uso.usado_em)}</TableCell>
                      <TableCell>{uso.telefone_cliente || "-"}</TableCell>
                      <TableCell>{uso.cupons?.codigo || "-"}</TableCell>
                      <TableCell className="text-right">{brl(Number(uso.pedidos?.total || 0) + Number(uso.pedidos?.desconto || 0) + Number(uso.pedidos?.valor_desconto || 0))}</TableCell>
                      <TableCell className="text-right">{brl(Number(uso.valor_desconto_aplicado || 0))}</TableCell>
                      <TableCell className="text-right">{brl(Number(uso.pedidos?.total || 0))}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar cupom" : "Novo cupom"}</DialogTitle>
            <DialogDescription>Configure a regra do cupom, período e limite de usos.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Código</Label>
              <div className="flex gap-2">
                <Input
                  value={form.codigo}
                  onChange={(event) => setForm((current) => ({ ...current, codigo: event.target.value.toUpperCase() }))}
                  placeholder="BURGER10"
                  className="uppercase"
                />
                <Button type="button" variant="outline" onClick={() => setForm((current) => ({ ...current, codigo: randomCode(current.tipo) }))}>
                  Gerar aleatório
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descrição interna</Label>
              <Input value={form.descricao} onChange={(event) => setForm((current) => ({ ...current, descricao: event.target.value }))} placeholder="Ex.: campanha de delivery" />
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(value: CupomTipo) => setForm((current) => ({ ...current, tipo: value, valor: value === "frete_gratis" ? "" : current.valor }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentual">Percentual</SelectItem>
                  <SelectItem value="fixo">Fixo</SelectItem>
                  <SelectItem value="frete_gratis">Frete grátis</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.tipo !== "frete_gratis" && (
              <div className="space-y-2">
                <Label>Valor do desconto</Label>
                <Input type="number" min={0} step="0.01" value={form.valor} onChange={(event) => setForm((current) => ({ ...current, valor: event.target.value }))} />
              </div>
            )}

            <div className="space-y-2">
              <Label>Valor mínimo do pedido</Label>
              <Input type="number" min={0} step="0.01" value={form.valor_minimo_pedido} onChange={(event) => setForm((current) => ({ ...current, valor_minimo_pedido: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Limite de usos total</Label>
              <div className="flex items-center gap-3">
                <Switch checked={form.ilimitado} onCheckedChange={(checked) => setForm((current) => ({ ...current, ilimitado: checked }))} />
                <span className="text-sm text-muted-foreground">Ilimitado</span>
              </div>
              {!form.ilimitado && (
                <Input type="number" min={1} step="1" value={form.limite_usos_total} onChange={(event) => setForm((current) => ({ ...current, limite_usos_total: event.target.value }))} placeholder="Ex.: 100" />
              )}
            </div>

            <div className="space-y-2">
              <Label>Uso único por cliente</Label>
              <div className="flex items-center gap-3">
                <Switch checked={form.uso_unico_por_cliente} onCheckedChange={(checked) => setForm((current) => ({ ...current, uso_unico_por_cliente: checked }))} />
                <span className="text-sm text-muted-foreground">Bloquear múltiplos usos por telefone</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Data de início</Label>
              <Input type="date" value={form.data_inicio} onChange={(event) => setForm((current) => ({ ...current, data_inicio: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Data de expiração</Label>
              <Input type="date" value={form.data_expiracao} onChange={(event) => setForm((current) => ({ ...current, data_expiracao: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Ativo</Label>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.ativo}
                  disabled={Boolean(form.data_expiracao) && form.data_expiracao < todayKey()}
                  onCheckedChange={(checked) => setForm((current) => ({ ...current, ativo: checked }))}
                />
                <span className="text-sm text-muted-foreground">{form.ativo ? "Disponível para o checkout" : "Fora de uso"}</span>
              </div>
              {form.data_expiracao && form.data_expiracao < todayKey() && (
                <p className="text-xs text-muted-foreground">Cupom expirado não pode ser reativado.</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancelar</Button>
            <Button onClick={() => void saveCupom()} disabled={busy}>{busy ? "Salvando..." : "Salvar cupom"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedCoupon?.codigo || "Cupom"}</DialogTitle>
            <DialogDescription>Histórico de usos do cupom selecionado.</DialogDescription>
          </DialogHeader>

          {selectedCoupon && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Card className="p-4"><p className="text-xs text-muted-foreground">Tipo</p><p className="mt-1 font-semibold">{typeLabel[selectedCoupon.tipo]}</p></Card>
                <Card className="p-4"><p className="text-xs text-muted-foreground">Usos</p><p className="mt-1 font-semibold">{selectedCoupon.usos_realizados}/{selectedCoupon.limite_usos_total == null ? "∞" : selectedCoupon.limite_usos_total}</p></Card>
                <Card className="p-4"><p className="text-xs text-muted-foreground">Validade</p><p className="mt-1 font-semibold">{formatDate(selectedCoupon.data_inicio)} até {formatDate(selectedCoupon.data_expiracao)}</p></Card>
              </div>

              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Pedido</TableHead>
                      <TableHead className="text-right">Desconto</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailedSelectedUsos.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Nenhum uso registrado.</TableCell></TableRow>
                    ) : (
                      detailedSelectedUsos.map((uso) => (
                        <TableRow key={uso.id}>
                          <TableCell>{uso.telefone_cliente || "-"}</TableCell>
                          <TableCell>#{uso.pedido_id.slice(0, 8).toUpperCase()}</TableCell>
                          <TableCell className="text-right">{brl(Number(uso.valor_desconto_aplicado || 0))}</TableCell>
                          <TableCell>{formatDateTime(uso.usado_em)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}