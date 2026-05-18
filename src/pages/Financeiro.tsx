import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock3,
  Eye,
  FileDown,
  Package,
  Pencil,
  Plus,
  Receipt,
  Save,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { brl } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CategoriaTipo = "ingrediente" | "embalagem";
type CompraStatus = "pago" | "pendente" | "vencido";
type FormaPagamento = "pix" | "boleto" | "cartao" | "dinheiro";
type UnidadeCompra = "kg" | "g" | "un" | "cx" | "pct" | "l";
type ContaStatus = "pendente" | "pago" | "vencido";

interface Fornecedor {
  id: string;
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  email: string | null;
  contato_responsavel: string | null;
  observacoes: string | null;
  ativo: boolean;
  criado_em: string;
}

interface CategoriaCompra {
  id: string;
  nome: string;
  tipo: CategoriaTipo;
  cor: string;
  icone: string | null;
}

interface CompraItem {
  id: string;
  compra_id: string;
  nome: string;
  quantidade: number;
  unidade: UnidadeCompra;
  preco_unitario: number;
  preco_total: number;
}

interface Compra {
  id: string;
  fornecedor_id: string | null;
  categoria_compra_id: string | null;
  descricao: string;
  valor_total: number;
  data_compra: string;
  data_vencimento: string | null;
  status_pagamento: CompraStatus;
  forma_pagamento: FormaPagamento;
  nota_fiscal: string | null;
  observacoes: string | null;
  criado_em: string;
  fornecedores?: Fornecedor | null;
  categorias_compra?: CategoriaCompra | null;
  compra_itens?: CompraItem[];
}

interface ContaPagar {
  id: string;
  compra_id: string | null;
  fornecedor_id: string | null;
  descricao: string;
  valor: number;
  data_vencimento: string;
  data_pagamento: string | null;
  status: ContaStatus;
  observacoes: string | null;
  fornecedores?: Fornecedor | null;
  compras?: Compra | null;
}

interface CompraItemForm {
  key: string;
  nome: string;
  quantidade: string;
  unidade: UnidadeCompra;
  preco_unitario: string;
}

interface CompraFormState {
  fornecedor_id: string;
  categoria_compra_id: string;
  descricao: string;
  data_compra: string;
  status_pagamento: "pago" | "pendente";
  data_vencimento: string;
  forma_pagamento: FormaPagamento;
  nota_fiscal: string;
  observacoes: string;
  itens: CompraItemForm[];
}

interface FornecedorFormState {
  nome: string;
  cnpj: string;
  telefone: string;
  email: string;
  contato_responsavel: string;
  observacoes: string;
}

interface CategoriaFormState {
  nome: string;
  tipo: CategoriaTipo;
  cor: string;
  icone: string;
}

interface WeeklyReportPoint {
  semana: string;
  faturamento: number;
  custos: number;
}

interface ReportData {
  faturamento: number;
  custos: number;
  lucro: number;
  margem: number;
  ingredientes: number;
  embalagens: number;
  porFornecedor: Array<{ fornecedor: string; total: number; percentual: number }>;
  semanal: WeeklyReportPoint[];
}

const sb = supabase as any;

const unidadeOptions: UnidadeCompra[] = ["kg", "g", "un", "cx", "pct", "l"];
const formaPagamentoOptions: FormaPagamento[] = ["pix", "boleto", "cartao", "dinheiro"];

const emptyItem = (): CompraItemForm => ({
  key: crypto.randomUUID(),
  nome: "",
  quantidade: "1",
  unidade: "un",
  preco_unitario: "0",
});

const emptyCompraForm = (): CompraFormState => ({
  fornecedor_id: "none",
  categoria_compra_id: "none",
  descricao: "",
  data_compra: new Date().toISOString().slice(0, 10),
  status_pagamento: "pago",
  data_vencimento: "",
  forma_pagamento: "pix",
  nota_fiscal: "",
  observacoes: "",
  itens: [emptyItem()],
});

const emptyFornecedorForm = (): FornecedorFormState => ({
  nome: "",
  cnpj: "",
  telefone: "",
  email: "",
  contato_responsavel: "",
  observacoes: "",
});

const emptyCategoriaForm = (): CategoriaFormState => ({
  nome: "",
  tipo: "ingrediente",
  cor: "#16a34a",
  icone: "",
});

const cnpjRegex = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

const parseMoney = (value: string) => {
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const asNumber = Number(normalized);
  return Number.isFinite(asNumber) ? asNumber : 0;
};

const toInputMoney = (value: number) => String(value ?? 0).replace(".", ",");

const maskCnpj = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};

const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return digits
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d{1,4})$/, "$1-$2");
};

const todayDate = () => new Date().toISOString().slice(0, 10);

const statusBadgeClass = (status: CompraStatus | ContaStatus) => {
  if (status === "pago") return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
  if (status === "vencido") return "bg-red-500/15 text-red-700 border-red-500/30";
  return "bg-amber-500/15 text-amber-700 border-amber-500/30";
};

const daysUntil = (dateString: string | null) => {
  if (!dateString) return null;
  const now = new Date(todayDate() + "T00:00:00");
  const due = new Date(dateString + "T00:00:00");
  return Math.floor((due.getTime() - now.getTime()) / 86400000);
};

const formatMonthLabel = (month: string) => {
  const [year, m] = month.split("-");
  return `${m}/${year}`;
};

