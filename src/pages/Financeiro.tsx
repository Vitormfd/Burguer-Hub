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
  Printer,
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
import { brl, toLocalDateKey, toLocalMonthKey } from "@/lib/format";
import { buildCaixaResumo } from "@/lib/caixaResumo";
import { fetchFaturamentoPeriodo, totalPedidoDelivery } from "@/lib/faturamento";
import { printCashSummary, type CashSummary } from "@/lib/print";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
type CaixaStatus = "aberto" | "fechado";
type CaixaMovimentacaoTipo = "retirada" | "suprimento";

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
  recorrente_mensal?: boolean | null;
  dia_vencimento?: number | null;
  fornecedores?: Fornecedor | null;
  compras?: Compra | null;
}

interface Caixa {
  id: string;
  owner_id: string;
  status: CaixaStatus;
  valor_inicial: number;
  valor_final: number | null;
  observacoes: string | null;
  aberto_em: string;
  fechado_em: string | null;
  criado_em: string;
}

interface CaixaMovimentacao {
  id: string;
  caixa_id: string;
  owner_id: string;
  tipo: CaixaMovimentacaoTipo;
  valor: number;
  descricao: string | null;
  criado_em: string;
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

interface CaixaFormState {
  valor: string;
  observacoes: string;
}

interface RetiradaCaixaFormState {
  valor: string;
  descricao: string;
}

interface ContaFixaFormState {
  fornecedor_id: string;
  descricao: string;
  valor: string;
  data_vencimento: string;
  recorrente_mensal: boolean;
  dia_vencimento: string;
  observacoes: string;
}

interface WeeklyReportPoint {
  semana: string;
  faturamento: number;
  custos: number;
}

interface ReportData {
  faturamento: number;
  custos: number;
  contasFixas: number;
  lucro: number;
  margem: number;
  caixaAberturas: number;
  caixaFechamentos: number;
  caixaSaldo: number;
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
  data_compra: toLocalDateKey(),
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

const emptyCaixaForm = (): CaixaFormState => ({
  valor: "",
  observacoes: "",
});

const emptyRetiradaCaixaForm = (): RetiradaCaixaFormState => ({
  valor: "",
  descricao: "",
});

const emptyContaFixaForm = (): ContaFixaFormState => ({
  fornecedor_id: "none",
  descricao: "",
  valor: "",
  data_vencimento: toLocalDateKey(),
  recorrente_mensal: false,
  dia_vencimento: String(new Date().getDate()),
  observacoes: "",
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

const statusBadgeClass = (status: CompraStatus | ContaStatus | CaixaStatus) => {
  if (status === "aberto") return "bg-sky-500/15 text-sky-700 border-sky-500/30";
  if (status === "pago") return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
  if (status === "vencido") return "bg-red-500/15 text-red-700 border-red-500/30";
  return "bg-amber-500/15 text-amber-700 border-amber-500/30";
};

const daysUntil = (dateString: string | null) => {
  if (!dateString) return null;
  const now = new Date(toLocalDateKey() + "T00:00:00");
  const due = new Date(dateString + "T00:00:00");
  return Math.floor((due.getTime() - now.getTime()) / 86400000);
};

const formatMonthLabel = (month: string) => {
  const [year, m] = month.split("-");
  return `${m}/${year}`;
};

const isRpcMissingFunctionError = (error: { code?: string; message?: string } | null | undefined) => {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return (error.message || "").toLowerCase().includes("could not find the function");
};

const isMissingTableError = (error: { code?: string; message?: string } | null | undefined) => {
  if (!error) return false;
  const message = (error.message || "").toLowerCase();
  return (
    message.includes("could not find the table") ||
    message.includes("schema cache") ||
    message.includes("relation \"public.caixa_movimentacoes\" does not exist")
  );
};

export default function Financeiro() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [categorias, setCategorias] = useState<CategoriaCompra[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [caixas, setCaixas] = useState<Caixa[]>([]);
  const [caixaMovimentacoes, setCaixaMovimentacoes] = useState<CaixaMovimentacao[]>([]);
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

  const [caixaDialogOpen, setCaixaDialogOpen] = useState(false);
  const [caixaDialogMode, setCaixaDialogMode] = useState<"abrir" | "fechar">("abrir");
  const [caixaBusy, setCaixaBusy] = useState(false);
  const [caixaForm, setCaixaForm] = useState<CaixaFormState>(emptyCaixaForm());
  const [caixaResumoPreview, setCaixaResumoPreview] = useState<CashSummary | null>(null);
  const [caixaResumoLoading, setCaixaResumoLoading] = useState(false);
  const [retiradaDialogOpen, setRetiradaDialogOpen] = useState(false);
  const [retiradaDialogMode, setRetiradaDialogMode] = useState<"retirada" | "suprimento">("retirada");
  const [retiradaBusy, setRetiradaBusy] = useState(false);
  const [retiradaForm, setRetiradaForm] = useState<RetiradaCaixaFormState>(emptyRetiradaCaixaForm());

  const [filtroCompraInicio, setFiltroCompraInicio] = useState("");
  const [filtroCompraFim, setFiltroCompraFim] = useState("");
  const [filtroCompraFornecedor, setFiltroCompraFornecedor] = useState("all");
  const [filtroCompraCategoria, setFiltroCompraCategoria] = useState("all");
  const [filtroCompraStatus, setFiltroCompraStatus] = useState("all");

  const [filtroContasStatus, setFiltroContasStatus] = useState<"all" | ContaStatus>("all");
  const [filtroContasOrigem, setFiltroContasOrigem] = useState<"all" | "fixa" | "compra">("all");

  const [contaFixaDialogOpen, setContaFixaDialogOpen] = useState(false);
  const [contaFixaBusy, setContaFixaBusy] = useState(false);
  const [contaFixaForm, setContaFixaForm] = useState<ContaFixaFormState>(emptyContaFixaForm());

  const currentMonth = toLocalMonthKey();
  const [reportMode, setReportMode] = useState<"month" | "custom">("month");
  const [reportMonth, setReportMonth] = useState(currentMonth);
  const [reportStart, setReportStart] = useState("");
  const [reportEnd, setReportEnd] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData>({
    faturamento: 0,
    custos: 0,
    contasFixas: 0,
    lucro: 0,
    margem: 0,
    caixaAberturas: 0,
    caixaFechamentos: 0,
    caixaSaldo: 0,
    ingredientes: 0,
    embalagens: 0,
    porFornecedor: [],
    semanal: [],
  });

  const loadAll = useCallback(async () => {
    setLoading(true);

    const syncRecorrenciaRes = await sb.rpc("gerar_contas_fixas_recorrentes");
    if (syncRecorrenciaRes.error && !isRpcMissingFunctionError(syncRecorrenciaRes.error)) {
      // Nao bloqueia a carga da tela por falha na sincronizacao auxiliar.
      toast.error(syncRecorrenciaRes.error.message);
    }

    const [fornRes, catRes, compRes, contasRes, caixasRes, movRes] = await Promise.all([
      sb.from("fornecedores").select("*").order("nome"),
      sb.from("categorias_compra").select("*").order("nome"),
      sb
        .from("compras")
        .select("*, fornecedores(*), categorias_compra(*), compra_itens(*)")
        .order("data_compra", { ascending: false }),
      sb.from("contas_pagar").select("*, fornecedores(*), compras(*)").order("data_vencimento", { ascending: true }),
      sb.from("caixas").select("*").order("aberto_em", { ascending: false }),
      sb.from("caixa_movimentacoes").select("*").order("criado_em", { ascending: false }),
    ]);

    setLoading(false);

    const movTableMissing = movRes.error && isMissingTableError(movRes.error);
    if (fornRes.error || catRes.error || compRes.error || contasRes.error || caixasRes.error || (!movTableMissing && movRes.error)) {
      return toast.error(
        fornRes.error?.message ||
          catRes.error?.message ||
          compRes.error?.message ||
          contasRes.error?.message ||
          caixasRes.error?.message ||
          (!movTableMissing ? movRes.error?.message : undefined) ||
          "Erro ao carregar financeiro",
      );
    }

    if (movTableMissing) {
      console.warn("Financeiro: caixa_movimentacoes table missing, skipping movimentos load.", movRes.error?.message);
      setCaixaMovimentacoes([]);
    } else {
      setCaixaMovimentacoes((movRes.data || []) as CaixaMovimentacao[]);
    }

    setFornecedores((fornRes.data || []) as Fornecedor[]);
    setCategorias((catRes.data || []) as CategoriaCompra[]);
    setCompras((compRes.data || []) as Compra[]);
    setContasPagar((contasRes.data || []) as ContaPagar[]);
    setCaixas((caixasRes.data || []) as Caixa[]);
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
    const iniDate = toLocalDateKey(ini);
    const fimDate = toLocalDateKey(fim);

    const [faturamentoRes, custosRes, contasFixasRes, caixasRes] = await Promise.all([
      fetchFaturamentoPeriodo(iniIso, fimIso, sb),
      sb
        .from("compras")
        .select("id, fornecedor_id, valor_total, data_compra, fornecedores(nome), categorias_compra(tipo)")
        .eq("status_pagamento", "pago")
        .gte("data_compra", iniDate)
        .lte("data_compra", fimDate),
      sb
        .from("contas_pagar")
        .select("id, valor, data_pagamento")
        .is("compra_id", null)
        .eq("status", "pago")
        .gte("data_pagamento", iniDate)
        .lte("data_pagamento", fimDate),
      sb
        .from("caixas")
        .select("id, status, valor_inicial, valor_final, aberto_em, fechado_em")
        .or(`aberto_em.gte.${iniIso},fechado_em.gte.${iniIso}`)
        .lte("aberto_em", fimIso),
    ]);

    if (custosRes.error || contasFixasRes.error || caixasRes.error) {
      setReportLoading(false);
      return toast.error(
        custosRes.error?.message ||
          contasFixasRes.error?.message ||
          caixasRes.error?.message ||
          "Erro ao gerar relatório",
      );
    }

    const faturamento = faturamentoRes.total;

    const custosRows = (custosRes.data || []) as Array<{
      id: string;
      fornecedor_id: string | null;
      valor_total: number;
      data_compra: string;
      fornecedores?: { nome: string } | null;
      categorias_compra?: { tipo: CategoriaTipo } | null;
    }>;

    const custosCompras = custosRows.reduce((sum, row) => sum + Number(row.valor_total || 0), 0);

    const contasFixasRows = (contasFixasRes.data || []) as Array<{
      id: string;
      valor: number;
      data_pagamento: string | null;
    }>;

    const contasFixas = contasFixasRows.reduce((sum, row) => sum + Number(row.valor || 0), 0);
    const custos = custosCompras + contasFixas;
    const lucro = faturamento - custos;
    const margem = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

    const caixasRows = (caixasRes.data || []) as Array<{
      id: string;
      status: CaixaStatus;
      valor_inicial: number;
      valor_final: number | null;
      aberto_em: string;
      fechado_em: string | null;
    }>;

    const caixaAberturas = caixasRows.filter((caixa) => caixa.aberto_em >= iniIso && caixa.aberto_em <= fimIso).length;
    const caixaFechamentos = caixasRows.filter((caixa) => caixa.fechado_em && caixa.fechado_em >= iniIso && caixa.fechado_em <= fimIso).length;
    const caixaSaldo = caixasRows
      .filter((caixa) => caixa.status === "fechado" && caixa.fechado_em && caixa.fechado_em >= iniIso && caixa.fechado_em <= fimIso)
      .reduce((sum, caixa) => sum + Number(caixa.valor_final || 0) - Number(caixa.valor_inicial || 0), 0);

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

    if (contasFixas > 0) {
      fornecedorMap.set("contas-fixas", {
        nome: "Contas fixas",
        total: contasFixas,
      });
    }

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

    contasFixasRows.forEach((row) => {
      if (!row.data_pagamento) return;
      const date = new Date(row.data_pagamento + "T00:00:00");
      const week = `Sem ${Math.ceil(date.getDate() / 7)}`;
      weekCosts.set(week, (weekCosts.get(week) || 0) + Number(row.valor || 0));
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
        .select("id, criado_em, tipo_entrega, total, subtotal, desconto, valor_desconto")
        .eq("tipo", "delivery")
        .neq("status", "cancelado")
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

    const pedidosSemana = pedidosSemanaRes.data || [];
    const deliveryWeekIds = pedidosSemana.map((pedido: any) => pedido.id);

    if (deliveryWeekIds.length > 0) {
      const [itensRes, entregasRes] = await Promise.all([
        sb.from("pedido_itens").select("pedido_id, quantidade, preco_unitario, cancelado").in("pedido_id", deliveryWeekIds),
        sb.from("entregas").select("pedido_id, taxa_entrega").in("pedido_id", deliveryWeekIds),
      ]);

      if (!itensRes.error && !entregasRes.error) {
        const itemTotals = new Map<string, number>();
        (itensRes.data || []).forEach((item: any) => {
          if (item.cancelado) return;
          itemTotals.set(
            item.pedido_id,
            (itemTotals.get(item.pedido_id) || 0) + Number(item.preco_unitario || 0) * Number(item.quantidade || 0),
          );
        });

        const taxaMap = new Map((entregasRes.data || []).map((entrega: any) => [entrega.pedido_id, Number(entrega.taxa_entrega || 0)]));

        pedidosSemana.forEach((pedido: any) => {
          const date = new Date(pedido.criado_em);
          const week = `Sem ${Math.ceil(date.getDate() / 7)}`;
          const taxa = pedido.tipo_entrega === "retirada" ? 0 : (taxaMap.get(pedido.id) || 0);
          const value = totalPedidoDelivery(pedido, itemTotals.get(pedido.id) || 0, taxa);
          weekRevenue.set(week, (weekRevenue.get(week) || 0) + value);
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
      contasFixas,
      lucro,
      margem,
      caixaAberturas,
      caixaFechamentos,
      caixaSaldo,
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
    const base = contasPagar.filter((conta) => {
      if (filtroContasStatus !== "all" && conta.status !== filtroContasStatus) return false;
      if (filtroContasOrigem === "fixa" && conta.compra_id !== null) return false;
      if (filtroContasOrigem === "compra" && conta.compra_id === null) return false;
      return true;
    });
    return base.sort((left, right) => {
      const leftTime = new Date(left.data_vencimento).getTime();
      const rightTime = new Date(right.data_vencimento).getTime();
      return leftTime - rightTime;
    });
  }, [contasPagar, filtroContasStatus, filtroContasOrigem]);

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

    const totalFixasPendentes = contasPagar
      .filter((conta) => conta.compra_id === null && conta.status !== "pago")
      .reduce((sum, conta) => sum + Number(conta.valor || 0), 0);

    return { totalPagarMes, totalVencido, totalPagoMes, totalFixasPendentes };
  }, [contasPagar]);

  const caixaAberto = useMemo(() => caixas.find((caixa) => caixa.status === "aberto") || null, [caixas]);

  const caixasHistorico = useMemo(() => caixas.slice().sort((left, right) => right.aberto_em.localeCompare(left.aberto_em)), [caixas]);

  const movimentacoesCaixaAberto = useMemo(() => {
    if (!caixaAberto) return [] as CaixaMovimentacao[];
    return caixaMovimentacoes.filter((mov) => mov.caixa_id === caixaAberto.id);
  }, [caixaMovimentacoes, caixaAberto]);

  const totalRetiradasCaixaAberto = useMemo(
    () =>
      movimentacoesCaixaAberto
        .filter((mov) => mov.tipo === "retirada")
        .reduce((sum, mov) => sum + Number(mov.valor || 0), 0),
    [movimentacoesCaixaAberto],
  );

  const totalSuprimentosCaixaAberto = useMemo(
    () =>
      movimentacoesCaixaAberto
        .filter((mov) => mov.tipo === "suprimento")
        .reduce((sum, mov) => sum + Number(mov.valor || 0), 0),
    [movimentacoesCaixaAberto],
  );

  const valorContadoPreview = useMemo(() => {
    if (!caixaForm.valor.trim()) return null;
    const valor = Number(parseMoney(caixaForm.valor).toFixed(2));
    return Number.isFinite(valor) ? valor : null;
  }, [caixaForm.valor]);

  const diferencaCaixaPreview = useMemo(() => {
    if (valorContadoPreview == null || caixaResumoPreview?.dinheiro_esperado == null) return null;
    return Number((valorContadoPreview - caixaResumoPreview.dinheiro_esperado).toFixed(2));
  }, [valorContadoPreview, caixaResumoPreview]);

  const fornecedorCompras = useMemo(() => {
    if (!fornecedorSelected) return [] as Compra[];
    return compras
      .filter((compra) => compra.fornecedor_id === fornecedorSelected.id)
      .sort((left, right) => right.data_compra.localeCompare(left.data_compra));
  }, [compras, fornecedorSelected]);

  const fornecedorTotais = useMemo(() => {
    const totalGeral = fornecedorCompras.reduce((sum, compra) => sum + Number(compra.valor_total || 0), 0);
    const month = toLocalMonthKey();
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

  const openAbrirCaixa = () => {
    setCaixaDialogMode("abrir");
    setCaixaForm(emptyCaixaForm());
    setCaixaResumoPreview(null);
    setCaixaDialogOpen(true);
  };

  const loadCaixaResumoPreview = useCallback(async (caixaId: string) => {
    setCaixaResumoLoading(true);
    const resumo = await buildCaixaResumo(caixaId);
    setCaixaResumoPreview(resumo);
    setCaixaResumoLoading(false);
  }, []);

  const openFecharCaixa = () => {
    if (!caixaAberto) {
      toast.error("Não há caixa aberto no momento");
      return;
    }

    setCaixaDialogMode("fechar");
    setCaixaForm({
      valor: "",
      observacoes: caixaAberto.observacoes || "",
    });
    setCaixaResumoPreview(null);
    setCaixaDialogOpen(true);
    void loadCaixaResumoPreview(caixaAberto.id);
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

    const nome = categoriaForm.nome.trim();
    const nomeJaExiste = categorias.some((c) => c.nome.toLowerCase() === nome.toLowerCase());
    if (nomeJaExiste) {
      return toast.error("Já existe uma categoria com este nome");
    }

    const payload = {
      nome,
      tipo: categoriaForm.tipo,
      cor: categoriaForm.cor,
      icone: categoriaForm.icone.trim() || null,
    };

    setCategoriaBusy(true);
    const { data, error } = await sb.from("categorias_compra").insert(payload).select("id").single();
    setCategoriaBusy(false);

    if (error) {
      if (error.code === "23505") {
        return toast.error("Já existe uma categoria com este nome");
      }
      return toast.error(error.message);
    }

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

  const saveCaixa = async () => {
    if (!caixaForm.valor.trim()) {
      return toast.error(caixaDialogMode === "abrir" ? "Informe o valor inicial" : "Informe o valor final");
    }

    const valor = Number(parseMoney(caixaForm.valor).toFixed(2));
    const observacoes = caixaForm.observacoes.trim() || null;

    setCaixaBusy(true);

    if (caixaDialogMode === "abrir") {
      const { error } = await sb.rpc("abrir_caixa", {
        p_valor_inicial: valor,
        p_observacoes: observacoes,
      });

      setCaixaBusy(false);

      if (error) return toast.error(error.message);

      toast.success("Caixa aberto");
    } else {
      if (!caixaAberto) {
        setCaixaBusy(false);
        return toast.error("Não há caixa aberto para fechar");
      }

      const { data: caixaClosed, error } = await sb.rpc("fechar_caixa", {
        p_caixa_id: caixaAberto.id,
        p_valor_final: valor,
        p_observacoes: observacoes,
      });

      setCaixaBusy(false);

      if (error) return toast.error(error.message);

      toast.success("Caixa fechado");

      // Após fechar, monta e imprime resumo do caixa automaticamente (se possível)
      try {
        if (caixaClosed && (caixaClosed as any).id && typeof window !== "undefined") {
          const enabled = (localStorage.getItem("bh_auto_print_cash_on_close") ?? "1") === "1";
          if (enabled) await buildAndPrintCaixaSummary((caixaClosed as any).id);
        }
      } catch (err) {
        console.error("Erro ao imprimir resumo do caixa:", err);
      }
    }

    setCaixaDialogOpen(false);
    setCaixaForm(emptyCaixaForm());
    await loadAll();
  };

  const openRetiradaCaixa = () => {
    if (!caixaAberto) {
      toast.error("Abra o caixa para registrar retiradas");
      return;
    }

    setRetiradaDialogMode("retirada");
    setRetiradaForm(emptyRetiradaCaixaForm());
    setRetiradaDialogOpen(true);
  };

  const openSuprimentoCaixa = () => {
    if (!caixaAberto) {
      toast.error("Abra o caixa para registrar suprimentos");
      return;
    }

    setRetiradaDialogMode("suprimento");
    setRetiradaForm(emptyRetiradaCaixaForm());
    setRetiradaDialogOpen(true);
  };

  const saveRetiradaCaixa = async () => {
    if (!caixaAberto) return toast.error("Não há caixa aberto no momento");
    if (!retiradaForm.valor.trim()) return toast.error("Informe o valor da retirada");

    const valor = Number(parseMoney(retiradaForm.valor).toFixed(2));
    if (valor <= 0) return toast.error("Informe um valor maior que zero");

    setRetiradaBusy(true);
    const { error } =
      retiradaDialogMode === "retirada"
        ? await sb.rpc("registrar_retirada_caixa", {
            p_caixa_id: caixaAberto.id,
            p_valor: valor,
            p_descricao: retiradaForm.descricao.trim() || null,
          })
        : await sb.rpc("registrar_suprimento_caixa", {
            p_caixa_id: caixaAberto.id,
            p_valor: valor,
            p_descricao: retiradaForm.descricao.trim() || null,
          });
    setRetiradaBusy(false);

    if (error) return toast.error(error.message);

    toast.success(retiradaDialogMode === "retirada" ? "Retirada registrada no caixa" : "Suprimento registrado no caixa");
    setRetiradaDialogOpen(false);
    setRetiradaForm(emptyRetiradaCaixaForm());
    await loadAll();
  };

  const buildAndPrintCaixaSummary = async (caixaId: string) => {
    try {
      const summary = await buildCaixaResumo(caixaId);
      if (!summary) return;
      printCashSummary(summary);
    } catch (err) {
      console.error("Erro ao montar resumo do caixa:", err);
    }
  };

  const openFornecedorDetalhe = (fornecedor: Fornecedor) => {
    setFornecedorSelected(fornecedor);
    setFornecedorDetailOpen(true);
  };

  const markContaAsPaga = async (conta: ContaPagar) => {
    const { error } = await sb
      .from("contas_pagar")
      .update({ status: "pago", data_pagamento: toLocalDateKey() })
      .eq("id", conta.id);
    if (error) return toast.error(error.message);
    toast.success("Conta marcada como paga");
    await loadAll();
  };

  const openNovaContaFixa = () => {
    setContaFixaForm(emptyContaFixaForm());
    setContaFixaDialogOpen(true);
  };

  const saveContaFixa = async () => {
    if (!contaFixaForm.descricao.trim()) return toast.error("Informe a descrição da conta fixa");
    if (!contaFixaForm.data_vencimento) return toast.error("Informe a data de vencimento");

    const valor = Number(parseMoney(contaFixaForm.valor).toFixed(2));
    if (valor <= 0) return toast.error("Informe um valor maior que zero");

    const diaVencimento = Number(contaFixaForm.dia_vencimento || 0);
    if (contaFixaForm.recorrente_mensal && (!Number.isFinite(diaVencimento) || diaVencimento < 1 || diaVencimento > 31)) {
      return toast.error("Informe um dia de vencimento entre 1 e 31");
    }

    const payload = {
      compra_id: null,
      fornecedor_id: contaFixaForm.fornecedor_id === "none" ? null : contaFixaForm.fornecedor_id,
      descricao: contaFixaForm.descricao.trim(),
      valor,
      data_vencimento: contaFixaForm.data_vencimento,
      status: "pendente" as ContaStatus,
      recorrente_mensal: contaFixaForm.recorrente_mensal,
      dia_vencimento: contaFixaForm.recorrente_mensal ? diaVencimento : null,
      observacoes: contaFixaForm.observacoes.trim() || null,
    };

    setContaFixaBusy(true);
    const { error } = await sb.from("contas_pagar").insert(payload);
    setContaFixaBusy(false);

    if (error) return toast.error(error.message);

    toast.success("Conta fixa cadastrada");
    setContaFixaDialogOpen(false);
    setContaFixaForm(emptyContaFixaForm());
    await loadAll();
  };

  const removeContaFixa = async (conta: ContaPagar) => {
    const { error } = await sb.from("contas_pagar").delete().eq("id", conta.id).is("compra_id", null);
    if (error) return toast.error(error.message);
    toast.success("Conta fixa excluída");
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
          <p className="text-muted-foreground mt-1">Entradas de compra, caixa, fornecedores, contas a pagar e lucro.</p>
        </div>

        <div className="flex items-center gap-2">
          {caixaAberto ? (
            <Badge variant="outline" className={statusBadgeClass(caixaAberto.status)}>
              Caixa aberto
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-zinc-500/10 text-zinc-700 border-zinc-500/20">
              Caixa fechado
            </Badge>
          )}

          <Button onClick={caixaAberto ? openFecharCaixa : openAbrirCaixa}>
            <Wallet className="h-4 w-4 mr-1" />
            {caixaAberto ? "Fechar caixa" : "Abrir caixa"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="compras" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <TabsTrigger value="compras">Entradas de Compra</TabsTrigger>
          <TabsTrigger value="fornecedores">Fornecedores</TabsTrigger>
          <TabsTrigger value="contas">Contas a Pagar</TabsTrigger>
          <TabsTrigger value="caixa">Caixa</TabsTrigger>
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
          <div className="grid gap-3 md:grid-cols-4">
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
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Contas fixas pendentes</p>
              <p className="text-2xl font-semibold mt-1">{brl(contasResumo.totalFixasPendentes)}</p>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant={filtroContasStatus === "all" ? "default" : "outline"} onClick={() => setFiltroContasStatus("all")}>Todos</Button>
              <Button variant={filtroContasStatus === "pendente" ? "default" : "outline"} onClick={() => setFiltroContasStatus("pendente")}>Pendentes</Button>
              <Button variant={filtroContasStatus === "vencido" ? "default" : "outline"} onClick={() => setFiltroContasStatus("vencido")}>Vencidos</Button>
              <Button variant={filtroContasStatus === "pago" ? "default" : "outline"} onClick={() => setFiltroContasStatus("pago")}>Pagos</Button>
              <Button variant={filtroContasOrigem === "all" ? "default" : "outline"} onClick={() => setFiltroContasOrigem("all")}>Todas origens</Button>
              <Button variant={filtroContasOrigem === "fixa" ? "default" : "outline"} onClick={() => setFiltroContasOrigem("fixa")}>Contas fixas</Button>
              <Button variant={filtroContasOrigem === "compra" ? "default" : "outline"} onClick={() => setFiltroContasOrigem("compra")}>Compras</Button>
            </div>
            <Button onClick={openNovaContaFixa}>
              <Plus className="h-4 w-4 mr-1" /> Nova conta fixa
            </Button>
          </div>

          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Origem</TableHead>
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
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma conta encontrada.</TableCell>
                  </TableRow>
                ) : (
                  contasFiltradas.map((conta) => (
                    <TableRow key={conta.id}>
                      <TableCell>{conta.fornecedores?.nome || "Sem fornecedor"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={conta.compra_id ? "bg-zinc-500/10 text-zinc-700 border-zinc-500/20" : "bg-sky-500/15 text-sky-700 border-sky-500/30"}>
                          {conta.compra_id ? "Compra" : "Fixa"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{conta.descricao}</span>
                          {conta.compra_id === null && conta.recorrente_mensal && (
                            <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                              Recorrente
                            </Badge>
                          )}
                        </div>
                      </TableCell>
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
                        {conta.compra_id === null && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-2 hover:text-destructive"
                            onClick={() => void removeContaFixa(conta)}
                          >
                            Excluir
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="caixa" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Status atual</p>
              <p className="text-2xl font-semibold mt-1">{caixaAberto ? "Caixa aberto" : "Caixa fechado"}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Valor inicial</p>
              <p className="text-2xl font-semibold mt-1">{brl(Number(caixaAberto?.valor_inicial || 0))}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Aberto em</p>
              <p className="text-2xl font-semibold mt-1">
                {caixaAberto ? new Date(caixaAberto.aberto_em).toLocaleString("pt-BR") : "-"}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Retiradas na sessão</p>
              <p className="text-2xl font-semibold mt-1">{brl(totalRetiradasCaixaAberto)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Suprimentos na sessão</p>
              <p className="text-2xl font-semibold mt-1">{brl(totalSuprimentosCaixaAberto)}</p>
            </Card>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Sessão atual</h3>
                <p className="text-sm text-muted-foreground">
                  {caixaAberto ? caixaAberto.observacoes || "Sem observações" : "Abra um caixa para iniciar o controle do dia."}
                </p>
              </div>
              <Button onClick={caixaAberto ? openFecharCaixa : openAbrirCaixa}>
                <Wallet className="h-4 w-4 mr-1" />
                {caixaAberto ? "Fechar caixa" : "Abrir caixa"}
              </Button>
              <Button variant="outline" onClick={openRetiradaCaixa} disabled={!caixaAberto}>
                <Truck className="h-4 w-4 mr-1" /> Registrar retirada
              </Button>
              <Button variant="outline" onClick={openSuprimentoCaixa} disabled={!caixaAberto}>
                <Plus className="h-4 w-4 mr-1" /> Registrar suprimento
              </Button>
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!caixaAberto ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Abra um caixa para registrar movimentações.
                    </TableCell>
                  </TableRow>
                ) : movimentacoesCaixaAberto.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Nenhuma retirada registrada nesta sessão.
                    </TableCell>
                  </TableRow>
                ) : (
                  movimentacoesCaixaAberto.map((mov) => (
                    <TableRow key={mov.id}>
                      <TableCell>{new Date(mov.criado_em).toLocaleString("pt-BR")}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={mov.tipo === "retirada" ? "bg-amber-500/15 text-amber-700 border-amber-500/30" : "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"}>
                          {mov.tipo === "retirada" ? "Retirada" : "Suprimento"}
                        </Badge>
                      </TableCell>
                      <TableCell>{mov.descricao || "-"}</TableCell>
                      <TableCell className="text-right font-medium">{brl(Number(mov.valor || 0))}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aberto em</TableHead>
                  <TableHead>Fechado em</TableHead>
                  <TableHead className="text-right">Valor inicial</TableHead>
                  <TableHead className="text-right">Valor final</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Observações</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {caixasHistorico.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Nenhuma sessão de caixa registrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  caixasHistorico.map((caixa) => (
                    <TableRow key={caixa.id}>
                      <TableCell>{new Date(caixa.aberto_em).toLocaleString("pt-BR")}</TableCell>
                      <TableCell>{caixa.fechado_em ? new Date(caixa.fechado_em).toLocaleString("pt-BR") : "-"}</TableCell>
                      <TableCell className="text-right">{brl(Number(caixa.valor_inicial || 0))}</TableCell>
                      <TableCell className="text-right">{caixa.valor_final != null ? brl(Number(caixa.valor_final || 0)) : "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadgeClass(caixa.status)}>
                          {caixa.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate">{caixa.observacoes || "-"}</TableCell>
                      <TableCell className="text-right">
                        {caixa.status === "fechado" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void buildAndPrintCaixaSummary(caixa.id)}
                          >
                            <Printer className="h-3.5 w-3.5 mr-1" /> Resumo
                          </Button>
                        )}
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

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Wallet className="h-4 w-4" /> Faturamento bruto</p>
              <p className="text-2xl font-semibold mt-1">{brl(reportData.faturamento)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Package className="h-4 w-4" /> Total de custos</p>
              <p className="text-2xl font-semibold mt-1">{brl(reportData.custos)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Calendar className="h-4 w-4" /> Contas fixas pagas</p>
              <p className="text-2xl font-semibold mt-1">{brl(reportData.contasFixas)}</p>
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

          <div className="grid gap-3 md:grid-cols-3">
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Aberturas de caixa</p>
              <p className="text-2xl font-semibold mt-1">{reportData.caixaAberturas}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Fechamentos de caixa</p>
              <p className="text-2xl font-semibold mt-1">{reportData.caixaFechamentos}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Saldo líquido do caixa</p>
              <p className="text-2xl font-semibold mt-1">{brl(reportData.caixaSaldo)}</p>
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

      <Dialog open={contaFixaDialogOpen} onOpenChange={setContaFixaDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">Nova conta fixa</DialogTitle>
            <DialogDescription>
              Cadastre custos recorrentes do estabelecimento como luz, água, internet e motoboy.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Input
                value={contaFixaForm.descricao}
                onChange={(event) => setContaFixaForm((current) => ({ ...current, descricao: event.target.value }))}
                placeholder="Ex: Conta de energia"
              />
            </div>

            <div className="space-y-2">
              <Label>Fornecedor (opcional)</Label>
              <Select
                value={contaFixaForm.fornecedor_id}
                onValueChange={(value) => setContaFixaForm((current) => ({ ...current, fornecedor_id: value }))}
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
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Valor</Label>
                <Input
                  value={contaFixaForm.valor}
                  onChange={(event) => setContaFixaForm((current) => ({ ...current, valor: event.target.value }))}
                  inputMode="decimal"
                  placeholder="Ex: 250,00"
                />
              </div>

              <div className="space-y-2">
                <Label>Vencimento</Label>
                <Input
                  type="date"
                  value={contaFixaForm.data_vencimento}
                  onChange={(event) =>
                    setContaFixaForm((current) => ({
                      ...current,
                      data_vencimento: event.target.value,
                      dia_vencimento: event.target.value ? String(new Date(event.target.value + "T00:00:00").getDate()) : current.dia_vencimento,
                    }))
                  }
                />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Conta recorrente mensal</p>
                  <p className="text-xs text-muted-foreground">Gera automaticamente a conta todo mês.</p>
                </div>
                <Switch
                  checked={contaFixaForm.recorrente_mensal}
                  onCheckedChange={(checked) => setContaFixaForm((current) => ({ ...current, recorrente_mensal: checked }))}
                />
              </div>

              {contaFixaForm.recorrente_mensal && (
                <div className="space-y-2">
                  <Label>Dia de vencimento mensal</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={contaFixaForm.dia_vencimento}
                    onChange={(event) => setContaFixaForm((current) => ({ ...current, dia_vencimento: event.target.value }))}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={contaFixaForm.observacoes}
                onChange={(event) => setContaFixaForm((current) => ({ ...current, observacoes: event.target.value }))}
                placeholder="Detalhes da conta fixa"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setContaFixaDialogOpen(false)} disabled={contaFixaBusy}>
              Cancelar
            </Button>
            <Button onClick={() => void saveContaFixa()} disabled={contaFixaBusy}>
              <Save className="h-4 w-4 mr-1" /> {contaFixaBusy ? "Salvando..." : "Salvar conta fixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={caixaDialogOpen}
        onOpenChange={(open) => {
          setCaixaDialogOpen(open);
          if (!open) setCaixaResumoPreview(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">
              {caixaDialogMode === "abrir" ? "Abrir caixa" : "Fechar caixa"}
            </DialogTitle>
            <DialogDescription>
              {caixaDialogMode === "abrir"
                ? "Informe o valor inicial para começar a sessão do dia."
                : "Confira os valores do sistema abaixo e informe o dinheiro contado no caixa físico."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {caixaDialogMode === "fechar" && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
                <p className="font-semibold">Conferência com o sistema</p>
                {caixaResumoLoading ? (
                  <p className="text-muted-foreground">Calculando vendas do período...</p>
                ) : caixaResumoPreview ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          Mesas ({caixaResumoPreview.vendas_mesas?.quantidade ?? caixaResumoPreview.contas_count})
                        </span>
                        <span className="font-medium">{brl(caixaResumoPreview.vendas_mesas?.total ?? 0)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          Delivery ({caixaResumoPreview.vendas_delivery?.quantidade ?? 0})
                        </span>
                        <span className="font-medium">{brl(caixaResumoPreview.vendas_delivery?.total ?? 0)}</span>
                      </div>
                    </div>
                    <div className="flex justify-between gap-2 border-t pt-2 font-medium">
                      <span>Total vendas (sistema)</span>
                      <span>{brl(caixaResumoPreview.total_vendas)}</span>
                    </div>
                    {caixaResumoPreview.pagamentos.length > 0 && (
                      <div className="space-y-1 border-t pt-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Por forma de pagamento</p>
                        {caixaResumoPreview.pagamentos.map((p) => (
                          <div key={p.forma} className="flex justify-between gap-2">
                            <span>{p.forma}</span>
                            <span>{brl(p.valor)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="space-y-1 border-t pt-2">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Valor inicial</span>
                        <span>{brl(caixaResumoPreview.caixa.valor_inicial)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Retiradas</span>
                        <span>- {brl(caixaResumoPreview.movimentacoes.retirada)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Suprimentos</span>
                        <span>+ {brl(caixaResumoPreview.movimentacoes.suprimento)}</span>
                      </div>
                    </div>
                    <div className="flex justify-between gap-2 rounded-md bg-primary/10 px-3 py-2 font-semibold text-primary">
                      <span>Dinheiro esperado no caixa</span>
                      <span>{brl(caixaResumoPreview.dinheiro_esperado ?? 0)}</span>
                    </div>
                    {diferencaCaixaPreview != null && (
                      <div
                        className={`flex justify-between gap-2 rounded-md px-3 py-2 font-semibold ${
                          diferencaCaixaPreview === 0
                            ? "bg-emerald-500/15 text-emerald-800"
                            : diferencaCaixaPreview > 0
                              ? "bg-amber-500/15 text-amber-900"
                              : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        <span>
                          {diferencaCaixaPreview === 0
                            ? "Conferido"
                            : diferencaCaixaPreview > 0
                              ? "Sobra no caixa"
                              : "Falta no caixa"}
                        </span>
                        <span>{brl(diferencaCaixaPreview)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">Não foi possível carregar o resumo do período.</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>{caixaDialogMode === "abrir" ? "Valor inicial" : "Valor contado no caixa (dinheiro)"}</Label>
              <Input
                value={caixaForm.valor}
                onChange={(event) => setCaixaForm((current) => ({ ...current, valor: event.target.value }))}
                placeholder={caixaDialogMode === "abrir" ? "Ex: 100,00" : "Ex: 1432,80"}
                inputMode="decimal"
              />
              {caixaDialogMode === "fechar" && (
                <p className="text-xs text-muted-foreground">
                  Informe o total de dinheiro físico (notas e moedas) para comparar com o esperado acima.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={caixaForm.observacoes}
                onChange={(event) => setCaixaForm((current) => ({ ...current, observacoes: event.target.value }))}
                placeholder="Anotações da abertura ou fechamento"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCaixaDialogOpen(false)} disabled={caixaBusy}>
              Cancelar
            </Button>
            <Button onClick={() => void saveCaixa()} disabled={caixaBusy}>
              <Save className="h-4 w-4 mr-1" /> {caixaBusy ? "Salvando..." : caixaDialogMode === "abrir" ? "Abrir caixa" : "Fechar caixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={retiradaDialogOpen} onOpenChange={setRetiradaDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">
              {retiradaDialogMode === "retirada" ? "Registrar retirada" : "Registrar suprimento"}
            </DialogTitle>
            <DialogDescription>
              {retiradaDialogMode === "retirada"
                ? "Registre saídas do caixa para pagamentos como motoboy, troco ou despesas rápidas."
                : "Registre entradas de suprimento quando colocar dinheiro no caixa para troco ou emergências."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{retiradaDialogMode === "retirada" ? "Valor retirado" : "Valor do suprimento"}</Label>
              <Input
                value={retiradaForm.valor}
                onChange={(event) => setRetiradaForm((current) => ({ ...current, valor: event.target.value }))}
                placeholder="Ex: 80,00"
                inputMode="decimal"
              />
            </div>

            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={retiradaForm.descricao}
                onChange={(event) => setRetiradaForm((current) => ({ ...current, descricao: event.target.value }))}
                placeholder={retiradaDialogMode === "retirada" ? "Ex: pagamento motoboy do dia" : "Ex: coloquei dinheiro para troco"}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRetiradaDialogOpen(false)} disabled={retiradaBusy}>
              Cancelar
            </Button>
            <Button onClick={() => void saveRetiradaCaixa()} disabled={retiradaBusy}>
              <Save className="h-4 w-4 mr-1" /> {retiradaBusy ? "Salvando..." : retiradaDialogMode === "retirada" ? "Salvar retirada" : "Salvar suprimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