export default function Financeiro() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [categorias, setCategorias] = useState<CategoriaCompra[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);

  const [compraDialogOpen, setCompraDialogOpen] = useState(false);
  const [compraDetailOpen, setCompraDetailOpen] = useState(false);
  const [compraEditId, setCompraEditId] = useState<string | null>(null);
  const [compraSelected, setCompraSelected] = useState<Compra | null>(null);
  const [compraBusy, setCompraBusy] = useState(false);
  const [compraForm, setCompraForm] = useState<CompraFormState>(emptyCompraForm());

  const [fornecedorDialogOpen, setFornecedorDialogOpen] = useState(false);
  const [fornecedorDetailOpen, setFornecedorDetailOpen] = useState(false);
  const [fornecedorEditId, setFornecedorEditId] = useState<string | null>(null);
  const [fornecedorSelected, setFornecedorSelected] = useState<Fornecedor | null>(null);
  const [fornecedorBusy, setFornecedorBusy] = useState(false);
  const [fornecedorForm, setFornecedorForm] = useState<FornecedorFormState>(emptyFornecedorForm());

  const [categoriaDialogOpen, setCategoriaDialogOpen] = useState(false);
  const [categoriaBusy, setCategoriaBusy] = useState(false);
  const [categoriaForm, setCategoriaForm] = useState<CategoriaFormState>(emptyCategoriaForm());

  const [filtroCompraInicio, setFiltroCompraInicio] = useState("");
  const [filtroCompraFim, setFiltroCompraFim] = useState("");
  const [filtroCompraFornecedor, setFiltroCompraFornecedor] = useState("all");
  const [filtroCompraCategoria, setFiltroCompraCategoria] = useState("all");
  const [filtroCompraStatus, setFiltroCompraStatus] = useState("all");

  const [filtroContasStatus, setFiltroContasStatus] = useState<"all" | ContaStatus>("all");

  const currentMonth = new Date().toISOString().slice(0, 7);
  const [reportMode, setReportMode] = useState<"month" | "custom">("month");
  const [reportMonth, setReportMonth] = useState(currentMonth);
  const [reportStart, setReportStart] = useState("");
  const [reportEnd, setReportEnd] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData>({
    faturamento: 0,
    custos: 0,
    lucro: 0,
    margem: 0,
    ingredientes: 0,
    embalagens: 0,
    porFornecedor: [],
    semanal: [],
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [fornRes, catRes, compRes, contasRes] = await Promise.all([
      sb.from("fornecedores").select("*").order("nome"),
      sb.from("categorias_compra").select("*").order("nome"),
      sb
        .from("compras")
        .select("*, fornecedores(*), categorias_compra(*), compra_itens(*)")
        .order("data_compra", { ascending: false }),
      sb.from("contas_pagar").select("*, fornecedores(*), compras(*)").order("data_vencimento", { ascending: true }),
    ]);

    setLoading(false);

    if (fornRes.error || catRes.error || compRes.error || contasRes.error) {
      return toast.error(
        fornRes.error?.message || catRes.error?.message || compRes.error?.message || contasRes.error?.message || "Erro ao carregar financeiro",
      );
    }

    setFornecedores((fornRes.data || []) as Fornecedor[]);
    setCategorias((catRes.data || []) as CategoriaCompra[]);
    setCompras((compRes.data || []) as Compra[]);
    setContasPagar((contasRes.data || []) as ContaPagar[]);
  }, []);

  const loadReport = useCallback(async () => {
    setReportLoading(true);

    let ini: Date;
    let fim: Date;

    if (reportMode === "month") {
      const [year, month] = reportMonth.split("-").map(Number);
      ini = new Date(year, month - 1, 1);
      fim = new Date(year, month, 0);
    } else {
      if (!reportStart || !reportEnd) {
        setReportLoading(false);
        return;
      }
      ini = new Date(reportStart + "T00:00:00");
      fim = new Date(reportEnd + "T23:59:59");
    }

    const iniIso = new Date(ini.setHours(0, 0, 0, 0)).toISOString();
    const fimIso = new Date(fim.setHours(23, 59, 59, 999)).toISOString();

    const [contasRes, deliveryRes, custosRes] = await Promise.all([
      sb
        .from("contas")
        .select("total")
        .eq("status", "fechada")
        .gte("fechada_em", iniIso)
        .lte("fechada_em", fimIso),
      sb
        .from("pedidos")
        .select("id")
        .eq("tipo", "delivery")
        .gte("criado_em", iniIso)
        .lte("criado_em", fimIso),
      sb
        .from("compras")
        .select("id, fornecedor_id, valor_total, data_compra, fornecedores(nome), categorias_compra(tipo)")
        .eq("status_pagamento", "pago")
        .gte("data_compra", iniIso.slice(0, 10))
        .lte("data_compra", fimIso.slice(0, 10)),
    ]);

    if (contasRes.error || deliveryRes.error || custosRes.error) {
      setReportLoading(false);
      return toast.error(contasRes.error?.message || deliveryRes.error?.message || custosRes.error?.message || "Erro ao gerar relatório");
    }

    const deliveryIds = ((deliveryRes.data || []) as Array<{ id: string }>).map((pedido) => pedido.id);

    let faturamentoDelivery = 0;
    if (deliveryIds.length > 0) {
      const [itensRes, entregasRes] = await Promise.all([
        sb.from("pedido_itens").select("pedido_id, quantidade, preco_unitario").in("pedido_id", deliveryIds),
        sb.from("entregas").select("pedido_id, taxa_entrega").in("pedido_id", deliveryIds),
      ]);

      if (itensRes.error || entregasRes.error) {
        setReportLoading(false);
        return toast.error(itensRes.error?.message || entregasRes.error?.message || "Erro ao somar faturamento delivery");
      }

      faturamentoDelivery += (itensRes.data || []).reduce(
        (sum: number, item: any) => sum + Number(item.preco_unitario || 0) * Number(item.quantidade || 0),
        0,
      );
      faturamentoDelivery += (entregasRes.data || []).reduce(
        (sum: number, entrega: any) => sum + Number(entrega.taxa_entrega || 0),
        0,
      );
    }

    const faturamentoMesas = (contasRes.data || []).reduce((sum: number, conta: any) => sum + Number(conta.total || 0), 0);
    const faturamento = faturamentoMesas + faturamentoDelivery;

    const custosRows = (custosRes.data || []) as Array<{
      id: string;
      fornecedor_id: string | null;
      valor_total: number;
      data_compra: string;
      fornecedores?: { nome: string } | null;
      categorias_compra?: { tipo: CategoriaTipo } | null;
    }>;

    const custos = custosRows.reduce((sum, row) => sum + Number(row.valor_total || 0), 0);
    const lucro = faturamento - custos;
    const margem = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

    const ingredientes = custosRows
      .filter((row) => row.categorias_compra?.tipo === "ingrediente")
      .reduce((sum, row) => sum + Number(row.valor_total || 0), 0);

    const embalagens = custosRows
      .filter((row) => row.categorias_compra?.tipo === "embalagem")
      .reduce((sum, row) => sum + Number(row.valor_total || 0), 0);

    const fornecedorMap = new Map<string, { nome: string; total: number }>();
    custosRows.forEach((row) => {
      const key = row.fornecedor_id || "sem-fornecedor";
      const cur = fornecedorMap.get(key) || { nome: row.fornecedores?.nome || "Sem fornecedor", total: 0 };
      cur.total += Number(row.valor_total || 0);
      fornecedorMap.set(key, cur);
    });

    const porFornecedor = Array.from(fornecedorMap.values())
      .map((item) => ({
        fornecedor: item.nome,
        total: item.total,
        percentual: custos > 0 ? (item.total / custos) * 100 : 0,
      }))
      .sort((left, right) => right.total - left.total);

    const weekCosts = new Map<string, number>();
    custosRows.forEach((row) => {
      const date = new Date(row.data_compra + "T00:00:00");
      const week = `Sem ${Math.ceil(date.getDate() / 7)}`;
      weekCosts.set(week, (weekCosts.get(week) || 0) + Number(row.valor_total || 0));
    });

    const weekRevenue = new Map<string, number>();

    const [contasSemanaRes, pedidosSemanaRes] = await Promise.all([
      sb
        .from("contas")
        .select("total, fechada_em")
        .eq("status", "fechada")
        .gte("fechada_em", iniIso)
        .lte("fechada_em", fimIso),
      sb
        .from("pedidos")
        .select("id, criado_em")
        .eq("tipo", "delivery")
        .gte("criado_em", iniIso)
        .lte("criado_em", fimIso),
    ]);

    if (contasSemanaRes.error || pedidosSemanaRes.error) {
      setReportLoading(false);
      return toast.error(contasSemanaRes.error?.message || pedidosSemanaRes.error?.message || "Erro ao gerar gráfico semanal");
    }

    (contasSemanaRes.data || []).forEach((conta: any) => {
      const date = new Date(conta.fechada_em);
      const week = `Sem ${Math.ceil(date.getDate() / 7)}`;
      weekRevenue.set(week, (weekRevenue.get(week) || 0) + Number(conta.total || 0));
    });

    const deliveryWeekIds = (pedidosSemanaRes.data || []).map((pedido: any) => pedido.id);

    if (deliveryWeekIds.length > 0) {
      const [itensRes, entregasRes] = await Promise.all([
        sb.from("pedido_itens").select("pedido_id, quantidade, preco_unitario").in("pedido_id", deliveryWeekIds),
        sb.from("entregas").select("pedido_id, taxa_entrega").in("pedido_id", deliveryWeekIds),
      ]);

      if (!itensRes.error && !entregasRes.error) {
        const pedidoDateMap = new Map((pedidosSemanaRes.data || []).map((pedido: any) => [pedido.id, pedido.criado_em]));

        (itensRes.data || []).forEach((item: any) => {
          const created = pedidoDateMap.get(item.pedido_id);
          if (!created) return;
          const date = new Date(created);
          const week = `Sem ${Math.ceil(date.getDate() / 7)}`;
          const value = Number(item.preco_unitario || 0) * Number(item.quantidade || 0);
          weekRevenue.set(week, (weekRevenue.get(week) || 0) + value);
        });

        (entregasRes.data || []).forEach((entrega: any) => {
          const created = pedidoDateMap.get(entrega.pedido_id);
          if (!created) return;
          const date = new Date(created);
          const week = `Sem ${Math.ceil(date.getDate() / 7)}`;
          weekRevenue.set(week, (weekRevenue.get(week) || 0) + Number(entrega.taxa_entrega || 0));
        });
      }
    }

    const allWeeks = Array.from(new Set([...weekRevenue.keys(), ...weekCosts.keys()])).sort();
    const semanal: WeeklyReportPoint[] = allWeeks.map((week) => ({
      semana: week,
      faturamento: weekRevenue.get(week) || 0,
      custos: weekCosts.get(week) || 0,
    }));

    setReportData({
      faturamento,
      custos,
      lucro,
      margem,
      ingredientes,
      embalagens,
      porFornecedor,
      semanal,
    });
    setReportLoading(false);
  }, [reportMode, reportMonth, reportStart, reportEnd]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const compraFormTotal = useMemo(
    () => compraForm.itens.reduce((sum, item) => sum + parseMoney(item.quantidade) * parseMoney(item.preco_unitario), 0),
    [compraForm.itens],
  );

  const comprasFiltradas = useMemo(() => {
    return compras.filter((compra) => {
      if (filtroCompraInicio && compra.data_compra < filtroCompraInicio) return false;
      if (filtroCompraFim && compra.data_compra > filtroCompraFim) return false;
      if (filtroCompraFornecedor !== "all" && compra.fornecedor_id !== filtroCompraFornecedor) return false;
      if (filtroCompraCategoria !== "all" && compra.categoria_compra_id !== filtroCompraCategoria) return false;
      if (filtroCompraStatus !== "all" && compra.status_pagamento !== filtroCompraStatus) return false;
      return true;
    });
  }, [compras, filtroCompraInicio, filtroCompraFim, filtroCompraFornecedor, filtroCompraCategoria, filtroCompraStatus]);

  const totalGastoFornecedor = useMemo(() => {
    const map = new Map<string, number>();
    compras.forEach((compra) => {
      if (!compra.fornecedor_id) return;
      map.set(compra.fornecedor_id, (map.get(compra.fornecedor_id) || 0) + Number(compra.valor_total || 0));
    });
    return map;
  }, [compras]);

  const contasFiltradas = useMemo(() => {
    const base = contasPagar.filter((conta) => (filtroContasStatus === "all" ? true : conta.status === filtroContasStatus));
    return base.sort((left, right) => {
      const leftTime = new Date(left.data_vencimento).getTime();
      const rightTime = new Date(right.data_vencimento).getTime();
      return leftTime - rightTime;
    });
  }, [contasPagar, filtroContasStatus]);

  const contasResumo = useMemo(() => {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const isInCurrentMonth = (dateString: string) => {
      const date = new Date(dateString + "T00:00:00");
      return date >= currentMonthStart && date <= currentMonthEnd;
    };

    const totalPagarMes = contasPagar
      .filter((conta) => conta.status !== "pago" && isInCurrentMonth(conta.data_vencimento))
      .reduce((sum, conta) => sum + Number(conta.valor || 0), 0);

    const totalVencido = contasPagar
      .filter((conta) => conta.status === "vencido")
      .reduce((sum, conta) => sum + Number(conta.valor || 0), 0);

    const totalPagoMes = contasPagar
      .filter((conta) => conta.status === "pago" && conta.data_pagamento && isInCurrentMonth(conta.data_pagamento))
      .reduce((sum, conta) => sum + Number(conta.valor || 0), 0);

    return { totalPagarMes, totalVencido, totalPagoMes };
  }, [contasPagar]);

  const fornecedorCompras = useMemo(() => {
    if (!fornecedorSelected) return [] as Compra[];
    return compras
      .filter((compra) => compra.fornecedor_id === fornecedorSelected.id)
      .sort((left, right) => right.data_compra.localeCompare(left.data_compra));
  }, [compras, fornecedorSelected]);

  const fornecedorTotais = useMemo(() => {
    const totalGeral = fornecedorCompras.reduce((sum, compra) => sum + Number(compra.valor_total || 0), 0);
    const month = new Date().toISOString().slice(0, 7);
    const totalMes = fornecedorCompras
      .filter((compra) => compra.data_compra.startsWith(month))
      .reduce((sum, compra) => sum + Number(compra.valor_total || 0), 0);
    return { totalGeral, totalMes };
  }, [fornecedorCompras]);

  const openNovaCompra = (fornecedorId?: string) => {
    setCompraEditId(null);
    setCompraForm({
      ...emptyCompraForm(),
      fornecedor_id: fornecedorId || "none",
    });
    setCompraDialogOpen(true);
  };

  const openEditarCompra = (compra: Compra) => {
    setCompraEditId(compra.id);
    setCompraForm({
      fornecedor_id: compra.fornecedor_id || "none",
      categoria_compra_id: compra.categoria_compra_id || "none",
      descricao: compra.descricao,
      data_compra: compra.data_compra,
      status_pagamento: compra.status_pagamento === "pago" ? "pago" : "pendente",
      data_vencimento: compra.data_vencimento || "",
      forma_pagamento: compra.forma_pagamento,
      nota_fiscal: compra.nota_fiscal || "",
      observacoes: compra.observacoes || "",
      itens:
        compra.compra_itens && compra.compra_itens.length > 0
          ? compra.compra_itens.map((item) => ({
              key: item.id,
              nome: item.nome,
              quantidade: String(item.quantidade),
              unidade: item.unidade,
              preco_unitario: toInputMoney(Number(item.preco_unitario || 0)),
            }))
          : [emptyItem()],
    });
    setCompraDialogOpen(true);
  };

  const openVisualizarCompra = (compra: Compra) => {
    setCompraSelected(compra);
    setCompraDetailOpen(true);
  };

  const removeCompra = async (compraId: string) => {
    const { error } = await sb.from("compras").delete().eq("id", compraId);
    if (error) return toast.error(error.message);
    toast.success("Compra excluída");
    await loadAll();
  };

  const saveCompra = async () => {
    if (!compraForm.descricao.trim()) return toast.error("Informe a descrição da compra");
    if (!compraForm.itens.length || compraForm.itens.some((item) => !item.nome.trim())) {
      return toast.error("Preencha os itens da compra");
    }

    const payload = {
      fornecedor_id: compraForm.fornecedor_id === "none" ? null : compraForm.fornecedor_id,
      categoria_compra_id: compraForm.categoria_compra_id === "none" ? null : compraForm.categoria_compra_id,
      descricao: compraForm.descricao.trim(),
      valor_total: Number(compraFormTotal.toFixed(2)),
      data_compra: compraForm.data_compra,
      data_vencimento:
        compraForm.status_pagamento === "pendente"
          ? compraForm.data_vencimento || compraForm.data_compra
          : null,
      status_pagamento: compraForm.status_pagamento,
      forma_pagamento: compraForm.forma_pagamento,
      nota_fiscal: compraForm.nota_fiscal.trim() || null,
      observacoes: compraForm.observacoes.trim() || null,
    };

    const itemRows = compraForm.itens.map((item) => ({
      nome: item.nome.trim(),
      quantidade: parseMoney(item.quantidade),
      unidade: item.unidade,
      preco_unitario: Number(parseMoney(item.preco_unitario).toFixed(2)),
      preco_total: Number((parseMoney(item.quantidade) * parseMoney(item.preco_unitario)).toFixed(2)),
    }));

    setCompraBusy(true);

    if (compraEditId) {
      const { error: updateErr } = await sb.from("compras").update(payload).eq("id", compraEditId);
      if (updateErr) {
        setCompraBusy(false);
        return toast.error(updateErr.message);
      }

      const { error: deleteItemsErr } = await sb.from("compra_itens").delete().eq("compra_id", compraEditId);
      if (deleteItemsErr) {
        setCompraBusy(false);
        return toast.error(deleteItemsErr.message);
      }

      const { error: insertItemsErr } = await sb
        .from("compra_itens")
        .insert(itemRows.map((item) => ({ ...item, compra_id: compraEditId })));
      setCompraBusy(false);

      if (insertItemsErr) return toast.error(insertItemsErr.message);
      toast.success("Compra atualizada");
    } else {
      const { data, error: insertErr } = await sb.from("compras").insert(payload).select("id").single();
      if (insertErr || !data?.id) {
        setCompraBusy(false);
        return toast.error(insertErr?.message || "Erro ao criar compra");
      }

      const { error: insertItemsErr } = await sb
        .from("compra_itens")
        .insert(itemRows.map((item) => ({ ...item, compra_id: data.id })));
      setCompraBusy(false);

      if (insertItemsErr) return toast.error(insertItemsErr.message);
      toast.success("Compra criada");
    }

    setCompraDialogOpen(false);
    setCompraForm(emptyCompraForm());
    setCompraEditId(null);
    await loadAll();
  };

  const openNovoFornecedor = () => {
    setFornecedorEditId(null);
    setFornecedorForm(emptyFornecedorForm());
    setFornecedorDialogOpen(true);
  };

  const openNovaCategoria = () => {
    setCategoriaForm(emptyCategoriaForm());
    setCategoriaDialogOpen(true);
  };

  const openEditarFornecedor = (fornecedor: Fornecedor) => {
    setFornecedorEditId(fornecedor.id);
    setFornecedorForm({
      nome: fornecedor.nome,
      cnpj: fornecedor.cnpj || "",
      telefone: fornecedor.telefone || "",
      email: fornecedor.email || "",
      contato_responsavel: fornecedor.contato_responsavel || "",
      observacoes: fornecedor.observacoes || "",
    });
    setFornecedorDialogOpen(true);
  };

  const saveFornecedor = async () => {
    if (!fornecedorForm.nome.trim()) return toast.error("Informe o nome do fornecedor");
    if (fornecedorForm.cnpj && !cnpjRegex.test(fornecedorForm.cnpj)) {
      return toast.error("CNPJ inválido. Use o formato 00.000.000/0000-00");
    }

    const payload = {
      nome: fornecedorForm.nome.trim(),
      cnpj: fornecedorForm.cnpj || null,
      telefone: fornecedorForm.telefone || null,
      email: fornecedorForm.email || null,
      contato_responsavel: fornecedorForm.contato_responsavel || null,
      observacoes: fornecedorForm.observacoes || null,
      ativo: true,
    };

    setFornecedorBusy(true);
    const { data, error } = fornecedorEditId
      ? await sb.from("fornecedores").update(payload).eq("id", fornecedorEditId).select("id").single()
      : await sb.from("fornecedores").insert(payload).select("id").single();
    setFornecedorBusy(false);

    if (error) return toast.error(error.message);

    toast.success(fornecedorEditId ? "Fornecedor atualizado" : "Fornecedor criado");

    if (!fornecedorEditId && data?.id) {
      setCompraForm((current) => ({ ...current, fornecedor_id: data.id }));
    }

    setFornecedorDialogOpen(false);
    setFornecedorEditId(null);
    setFornecedorForm(emptyFornecedorForm());
    await loadAll();
  };

  const saveCategoria = async () => {
    if (!categoriaForm.nome.trim()) return toast.error("Informe o nome da categoria");

    const payload = {
      nome: categoriaForm.nome.trim(),
      tipo: categoriaForm.tipo,
      cor: categoriaForm.cor,
      icone: categoriaForm.icone.trim() || null,
    };

    setCategoriaBusy(true);
    const { data, error } = await sb.from("categorias_compra").insert(payload).select("id").single();
    setCategoriaBusy(false);

    if (error) return toast.error(error.message);

    toast.success("Categoria criada");
    setCategoriaDialogOpen(false);
    setCategoriaForm(emptyCategoriaForm());

    await loadAll();

    if (data?.id) {
      setCompraForm((current) => ({ ...current, categoria_compra_id: data.id }));
    }
  };

  const toggleFornecedorAtivo = async (fornecedor: Fornecedor) => {
    const { error } = await sb.from("fornecedores").update({ ativo: !fornecedor.ativo }).eq("id", fornecedor.id);
    if (error) return toast.error(error.message);
    toast.success(fornecedor.ativo ? "Fornecedor inativado" : "Fornecedor reativado");
    await loadAll();
  };

  const openFornecedorDetalhe = (fornecedor: Fornecedor) => {
    setFornecedorSelected(fornecedor);
    setFornecedorDetailOpen(true);
  };

  const markContaAsPaga = async (conta: ContaPagar) => {
    const { error } = await sb
      .from("contas_pagar")
      .update({ status: "pago", data_pagamento: todayDate() })
      .eq("id", conta.id);
    if (error) return toast.error(error.message);
    toast.success("Conta marcada como paga");
    await loadAll();
  };

  const reportPeriodLabel =
    reportMode === "month" ? formatMonthLabel(reportMonth) : reportStart && reportEnd ? `${reportStart} a ${reportEnd}` : "Período customizado";

  const donutData = [
    { name: "Ingredientes", value: reportData.ingredientes, color: "#16a34a" },
    { name: "Embalagens", value: reportData.embalagens, color: "#2563eb" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl">Financeiro</h1>
          <p className="text-muted-foreground mt-1">Entradas de compra, fornecedores, contas a pagar e lucro.</p>
        </div>
      </div>

      <Tabs defaultValue="compras" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
          <TabsTrigger value="compras">Entradas de Compra</TabsTrigger>
          <TabsTrigger value="fornecedores">Fornecedores</TabsTrigger>
          <TabsTrigger value="contas">Contas a Pagar</TabsTrigger>
          <TabsTrigger value="lucro">Relatório de Lucro</TabsTrigger>
        </TabsList>

        <TabsContent value="compras" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-5">
              <Input type="date" value={filtroCompraInicio} onChange={(event) => setFiltroCompraInicio(event.target.value)} />
              <Input type="date" value={filtroCompraFim} onChange={(event) => setFiltroCompraFim(event.target.value)} />
              <Select value={filtroCompraFornecedor} onValueChange={setFiltroCompraFornecedor}>
                <SelectTrigger>
                  <SelectValue placeholder="Fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos fornecedores</SelectItem>
                  {fornecedores.map((fornecedor) => (
                    <SelectItem key={fornecedor.id} value={fornecedor.id}>
                      {fornecedor.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filtroCompraCategoria} onValueChange={setFiltroCompraCategoria}>
                <SelectTrigger>
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas categorias</SelectItem>
                  {categorias.map((categoria) => (
                    <SelectItem key={categoria.id} value={categoria.id}>
                      {categoria.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filtroCompraStatus} onValueChange={setFiltroCompraStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos status</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => openNovaCompra()}>
              <Plus className="h-4 w-4 mr-1" /> Nova compra
            </Button>
          </div>

          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Carregando compras...
                    </TableCell>
                  </TableRow>
                ) : comprasFiltradas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhuma compra encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  comprasFiltradas.map((compra) => {
                    const dias = daysUntil(compra.data_vencimento);
                    const showNearAlert = compra.status_pagamento !== "pago" && dias !== null && dias >= 0 && dias < 3;
                    const showLateAlert = compra.status_pagamento !== "pago" && dias !== null && dias < 0;

                    return (
                      <TableRow key={compra.id}>
                        <TableCell>{new Date(compra.data_compra + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell>{compra.fornecedores?.nome || "Sem fornecedor"}</TableCell>
                        <TableCell>{compra.categorias_compra?.nome || "Sem categoria"}</TableCell>
                        <TableCell>{compra.descricao}</TableCell>
                        <TableCell className="text-right font-medium">{brl(Number(compra.valor_total || 0))}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={statusBadgeClass(compra.status_pagamento)}>
                              {compra.status_pagamento}
                            </Badge>
                            {showLateAlert && <span title="Compra vencida">🔴</span>}
                            {showNearAlert && <span title="Próxima do vencimento">🟡</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openVisualizarCompra(compra)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openEditarCompra(compra)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="hover:text-destructive" onClick={() => void removeCompra(compra.id)}>
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

        <TabsContent value="fornecedores" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openNovoFornecedor}>
              <Plus className="h-4 w-4 mr-1" /> Novo fornecedor
            </Button>
          </div>

          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Contato responsável</TableHead>
                  <TableHead className="text-right">Total gasto</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fornecedores.map((fornecedor) => (
                  <TableRow key={fornecedor.id}>
                    <TableCell className="font-medium">{fornecedor.nome}</TableCell>
                    <TableCell>{fornecedor.cnpj || "-"}</TableCell>
                    <TableCell>{fornecedor.telefone || "-"}</TableCell>
                    <TableCell>{fornecedor.contato_responsavel || "-"}</TableCell>
                    <TableCell className="text-right">{brl(totalGastoFornecedor.get(fornecedor.id) || 0)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={fornecedor.ativo ? "bg-emerald-500/15 text-emerald-700" : "bg-zinc-500/15 text-zinc-700"}>
                        {fornecedor.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openFornecedorDetalhe(fornecedor)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEditarFornecedor(fornecedor)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => void toggleFornecedorAtivo(fornecedor)}>
                          {fornecedor.ativo ? <Trash2 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="contas" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Total a pagar este mês</p>
              <p className="text-2xl font-semibold mt-1">{brl(contasResumo.totalPagarMes)}</p>
            </Card>
            <Card className="p-4 border-red-200 bg-red-500/5">
              <p className="text-sm text-red-700">Total vencido</p>
              <p className="text-2xl font-semibold mt-1 text-red-700">{brl(contasResumo.totalVencido)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Total pago este mês</p>
              <p className="text-2xl font-semibold mt-1">{brl(contasResumo.totalPagoMes)}</p>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant={filtroContasStatus === "all" ? "default" : "outline"} onClick={() => setFiltroContasStatus("all")}>Todos</Button>
            <Button variant={filtroContasStatus === "pendente" ? "default" : "outline"} onClick={() => setFiltroContasStatus("pendente")}>Pendentes</Button>
            <Button variant={filtroContasStatus === "vencido" ? "default" : "outline"} onClick={() => setFiltroContasStatus("vencido")}>Vencidos</Button>
            <Button variant={filtroContasStatus === "pago" ? "default" : "outline"} onClick={() => setFiltroContasStatus("pago")}>Pagos</Button>
          </div>

          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contasFiltradas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma conta encontrada.</TableCell>
                  </TableRow>
                ) : (
                  contasFiltradas.map((conta) => (
                    <TableRow key={conta.id}>
                      <TableCell>{conta.fornecedores?.nome || "Sem fornecedor"}</TableCell>
                      <TableCell>{conta.descricao}</TableCell>
                      <TableCell className="text-right">{brl(Number(conta.valor || 0))}</TableCell>
                      <TableCell>{new Date(conta.data_vencimento + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadgeClass(conta.status)}>
                          {conta.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={conta.status === "pago"}
                          onClick={() => void markContaAsPaga(conta)}
                        >
                          Marcar como pago
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="lucro" className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>Modo de período</Label>
                <Select value={reportMode} onValueChange={(value: "month" | "custom") => setReportMode(value)}>
                  <SelectTrigger className="w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Mês/Ano</SelectItem>
                    <SelectItem value="custom">Período customizado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {reportMode === "month" ? (
                <div className="space-y-1">
                  <Label>Mês</Label>
                  <Input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} className="w-[190px]" />
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label>Data inicial</Label>
                    <Input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} className="w-[190px]" />
                  </div>
                  <div className="space-y-1">
                    <Label>Data final</Label>
                    <Input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} className="w-[190px]" />
                  </div>
                </>
              )}

              <Button onClick={() => void loadReport()} disabled={reportLoading}>
                {reportLoading ? "Atualizando..." : "Atualizar relatório"}
              </Button>

              <Button variant="outline" onClick={() => window.print()}>
                <FileDown className="h-4 w-4 mr-1" /> Exportar relatório
              </Button>
            </div>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Wallet className="h-4 w-4" /> Faturamento bruto</p>
              <p className="text-2xl font-semibold mt-1">{brl(reportData.faturamento)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Package className="h-4 w-4" /> Total de custos</p>
              <p className="text-2xl font-semibold mt-1">{brl(reportData.custos)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Receipt className="h-4 w-4" /> Lucro estimado</p>
              <p className="text-2xl font-semibold mt-1">{brl(reportData.lucro)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock3 className="h-4 w-4" /> Margem de lucro</p>
              <p className="text-2xl font-semibold mt-1">{reportData.margem.toFixed(2)}%</p>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4 h-[360px]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Custo por categoria</h3>
                <span className="text-xs text-muted-foreground">{reportPeriodLabel}</span>
              </div>
              <ResponsiveContainer width="100%" height="92%">
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95}>
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend />
                  <ChartTooltip formatter={(value: number) => brl(Number(value || 0))} />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-4 h-[360px]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Faturamento x custos por semana</h3>
                <span className="text-xs text-muted-foreground">{reportPeriodLabel}</span>
              </div>
              <ResponsiveContainer width="100%" height="92%">
                <BarChart data={reportData.semanal}>
                  <XAxis dataKey="semana" />
                  <YAxis />
                  <ChartTooltip formatter={(value: number) => brl(Number(value || 0))} />
                  <Legend />
                  <Bar dataKey="faturamento" fill="#16a34a" name="Faturamento" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="custos" fill="#ef4444" name="Custos" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead className="text-right">Total gasto</TableHead>
                  <TableHead className="text-right">% do custo total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.porFornecedor.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      Sem custos no período selecionado.
                    </TableCell>
                  </TableRow>
                ) : (
                  reportData.porFornecedor.map((item) => (
                    <TableRow key={item.fornecedor}>
                      <TableCell>{item.fornecedor}</TableCell>
                      <TableCell className="text-right">{brl(item.total)}</TableCell>
                      <TableCell className="text-right">{item.percentual.toFixed(2)}%</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={compraDialogOpen} onOpenChange={setCompraDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">{compraEditId ? "Editar compra" : "Nova compra"}</DialogTitle>
            <DialogDescription>Cadastre entradas de compra e seus itens.</DialogDescription>
          </DialogHeader>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <div className="flex gap-2">
                <Select
                  value={compraForm.fornecedor_id}
                  onValueChange={(value) => setCompraForm((current) => ({ ...current, fornecedor_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione fornecedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem fornecedor</SelectItem>
                    {fornecedores.map((fornecedor) => (
                      <SelectItem key={fornecedor.id} value={fornecedor.id}>
                        {fornecedor.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={openNovoFornecedor}>Novo fornecedor</Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <div className="flex gap-2">
                <Select
                  value={compraForm.categoria_compra_id}
                  onValueChange={(value) => setCompraForm((current) => ({ ...current, categoria_compra_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {categorias.map((categoria) => (
                      <SelectItem key={categoria.id} value={categoria.id}>
                        {categoria.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={openNovaCategoria}>Nova categoria</Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Data da compra</Label>
              <Input
                type="date"
                value={compraForm.data_compra}
                onChange={(event) => setCompraForm((current) => ({ ...current, data_compra: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Forma de pagamento</Label>
              <Select
                value={compraForm.forma_pagamento}
                onValueChange={(value: FormaPagamento) => setCompraForm((current) => ({ ...current, forma_pagamento: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formaPagamentoOptions.map((forma) => (
                    <SelectItem key={forma} value={forma}>
                      {forma}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status de pagamento</Label>
              <Select
                value={compraForm.status_pagamento}
                onValueChange={(value: "pago" | "pendente") =>
                  setCompraForm((current) => ({
                    ...current,
                    status_pagamento: value,
                    data_vencimento: value === "pago" ? "" : current.data_vencimento,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {compraForm.status_pagamento === "pendente" && (
              <div className="space-y-2">
                <Label>Data de vencimento</Label>
                <Input
                  type="date"
                  value={compraForm.data_vencimento}
                  onChange={(event) => setCompraForm((current) => ({ ...current, data_vencimento: event.target.value }))}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                value={compraForm.descricao}
                onChange={(event) => setCompraForm((current) => ({ ...current, descricao: event.target.value }))}
                placeholder="Ex: compra semanal de insumos"
              />
            </div>

            <div className="space-y-2">
              <Label>Nota fiscal</Label>
              <Input
                value={compraForm.nota_fiscal}
                onChange={(event) => setCompraForm((current) => ({ ...current, nota_fiscal: event.target.value }))}
                placeholder="Número ou referência"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observações</Label>
            <Textarea
              value={compraForm.observacoes}
              onChange={(event) => setCompraForm((current) => ({ ...current, observacoes: event.target.value }))}
              placeholder="Informações adicionais"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Itens da compra</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCompraForm((current) => ({ ...current, itens: [...current.itens, emptyItem()] }))}
              >
                <Plus className="h-4 w-4 mr-1" /> Adicionar item
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Preço unitário</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compraForm.itens.map((item, index) => {
                  const lineTotal = parseMoney(item.quantidade) * parseMoney(item.preco_unitario);

                  return (
                    <TableRow key={item.key}>
                      <TableCell>
                        <Input
                          value={item.nome}
                          onChange={(event) =>
                            setCompraForm((current) => ({
                              ...current,
                              itens: current.itens.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, nome: event.target.value } : row,
                              ),
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={item.quantidade}
                          onChange={(event) =>
                            setCompraForm((current) => ({
                              ...current,
                              itens: current.itens.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, quantidade: event.target.value } : row,
                              ),
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.unidade}
                          onValueChange={(value: UnidadeCompra) =>
                            setCompraForm((current) => ({
                              ...current,
                              itens: current.itens.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, unidade: value } : row,
                              ),
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {unidadeOptions.map((unidade) => (
                              <SelectItem key={unidade} value={unidade}>
                                {unidade}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={item.preco_unitario}
                          onChange={(event) =>
                            setCompraForm((current) => ({
                              ...current,
                              itens: current.itens.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, preco_unitario: event.target.value } : row,
                              ),
                            }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">{brl(lineTotal)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={compraForm.itens.length === 1}
                          onClick={() =>
                            setCompraForm((current) => ({
                              ...current,
                              itens: current.itens.filter((_, rowIndex) => rowIndex !== index),
                            }))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex justify-end">
              <Badge variant="secondary" className="text-base px-3 py-1">Total geral: {brl(compraFormTotal)}</Badge>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCompraDialogOpen(false)} disabled={compraBusy}>Cancelar</Button>
            <Button onClick={() => void saveCompra()} disabled={compraBusy}>
              <Save className="h-4 w-4 mr-1" /> {compraBusy ? "Salvando..." : "Salvar compra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={compraDetailOpen} onOpenChange={setCompraDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">Detalhes da compra</DialogTitle>
          </DialogHeader>

          {compraSelected && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-3 text-sm">
                <div><strong>Fornecedor:</strong> {compraSelected.fornecedores?.nome || "Sem fornecedor"}</div>
                <div><strong>Categoria:</strong> {compraSelected.categorias_compra?.nome || "Sem categoria"}</div>
                <div><strong>Data:</strong> {new Date(compraSelected.data_compra + "T00:00:00").toLocaleDateString("pt-BR")}</div>
                <div><strong>Forma:</strong> {compraSelected.forma_pagamento}</div>
                <div><strong>Status:</strong> {compraSelected.status_pagamento}</div>
                <div><strong>Total:</strong> {brl(Number(compraSelected.valor_total || 0))}</div>
              </div>

              <Card className="p-0 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Qtd</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Preço unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(compraSelected.compra_itens || []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.nome}</TableCell>
                        <TableCell>{item.quantidade}</TableCell>
                        <TableCell>{item.unidade}</TableCell>
                        <TableCell>{brl(Number(item.preco_unitario || 0))}</TableCell>
                        <TableCell className="text-right">{brl(Number(item.preco_total || 0))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              {compraSelected.observacoes && (
                <div className="text-sm"><strong>Observações:</strong> {compraSelected.observacoes}</div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={fornecedorDialogOpen} onOpenChange={setFornecedorDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">{fornecedorEditId ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          </DialogHeader>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Nome</Label>
              <Input
                value={fornecedorForm.nome}
                onChange={(event) => setFornecedorForm((current) => ({ ...current, nome: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>CNPJ</Label>
              <Input
                value={fornecedorForm.cnpj}
                onChange={(event) =>
                  setFornecedorForm((current) => ({ ...current, cnpj: maskCnpj(event.target.value) }))
                }
                placeholder="00.000.000/0000-00"
              />
            </div>

            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                value={fornecedorForm.telefone}
                onChange={(event) =>
                  setFornecedorForm((current) => ({ ...current, telefone: maskPhone(event.target.value) }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={fornecedorForm.email}
                onChange={(event) => setFornecedorForm((current) => ({ ...current, email: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Contato responsável</Label>
              <Input
                value={fornecedorForm.contato_responsavel}
                onChange={(event) =>
                  setFornecedorForm((current) => ({ ...current, contato_responsavel: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Observações</Label>
              <Textarea
                value={fornecedorForm.observacoes}
                onChange={(event) => setFornecedorForm((current) => ({ ...current, observacoes: event.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFornecedorDialogOpen(false)} disabled={fornecedorBusy}>Cancelar</Button>
            <Button onClick={() => void saveFornecedor()} disabled={fornecedorBusy}>
              {fornecedorBusy ? "Salvando..." : "Salvar fornecedor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={categoriaDialogOpen} onOpenChange={setCategoriaDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">Nova categoria de compra</DialogTitle>
            <DialogDescription>Crie a categoria que você quiser para classificar seus custos.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={categoriaForm.nome}
                onChange={(event) => setCategoriaForm((current) => ({ ...current, nome: event.target.value }))}
                placeholder="Ex: Limpeza, Bebidas, Manutenção"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={categoriaForm.tipo}
                  onValueChange={(value: CategoriaTipo) => setCategoriaForm((current) => ({ ...current, tipo: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ingrediente">Ingrediente</SelectItem>
                    <SelectItem value="embalagem">Embalagem</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Cor</Label>
                <Input
                  type="color"
                  value={categoriaForm.cor}
                  onChange={(event) => setCategoriaForm((current) => ({ ...current, cor: event.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ícone (opcional)</Label>
              <Input
                value={categoriaForm.icone}
                onChange={(event) => setCategoriaForm((current) => ({ ...current, icone: event.target.value }))}
                placeholder="Ex: box, leaf, truck"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoriaDialogOpen(false)} disabled={categoriaBusy}>Cancelar</Button>
            <Button onClick={() => void saveCategoria()} disabled={categoriaBusy}>
              {categoriaBusy ? "Salvando..." : "Salvar categoria"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={fornecedorDetailOpen} onOpenChange={setFornecedorDetailOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">Fornecedor</DialogTitle>
          </DialogHeader>

          {fornecedorSelected && (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid md:grid-cols-2 gap-x-8 gap-y-1 text-sm">
                    <div><strong>Nome:</strong> {fornecedorSelected.nome}</div>
                    <div><strong>CNPJ:</strong> {fornecedorSelected.cnpj || "-"}</div>
                    <div><strong>Telefone:</strong> {fornecedorSelected.telefone || "-"}</div>
                    <div><strong>Email:</strong> {fornecedorSelected.email || "-"}</div>
                    <div><strong>Contato:</strong> {fornecedorSelected.contato_responsavel || "-"}</div>
                    <div><strong>Status:</strong> {fornecedorSelected.ativo ? "Ativo" : "Inativo"}</div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => openEditarFornecedor(fornecedorSelected)}>
                      <Pencil className="h-4 w-4 mr-1" /> Editar
                    </Button>
                    <Button onClick={() => openNovaCompra(fornecedorSelected.id)}>
                      <Plus className="h-4 w-4 mr-1" /> Nova compra
                    </Button>
                  </div>
                </div>

                {fornecedorSelected.observacoes && (
                  <p className="text-sm mt-3 text-muted-foreground">{fornecedorSelected.observacoes}</p>
                )}
              </Card>

              <div className="grid gap-3 md:grid-cols-2">
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Total gasto no mês atual</p>
                  <p className="text-2xl font-semibold mt-1">{brl(fornecedorTotais.totalMes)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Total gasto geral</p>
                  <p className="text-2xl font-semibold mt-1">{brl(fornecedorTotais.totalGeral)}</p>
                </Card>
              </div>

              <Card className="p-0 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fornecedorCompras.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Sem compras para este fornecedor.</TableCell>
                      </TableRow>
                    ) : (
                      fornecedorCompras.map((compra) => (
                        <TableRow key={compra.id}>
                          <TableCell>{new Date(compra.data_compra + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell>{compra.descricao}</TableCell>
                          <TableCell className="text-right">{brl(Number(compra.valor_total || 0))}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusBadgeClass(compra.status_pagamento)}>
                              {compra.status_pagamento}
                            </Badge>
                          </TableCell>
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
