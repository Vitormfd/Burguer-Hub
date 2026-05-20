import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  Clock,
  Store,
  Bike,
  UtensilsCrossed,
  Search,
  Flame,
  Target,
  CreditCard,
  Gift,
  Trophy,
  Sparkles,
} from "lucide-react";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "@/lib/utils";
import type { BairroTaxa, Categoria, Cliente, Configuracao, Cupom, HorarioFuncionamentoDia, Produto, Recompensa, TipoEntrega } from "@/types/db";
import ProdutoCascadeDialog from "@/components/cardapio/ProdutoCascadeDialog";
import type { CartItem } from "@/components/cardapio/cartTypes";
import {
  calculateRewardBenefit,
  type FidelidadeLookupResult,
  isRewardAvailable,
  nextReward,
  normalizePhone,
  rewardProgress,
} from "@/lib/fidelidade";
import { sendWhatsapp } from "@/lib/whatsapp";

type Forma = "dinheiro" | "pix" | "cartao";

type CouponValidationPayload = {
  codigo: string;
  telefone: string | null;
  subtotal: number;
  taxa_entrega: number;
  tipo_entrega: TipoEntrega;
  commit: boolean;
  pedido_id?: string;
  cliente_id?: string | null;
};

interface CupomAplicado {
  id: string;
  codigo: string;
  tipo: Cupom["tipo"];
  valor: number | null;
  valor_minimo_pedido: number;
  valor_desconto_aplicado: number;
  taxa_entrega_zerada: boolean;
}

const checkoutSchema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome").max(100),
  telefone: z.string().trim().max(20).refine((value) => {
    const normalized = normalizePhone(value);
    return normalized.length === 0 || normalized.length >= 10;
  }, "Telefone invalido"),
  endereco: z.string().trim().max(200),
  numero: z.string().trim().max(20),
  complemento: z.string().trim().max(80).optional().or(z.literal("")),
  bairro_id: z.string(),
  forma: z.enum(["dinheiro", "pix", "cartao"]),
  troco: z.string().optional(),
});

const DIAS_SEMANA_LABEL = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

const normalizeTimeHHMM = (value?: string | null) => {
  if (!value) return "00:00";
  return value.slice(0, 5);
};

const toMinutes = (hhmm: string) => {
  const [h, m] = normalizeTimeHHMM(hhmm).split(":").map(Number);
  return h * 60 + m;
};

const getWeeklySchedule = (cfg: Configuracao): HorarioFuncionamentoDia[] => {
  const fallbackAbertura = normalizeTimeHHMM(cfg.hora_abertura);
  const fallbackFechamento = normalizeTimeHHMM(cfg.hora_fechamento);
  const byDay = new Map<number, HorarioFuncionamentoDia>();

  if (Array.isArray(cfg.horario_funcionamento)) {
    for (const raw of cfg.horario_funcionamento) {
      if (!raw || typeof raw !== "object") continue;
      const dia = Number((raw as { dia?: unknown }).dia);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6) continue;
      byDay.set(dia, {
        dia,
        ativo: Boolean((raw as { ativo?: unknown }).ativo),
        abertura: normalizeTimeHHMM((raw as { abertura?: string }).abertura) || fallbackAbertura,
        fechamento: normalizeTimeHHMM((raw as { fechamento?: string }).fechamento) || fallbackFechamento,
      });
    }
  }

  return [0, 1, 2, 3, 4, 5, 6].map((dia) => {
    return byDay.get(dia) ?? {
      dia,
      ativo: true,
      abertura: fallbackAbertura,
      fechamento: fallbackFechamento,
    };
  });
};

const getTodaySchedule = (cfg: Configuracao, date = new Date()) => {
  const dia = date.getDay();
  return getWeeklySchedule(cfg).find((item) => item.dia === dia) ?? null;
};

const formatScheduleRange = (item: HorarioFuncionamentoDia | null, cfg: Configuracao) => {
  if (!item) {
    return `${normalizeTimeHHMM(cfg.hora_abertura)} - ${normalizeTimeHHMM(cfg.hora_fechamento)}`;
  }
  if (!item.ativo) return "Fechado";
  return `${normalizeTimeHHMM(item.abertura)} - ${normalizeTimeHHMM(item.fechamento)}`;
};

const isOpenNow = (cfg: Configuracao) => {
  const today = getTodaySchedule(cfg);
  if (!today || !today.ativo) return false;

  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const ini = toMinutes(today.abertura);
  const fim = toMinutes(today.fechamento);
  return fim > ini ? cur >= ini && cur <= fim : cur >= ini || cur <= fim;
};

const precoEfetivo = (p: Produto) =>
  p.promocao && p.preco_promocional != null ? Number(p.preco_promocional) : Number(p.preco);

const normalizeHexColor = (value?: string | null) => {
  if (!value) return "#16a34a";
  const normalized = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : "#16a34a";
};

const hexToRgb = (hex: string) => {
  const normalized = normalizeHexColor(hex).replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const withAlpha = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const encodeKdsItemObservation = (produtoNome: string, observacao?: string | null) => {
  const safeName = produtoNome.replace(/\]/g, "").trim();
  const safeObs = (observacao || "").trim();
  const marker = `[item:${safeName}]`;
  return safeObs ? `${marker} ${safeObs}` : marker;
};

const CHECKOUT_PROFILE_CACHE_KEY = "burgerhub:checkout-profile:v1";

type CachedCheckoutProfile = {
  nome?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairroId?: string;
  updatedAt: number;
};

const readCheckoutProfileCache = (): Record<string, CachedCheckoutProfile> => {
  try {
    const raw = localStorage.getItem(CHECKOUT_PROFILE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, CachedCheckoutProfile>;
  } catch {
    return {};
  }
};

const writeCheckoutProfileCache = (phone: string, data: Omit<CachedCheckoutProfile, "updatedAt">) => {
  if (!phone) return;
  const current = readCheckoutProfileCache();
  current[phone] = { ...data, updatedAt: Date.now() };
  try {
    localStorage.setItem(CHECKOUT_PROFILE_CACHE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage limits/private mode
  }
};

export default function CardapioPublico() {
  const { referencia } = useParams<{ referencia?: string }>();
  
  const [cfg, setCfg] = useState<Configuracao | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [recompensas, setRecompensas] = useState<Recompensa[]>([]);
  const [bairros, setBairros] = useState<BairroTaxa[]>([]);
  const [topSellers, setTopSellers] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<CartItem[]>([]);

  const [adicionando, setAdicionando] = useState<Produto | null>(null);
  const [activeCat, setActiveCat] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [bannerIndex, setBannerIndex] = useState(0);
  const [showStickyCats, setShowStickyCats] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [endereco, setEndereco] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairroId, setBairroId] = useState("");
  const [forma, setForma] = useState<Forma>("pix");
  const [troco, setTroco] = useState("");
  const [busy, setBusy] = useState(false);
  const [fidelidadeBusy, setFidelidadeBusy] = useState(false);
  const [fidelidadeBusca, setFidelidadeBusca] = useState<FidelidadeLookupResult | null>(null);
  const [telefoneBuscado, setTelefoneBuscado] = useState("");
  const [selectedRewardId, setSelectedRewardId] = useState<string | null>(null);
  const [sucessoNumero, setSucessoNumero] = useState<string | null>(null);
  const [cupomCodigo, setCupomCodigo] = useState("");
  const [cupomBusy, setCupomBusy] = useState(false);
  const [cupomAplicado, setCupomAplicado] = useState<CupomAplicado | null>(null);
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntrega>("delivery");
  const [sucessoTipoEntrega, setSucessoTipoEntrega] = useState<TipoEntrega>("delivery");
  const [sucessoTempoRetirada, setSucessoTempoRetirada] = useState<number>(25);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const produtosInicioRef = useRef<HTMLElement | null>(null);
  const [fidelidadeDialogOpen, setFidelidadeDialogOpen] = useState(false);
  const celebradosRef = useRef<Set<string>>(new Set());
  const hydratedPhoneRef = useRef<string>("");

  useEffect(() => {
    (async () => {
      let cfgQuery = supabase.from("configuracoes").select("*");
      
      if (referencia) {
        cfgQuery = cfgQuery.eq("referencia", referencia);
      }
      
      const [{ data: c }, { data: cat }, { data: prod }, { data: rewards }, { data: b }, { data: itens }] = await Promise.all([
        cfgQuery.maybeSingle(),
        supabase.from("categorias").select("*").eq("ativo", true).order("ordem").order("nome"),
        supabase.from("produtos").select("*").eq("disponivel", true).order("ordem").order("nome"),
        supabase.from("recompensas").select("*").eq("ativo", true).order("ordem").order("pedidos_necessarios"),
        supabase.from("bairros_taxas").select("*").eq("ativo", true).order("nome"),
        supabase.from("pedido_itens").select("produto_id, quantidade").limit(1000),
      ]);

      if (c) setCfg(c as unknown as Configuracao);
      const cs = (cat || []) as Categoria[];
      setCategorias(cs);
      setProdutos((prod || []) as Produto[]);
      setRecompensas((rewards || []) as Recompensa[]);
      setBairros((b || []) as BairroTaxa[]);
      if (cs[0]) setActiveCat(cs[0].id);

      const counts = new Map<string, number>();
      (itens || []).forEach((i: any) => {
        if (!i.produto_id) return;
        counts.set(i.produto_id, (counts.get(i.produto_id) || 0) + (i.quantidade || 0));
      });
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id]) => id);
      setTopSellers(new Set(top));
    })();
  }, [referencia]);

  useEffect(() => {
    if (!cfg) return;
    document.title = cfg.seo_titulo || cfg.nome_loja;
    let m = document.querySelector('meta[name="description"]');
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute("name", "description");
      document.head.appendChild(m);
    }
    m.setAttribute("content", cfg.seo_descricao || "");
  }, [cfg]);

  const corStyle = useMemo(() => {
    if (!cfg) return {};
    return {
      ["--brand" as any]: cfg.cor_primaria,
    };
  }, [cfg]);

  const fidelidadeCor = useMemo(() => normalizeHexColor(cfg?.fidelidade_cor), [cfg?.fidelidade_cor]);
  const fidelidadePedidoMinimo = useMemo(() => {
    const parsed = Number(cfg?.fidelidade_pedido_minimo ?? 0);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
  }, [cfg?.fidelidade_pedido_minimo]);

  const subtotal = cart.reduce((s, i) => s + i.precoUnit * i.quantidade, 0);
  const totalItens = cart.reduce((s, i) => s + i.quantidade, 0);
  const taxa = bairros.find((b) => b.id === bairroId)?.taxa ?? 0;
  // Exibe retirada quando: a coluna não existe ainda no banco (undefined) OU está explicitamente ativa
  const retiradaAtiva = cfg?.retirada_ativa !== false;
  const tempoEstimadoRetirada = Math.max(Number(cfg?.tempo_estimado_retirada ?? 25), 1);

  const promocoes = useMemo(() => produtos.filter((p) => p.promocao), [produtos]);
  const recompensasOrdenadas = useMemo(
    () => [...recompensas].sort((left, right) => left.ordem - right.ordem || left.pedidos_necessarios - right.pedidos_necessarios),
    [recompensas]
  );
  const produtosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return produtos;
    return produtos.filter((p) => p.nome.toLowerCase().includes(q) || (p.descricao || "").toLowerCase().includes(q));
  }, [produtos, busca]);

  const maisPedidos = useMemo(() => {
    const top = produtos.filter((p) => topSellers.has(p.id));
    return top.length ? top : promocoes.slice(0, 6);
  }, [produtos, topSellers, promocoes]);

  const bannerSlides = useMemo(() => {
    const configuradas = (cfg?.carrossel_imagens || []).filter((v) => !!v);
    if (configuradas.length > 0) return configuradas;

    const imagens = [
      cfg?.banner_url || null,
      ...promocoes.map((p) => p.imagem_url).filter(Boolean),
      ...maisPedidos.map((p) => p.imagem_url).filter(Boolean),
    ].filter((v): v is string => !!v);

    const unicas = Array.from(new Set(imagens));
    return unicas.slice(0, 6);
  }, [cfg?.banner_url, promocoes, maisPedidos]);

  const categoriaById = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const fidelidadeCliente = fidelidadeBusca?.cliente ?? null;
  const selectedReward = useMemo(
    () => recompensasOrdenadas.find((reward) => reward.id === selectedRewardId) ?? null,
    [recompensasOrdenadas, selectedRewardId]
  );
  const rewardBenefit = useMemo(
    () => selectedReward ? calculateRewardBenefit(selectedReward, subtotal, produtos) : { desconto: 0, itemGratis: null, descricao: "" },
    [selectedReward, subtotal, produtos]
  );
  const descontoCupom = cupomAplicado?.valor_desconto_aplicado ?? 0;
  const taxaBase = tipoEntrega === "retirada" ? 0 : Number(taxa);
  const taxaEfetiva = tipoEntrega === "retirada" ? 0 : (cupomAplicado?.taxa_entrega_zerada ? 0 : Number(taxa));
  const total = Math.max(subtotal + taxaEfetiva - rewardBenefit.desconto - descontoCupom, subtotal > 0 ? 0.01 : 0);
  const recompensasDisponiveis = useMemo(() => {
    if (!fidelidadeCliente) return [] as Recompensa[];
    return recompensasOrdenadas.filter((reward) => isRewardAvailable(reward, fidelidadeCliente.total_pedidos));
  }, [fidelidadeCliente, recompensasOrdenadas]);
  const proximaRecompensa = useMemo(() => {
    if (!fidelidadeCliente) return recompensasOrdenadas[0] ?? null;
    return nextReward(recompensasOrdenadas, fidelidadeCliente.total_pedidos);
  }, [fidelidadeCliente, recompensasOrdenadas]);

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const isHamburger = (produto: Produto | null) => {
    if (!produto) return false;
    const categoria = produto.categoria_id ? categoriaById.get(produto.categoria_id) : null;
    const categoriaNome = normalize(categoria?.nome || "");
    const produtoNome = normalize(produto.nome || "");
    return (
      categoriaNome.includes("lanche") ||
      categoriaNome.includes("hamburg") ||
      categoriaNome.includes("burger") ||
      produtoNome.includes("hamburg") ||
      produtoNome.includes("burger")
    );
  };

  const openAdd = (p: Produto) => setAdicionando(p);
  const removeItem = (idx: number) => setCart((prev) => prev.filter((_, i) => i !== idx));
  const updateQty = (idx: number, delta: number) =>
    setCart((prev) => prev.map((it, i) => (i === idx ? { ...it, quantidade: Math.max(1, it.quantidade + delta) } : it)));

  useEffect(() => {
    const currentPhone = normalizePhone(tel);
    if (!telefoneBuscado || currentPhone === telefoneBuscado) return;
    setFidelidadeBusca(null);
    setTelefoneBuscado("");
    setSelectedRewardId(null);
  }, [tel, telefoneBuscado]);

  useEffect(() => {
    if (!selectedReward || !fidelidadeCliente) return;
    if (!isRewardAvailable(selectedReward, fidelidadeCliente.total_pedidos)) {
      setSelectedRewardId(null);
    }
  }, [selectedReward, fidelidadeCliente]);

  useEffect(() => {
    if (!cupomAplicado) return;
    setCupomAplicado(null);
    setCupomCodigo("");
  }, [subtotal, bairroId, tel, tipoEntrega]);

  useEffect(() => {
    const phone = normalizePhone(tel);
    if (phone.length < 10 || hydratedPhoneRef.current === phone) return;

    hydratedPhoneRef.current = phone;

    const cached = readCheckoutProfileCache()[phone];
    if (cached) {
      if (!nome.trim() && cached.nome) setNome(cached.nome);
      if (!endereco.trim() && cached.endereco) setEndereco(cached.endereco);
      if (!numero.trim() && cached.numero) setNumero(cached.numero);
      if (!complemento.trim() && cached.complemento) setComplemento(cached.complemento);
      if (!bairroId && cached.bairroId) setBairroId(cached.bairroId);
    }

    void (async () => {
      const { data } = await (supabase as any)
        .from("entregas")
        .select("cliente_nome, endereco, numero, complemento, bairro")
        .eq("cliente_telefone", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return;

      if (!nome.trim() && data.cliente_nome) {
        setNome(String(data.cliente_nome));
      }
      if (!endereco.trim() && data.endereco && String(data.endereco).toLowerCase() !== "retirada no balcao") {
        setEndereco(String(data.endereco));
      }
      if (!numero.trim() && data.numero) {
        setNumero(String(data.numero));
      }
      if (!complemento.trim() && data.complemento) {
        setComplemento(String(data.complemento));
      }
      if (!bairroId && data.bairro) {
        const normalizedBairro = String(data.bairro).trim().toLowerCase();
        const bairro = bairros.find((item) => item.nome.trim().toLowerCase() === normalizedBairro);
        if (bairro?.id) setBairroId(bairro.id);
      }
    })();
  }, [tel, bairros, nome, endereco, numero, complemento, bairroId]);

  useEffect(() => {
    if (cfg?.retirada_ativa === false && tipoEntrega === "retirada") {
      setTipoEntrega("delivery");
    }
  }, [cfg?.retirada_ativa, tipoEntrega]);

  const validarCupom = async (payload: CouponValidationPayload) => {
    const edgeResult = await supabase.functions.invoke("cupons-validar", {
      body: payload,
    });

    if (edgeResult.data && !edgeResult.error) {
      return edgeResult.data as {
        cupom: { id: string; codigo: string; tipo: Cupom["tipo"]; valor: number | null; valor_minimo_pedido: number };
        valor_desconto_aplicado: number;
        taxa_entrega_zerada: boolean;
      };
    }

    const backendMessage =
      (edgeResult.data && typeof edgeResult.data === "object" && "error" in edgeResult.data
        ? String((edgeResult.data as { error?: unknown }).error || "")
        : "").trim();
    const errorMessage = edgeResult.error?.message || "";
    const functionUnavailable = /failed to send a request|failed to fetch|fetch failed|non-2xx/i.test(errorMessage);

    if (backendMessage && !functionUnavailable) {
      throw new Error(backendMessage);
    }

    if (!functionUnavailable) {
      throw new Error(backendMessage || errorMessage || "Cupom inválido ou inexistente");
    }

    const { data: rpcData, error: rpcError } = await (supabase as any).rpc("aplicar_cupom_checkout", {
      p_codigo: payload.codigo,
      p_telefone_cliente: payload.telefone,
      p_subtotal: payload.subtotal,
      p_taxa_entrega: payload.taxa_entrega,
      p_commit: payload.commit,
      p_pedido_id: payload.pedido_id ?? null,
      p_cliente_id: payload.cliente_id ?? null,
    });
    if (rpcError) {
      const rpcBackendMessage = rpcError.message || "";
      throw new Error(rpcBackendMessage || "Cupom inválido ou inexistente");
    }

    return rpcData as unknown as {
      cupom: { id: string; codigo: string; tipo: Cupom["tipo"]; valor: number | null; valor_minimo_pedido: number };
      valor_desconto_aplicado: number;
      taxa_entrega_zerada: boolean;
    };
  };

  const applyCoupon = async () => {
    const codigo = cupomCodigo.trim().toUpperCase();

    if (!codigo) {
      return toast.error("Informe o código do cupom");
    }

    setCupomBusy(true);
    let payload: Awaited<ReturnType<typeof validarCupom>>;

    try {
      payload = await validarCupom({
        codigo,
        telefone: normalizePhone(tel) || null,
        subtotal,
        taxa_entrega: taxaBase,
        tipo_entrega: tipoEntrega,
        commit: false,
      });
    } catch (error) {
      setCupomBusy(false);
      return toast.error(error instanceof Error ? error.message : "Erro ao validar cupom");
    }

    setCupomBusy(false);

    if (!payload?.cupom) {
      return toast.error("Cupom inválido ou inexistente");
    }

    setCupomAplicado({
      id: payload.cupom.id,
      codigo: payload.cupom.codigo,
      tipo: payload.cupom.tipo,
      valor: payload.cupom.valor,
      valor_minimo_pedido: payload.cupom.valor_minimo_pedido,
      valor_desconto_aplicado: Number(payload.valor_desconto_aplicado || 0),
      taxa_entrega_zerada: !!payload.taxa_entrega_zerada,
    });
    setCupomCodigo(payload.cupom.codigo);
    toast.success(`Cupom aplicado ✅ ${payload.cupom.codigo}`);
  };

  const removeCoupon = () => {
    setCupomAplicado(null);
    setCupomCodigo("");
    toast.message("Cupom removido");
  };

  const buscarClienteFidelidade = async () => {
    const telefoneNormalizado = normalizePhone(tel);
    if (telefoneNormalizado.length < 10) {
      return toast.error("Informe um telefone valido para consultar suas recompensas");
    }

    setFidelidadeBusy(true);
    const { data, error } = await supabase.rpc("get_cliente_fidelidade", {
      p_telefone: telefoneNormalizado,
    });
    setFidelidadeBusy(false);

    if (error) {
      return toast.error(error.message);
    }

    const payload = (data || { cliente: null, resgates_pendentes: [] }) as unknown as FidelidadeLookupResult;
    setTelefoneBuscado(telefoneNormalizado);
    setFidelidadeBusca(payload);
    setSelectedRewardId(null);

    if (payload.cliente) {
      setNome((current) => current.trim() || payload.cliente?.nome || "");
      const temDireito = recompensasOrdenadas.some((reward) => isRewardAvailable(reward, payload.cliente!.total_pedidos));
      if (temDireito && !celebradosRef.current.has(telefoneNormalizado)) {
        celebradosRef.current.add(telefoneNormalizado);
        void confetti({
          particleCount: 140,
          spread: 80,
          origin: { y: 0.65 },
          colors: ["#f59e0b", "#fbbf24", "#fde68a", "#f97316"],
        });
      }
      return toast.success(`Ola, ${payload.cliente.nome}! Programa de fidelidade carregado.`);
    }

    toast.message("Telefone ainda nao cadastrado", {
      description: "Finalize o pedido para criar seu cadastro automaticamente.",
    });
  };

  const openFidelidadeDialog = () => {
    setFidelidadeDialogOpen(true);
  };

  const renderFidelidadeBox = (compact = false) => {
    if (!cfg?.fidelidade_ativa) return null;

    const telefoneIdentificado = telefoneBuscado.length >= 10;
    const mostrarCatalogoRecompensas = !!fidelidadeCliente || telefoneIdentificado;

    const titulo = fidelidadeCliente
      ? `Ola, ${fidelidadeCliente.nome}! Voce tem ${fidelidadeCliente.total_pedidos} pedidos e ${recompensasDisponiveis.length} recompensa(s) disponivel(is).`
      : "Informe seu telefone para ver quantos pedidos ja acumulou e quais recompensas estao liberadas.";

    return (
      <section
        className={cn(
          "relative overflow-hidden rounded-[30px] border shadow-[0_24px_46px_-34px_rgba(6,95,70,0.45)]",
          compact ? "p-4" : "p-5 sm:p-6"
        )}
        style={{
          borderColor: withAlpha(fidelidadeCor, 0.45),
          backgroundImage: `linear-gradient(135deg, ${withAlpha(fidelidadeCor, 0.12)}, ${withAlpha(fidelidadeCor, 0.2)})`,
        }}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/35 blur-2xl" />
          <div className="absolute -left-12 bottom-0 h-36 w-36 rounded-full blur-xl" style={{ background: withAlpha(fidelidadeCor, 0.3) }} />
        </div>

        <div className="relative z-10 flex flex-col gap-4">
          <div
            className="rounded-3xl border bg-white/55 p-4 backdrop-blur-sm sm:p-5"
            style={{ borderColor: withAlpha(fidelidadeCor, 0.38) }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]"
                  style={{
                    background: withAlpha(fidelidadeCor, 0.2),
                    color: withAlpha(fidelidadeCor, 0.95),
                  }}
                >
                  <Trophy className="h-3.5 w-3.5" /> Fidelidade Burger Hub
                </div>
                <h3 className={cn("font-bold tracking-tight text-zinc-900", compact ? "text-xl" : "text-3xl")}>Suas recompensas 🎁</h3>
                <p className="max-w-2xl text-sm" style={{ color: withAlpha(fidelidadeCor, 0.9) }}>{cfg.fidelidade_texto || "A cada 10 pedidos, ganhe uma recompensa!"}</p>
                {fidelidadePedidoMinimo > 0 && (
                  <p className="max-w-2xl text-xs text-zinc-700">
                    Contam na fidelidade apenas pedidos a partir de {brl(fidelidadePedidoMinimo)}.
                  </p>
                )}
              </div>
              {proximaRecompensa && fidelidadeCliente && (
                <div className="min-w-[230px] rounded-2xl border bg-zinc-950 px-4 py-3 text-white" style={{ borderColor: withAlpha(fidelidadeCor, 0.42) }}>
                  <div className="text-[11px] uppercase tracking-[0.22em]" style={{ color: withAlpha(fidelidadeCor, 0.75) }}>Proxima meta</div>
                  <div className="mt-1 font-semibold">{proximaRecompensa.nome}</div>
                  <div className="mt-2 text-xs text-zinc-300">
                    Faltam {rewardProgress(proximaRecompensa, fidelidadeCliente.total_pedidos).faltam} pedido(s)
                  </div>
                  <Progress
                    value={rewardProgress(proximaRecompensa, fidelidadeCliente.total_pedidos).percentual}
                    className="mt-2 h-2.5 bg-zinc-800"
                  />
                </div>
              )}
            </div>
          </div>

          <div className={cn("grid gap-3", compact ? "md:grid-cols-[1fr_auto]" : "md:grid-cols-[1fr_auto] md:items-end")}>
            <div className="space-y-2">
              <Label>Seu telefone</Label>
              <Input
                value={tel}
                onChange={(event) => setTel(event.target.value)}
                maxLength={20}
                placeholder="(11) 99999-9999"
                className="bg-white/90"
                style={{ borderColor: withAlpha(fidelidadeCor, 0.45) }}
              />
            </div>
            <Button type="button" onClick={buscarClienteFidelidade} disabled={fidelidadeBusy} className="text-white shadow-md">
              {fidelidadeBusy ? "Buscando..." : "Buscar"}
            </Button>
          </div>

          <div className="rounded-2xl border bg-white/85 p-4 text-sm text-zinc-700" style={{ borderColor: withAlpha(fidelidadeCor, 0.28) }}>
            {titulo}
          </div>

          {!fidelidadeCliente && normalizePhone(tel).length >= 10 && telefoneBuscado === normalizePhone(tel) && (
            <div className="space-y-2 rounded-2xl border border-dashed bg-white/70 p-4" style={{ borderColor: withAlpha(fidelidadeCor, 0.45) }}>
              <Label>Seu nome para cadastro automatico</Label>
              <Input
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                maxLength={100}
                placeholder="Como devemos te chamar?"
                className="bg-white"
                style={{ borderColor: withAlpha(fidelidadeCor, 0.45) }}
              />
              <p className="text-xs text-zinc-500">Se este telefone ainda nao existir, o cadastro sera criado ao confirmar o pedido.</p>
            </div>
          )}

          {!mostrarCatalogoRecompensas ? (
            <div
              className="loyalty-shimmer rounded-3xl border bg-white/50 p-5 text-sm"
              style={{ borderColor: withAlpha(fidelidadeCor, 0.45), color: withAlpha(fidelidadeCor, 0.9) }}
            >
              Digite seu telefone e toque em Buscar para desbloquear suas metas e recompensas.
            </div>
          ) : (
            <div className={cn("grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-2") }>
              {recompensasOrdenadas.map((reward) => {
                const disponivel = fidelidadeCliente ? isRewardAvailable(reward, fidelidadeCliente.total_pedidos) : false;
                const progresso = rewardProgress(reward, fidelidadeCliente?.total_pedidos ?? 0);
                const selecionado = selectedRewardId === reward.id;

                return (
                  <button
                    key={reward.id}
                    type="button"
                    disabled={!disponivel}
                    onClick={() => setSelectedRewardId((current) => current === reward.id ? null : reward.id)}
                    className={cn(
                      "rounded-3xl border p-4 text-left transition-all duration-300",
                      disponivel
                        ? selecionado
                          ? "bg-white shadow-xl ring-2"
                          : "bg-white/90 hover:-translate-y-0.5 hover:shadow-md"
                        : "bg-white/60"
                    )}
                    style={{
                      borderColor: disponivel
                        ? selecionado
                          ? withAlpha(fidelidadeCor, 0.65)
                          : withAlpha(fidelidadeCor, 0.3)
                        : withAlpha(fidelidadeCor, 0.2),
                      boxShadow: selecionado ? `0 0 0 1px ${withAlpha(fidelidadeCor, 0.35)}` : undefined,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl"
                            style={{ background: withAlpha(fidelidadeCor, 0.16), color: withAlpha(fidelidadeCor, 0.9) }}
                          >
                            <Gift className="h-4 w-4" />
                          </span>
                          <div>
                            <div className="font-semibold text-zinc-900">{reward.nome}</div>
                            <div className="text-xs text-zinc-500">{reward.descricao || "Beneficio disponivel no seu proximo pedido"}</div>
                          </div>
                        </div>
                      </div>
                      <Badge
                        className={cn(disponivel ? "bg-zinc-100" : "bg-zinc-100 text-zinc-700") }
                        style={disponivel ? { background: withAlpha(fidelidadeCor, 0.15), color: withAlpha(fidelidadeCor, 0.95) } : undefined}
                      >
                        {disponivel ? "Disponivel ✅" : `${progresso.atual} de ${reward.pedidos_necessarios}`}
                      </Badge>
                    </div>

                    {!disponivel && (
                      <div className="mt-4 space-y-2">
                        <Progress value={progresso.percentual} className="h-2.5" style={{ background: withAlpha(fidelidadeCor, 0.15) }} />
                        <p className="text-xs text-zinc-600">{progresso.atual} de {reward.pedidos_necessarios} pedidos — faltam {progresso.faltam}!</p>
                      </div>
                    )}

                    {disponivel && (
                      <p className="mt-4 text-xs text-zinc-600">Selecione para aplicar neste pedido. Apenas uma recompensa pode ser usada por vez.</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {selectedReward && (
            <div className="rounded-3xl border bg-zinc-950 px-4 py-4 text-white shadow-xl" style={{ borderColor: withAlpha(fidelidadeCor, 0.62) }}>
              <div className="flex items-center gap-2 text-sm uppercase tracking-[0.2em]" style={{ color: withAlpha(fidelidadeCor, 0.75) }}>
                <Sparkles className="h-4 w-4" /> Recompensa selecionada
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{selectedReward.nome}</div>
                  <div className="text-sm text-zinc-300">{rewardBenefit.descricao}</div>
                </div>
                {rewardBenefit.desconto > 0 && (
                  <Badge style={{ background: withAlpha(fidelidadeCor, 0.16), color: withAlpha(fidelidadeCor, 0.95) }}>-{brl(rewardBenefit.desconto)} no total</Badge>
                )}
                {rewardBenefit.itemGratis && (
                  <Badge style={{ background: withAlpha(fidelidadeCor, 0.16), color: withAlpha(fidelidadeCor, 0.95) }}>Item gratis: {rewardBenefit.itemGratis.nome}</Badge>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    );
  };

  const scrollToCat = (id: string) => {
    setActiveCat(id);
    const el = sectionRefs.current[id];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 130;
    window.scrollTo({ top, behavior: "smooth" });
  };

  useEffect(() => {
    if (bannerSlides.length <= 1) return;

    const timer = window.setInterval(() => {
      setBannerIndex((prev) => (prev + 1) % bannerSlides.length);
    }, 3500);

    return () => window.clearInterval(timer);
  }, [bannerSlides.length]);

  useEffect(() => {
    if (bannerSlides.length === 0) {
      setBannerIndex(0);
      return;
    }

    if (bannerIndex >= bannerSlides.length) {
      setBannerIndex(0);
    }
  }, [bannerIndex, bannerSlides.length]);

  useEffect(() => {
    const onScroll = () => {
      const target = produtosInicioRef.current;
      if (!target) return;
      const trigger = target.offsetTop - 120;
      setShowStickyCats(window.scrollY >= trigger);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const fazerPedido = async () => {
    const parsed = checkoutSchema.safeParse({
      nome,
      telefone: tel,
      endereco,
      numero,
      complemento,
      bairro_id: bairroId,
      forma,
      troco,
    });
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    if (!cart.length) return toast.error("Carrinho vazio");

    if (tipoEntrega === "retirada" && cfg?.retirada_ativa === false) {
      return toast.error("A retirada no balcão está desativada no momento");
    }

    if (!nome.trim()) return toast.error("Informe seu nome");
    if (normalizePhone(tel).length < 10) return toast.error("Informe um telefone valido");

    if (tipoEntrega === "delivery") {
      if (!endereco.trim() || endereco.trim().length < 3) return toast.error("Informe o endereco");
      if (!numero.trim()) return toast.error("Numero");
      if (!bairroId) return toast.error("Selecione o bairro");
    }

    if (selectedReward && !fidelidadeCliente) {
      return toast.error("Busque seu telefone para aplicar uma recompensa");
    }

    const bairro = tipoEntrega === "delivery"
      ? bairros.find((b) => b.id === bairroId)
      : null;
    if (tipoEntrega === "delivery" && !bairro) return toast.error("Selecione o bairro");

    const telefoneNormalizado = normalizePhone(tel);
    const descontoFidelidade = rewardBenefit.desconto;
    const itemGratis = rewardBenefit.itemGratis;
    const descontoCupomAplicado = cupomAplicado?.valor_desconto_aplicado ?? 0;
    const taxaEntregaFinal = tipoEntrega === "retirada" ? 0 : (cupomAplicado?.taxa_entrega_zerada ? 0 : Number(bairro?.taxa || 0));
    const totalFinal = Math.max(subtotal + taxaEntregaFinal - descontoFidelidade - descontoCupomAplicado, subtotal > 0 ? 0.01 : 0);
    const trocoVal = forma === "dinheiro" && troco ? Number(troco.replace(",", ".")) : null;
    const ownerId = (cfg as Configuracao & { owner_id?: string | null }).owner_id;

    if (!ownerId) {
      return toast.error("Erro ao identificar a loja. Recarregue a pagina e tente novamente.");
    }

    const itensPayload = cart.map((item) => ({
      // Compatibilidade com versões antigas/novas da RPC
      produto_id: item.produto.id,
      produtoId: item.produto.id,
      quantidade: item.quantidade,
      preco_unitario: item.precoUnit,
      precoUnitario: item.precoUnit,
      observacao: encodeKdsItemObservation(item.produto.nome, item.observacao),
      adicionais: item.adicionais.map((adicional) => ({
        adicional_id: adicional.adicionalId,
        adicionalId: adicional.adicionalId,
        quantidade: adicional.quantidade,
        preco_unitario: adicional.precoUnitario,
        precoUnitario: adicional.precoUnitario,
      })),
    }));

    if (itemGratis) {
      itensPayload.push({
        produto_id: itemGratis.id,
        produtoId: itemGratis.id,
        quantidade: 1,
        preco_unitario: 0,
        precoUnitario: 0,
        observacao: encodeKdsItemObservation(
          itemGratis.nome,
          `Recompensa fidelidade: ${selectedReward?.nome || itemGratis.nome}`
        ),
        adicionais: [],
      });
    }

    setBusy(true);

    const { data: rpcResult, error: rpcError } = await (supabase as any).rpc("create_public_delivery_order", {
      p_owner_id: ownerId,
      p_tipo_entrega: tipoEntrega,
      p_cliente_nome: nome.trim(),
      p_cliente_telefone: tel.trim(),
      p_endereco: tipoEntrega === "delivery" ? endereco : "Retirada no balcao",
      p_numero: tipoEntrega === "delivery" ? numero : null,
      p_complemento: tipoEntrega === "delivery" ? (complemento || null) : null,
      p_bairro: tipoEntrega === "delivery" ? (bairro?.nome || null) : null,
      p_taxa_entrega: taxaEntregaFinal,
      p_forma_pagamento: forma,
      p_troco_para: trocoVal,
      p_subtotal: subtotal,
      p_desconto: descontoFidelidade,
      p_total: totalFinal,
      p_cupom_id: cupomAplicado?.id ?? null,
      p_valor_desconto: descontoCupomAplicado,
      p_cliente_id: fidelidadeCliente?.id ?? null,
      p_selected_reward_id: selectedReward?.id ?? null,
      p_items: itensPayload,
    });

    if (rpcError || !rpcResult?.pedido_id) {
      setBusy(false);
      return toast.error(rpcError?.message || "Erro ao criar pedido");
    }

    const pedidoId = String(rpcResult.pedido_id);

    if (tipoEntrega === "delivery") {
      writeCheckoutProfileCache(telefoneNormalizado, {
        nome: nome.trim(),
        endereco: endereco.trim(),
        numero: numero.trim(),
        complemento: complemento.trim(),
        bairroId,
      });
    }

    if (rpcResult?.cliente_id && tipoEntrega === "delivery") {
      const { error: clienteUpdateError } = await (supabase as any)
        .from("clientes")
        .update({
          nome: nome.trim() || null,
          endereco: endereco.trim() || null,
          numero: numero.trim() || null,
          complemento: complemento.trim() || null,
          bairro: (bairros.find((b) => b.id === bairroId)?.nome || "").trim() || null,
        })
        .eq("id", String(rpcResult.cliente_id));

      if (clienteUpdateError) {
        // O backend da RPC ja persiste esses dados; isso eh apenas fallback.
        console.warn("Falha ao atualizar cache de dados do cliente no frontend:", clienteUpdateError.message);
      }
    }

    setBusy(false);

    // Dispara mensagem WhatsApp de confirmação (fire-and-forget)
    if (tel.trim()) {
      const itensTexto = cart
        .map((i) => `${i.quantidade}x ${i.produto.nome}`)
        .join(", ");
      sendWhatsapp(pedidoId, "confirmado", tel.trim(), {
        nome,
        itens: itensTexto,
        total: brl(subtotal + taxaEntregaFinal - descontoCupomAplicado),
      });
    }

    setSucessoTipoEntrega(tipoEntrega);
    setSucessoTempoRetirada(tempoEstimadoRetirada);
    setSucessoNumero(pedidoId.slice(0, 8).toUpperCase());
    setCart([]);
    setCheckoutOpen(false);
    setNome("");
    setTel("");
    setEndereco("");
    setNumero("");
    setComplemento("");
    setBairroId("");
    setForma("pix");
    setTroco("");
    setTipoEntrega("delivery");
    setSelectedRewardId(null);
    setFidelidadeBusca(null);
    setTelefoneBuscado("");
    setCupomAplicado(null);
    setCupomCodigo("");
  };

  if (!cfg) return <div className="min-h-screen grid place-items-center">Carregando...</div>;

  const aberta = cfg.ativo && isOpenNow(cfg);
  const horarioHoje = getTodaySchedule(cfg);
  const diaHojeNome = DIAS_SEMANA_LABEL[new Date().getDay()];
  const horarioHojeTexto = formatScheduleRange(horarioHoje, cfg);
  const taxaMin = bairros.length ? Math.min(...bairros.map((b) => Number(b.taxa))) : 0;

  return (
    <div className="min-h-screen pb-32 font-cardapio bg-[#f3f3f3] text-zinc-900" style={corStyle as React.CSSProperties}>
      <style>{`
        .font-cardapio,
        .font-cardapio h1,
        .font-cardapio h2,
        .font-cardapio h3,
        .font-cardapio h4,
        .font-cardapio h5,
        .font-cardapio h6,
        .font-cardapio button,
        .font-cardapio input,
        .font-cardapio p,
        .font-cardapio span,
        .font-cardapio div {
          font-family: 'Inter', 'Segoe UI', system-ui, sans-serif !important;
          letter-spacing: 0 !important;
        }
        .brand-text { color: var(--brand); }
        .brand-bg { background: var(--brand); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .paper-bg {
          background-image:
            radial-gradient(circle at 25% 20%, rgba(255,255,255,0.55), transparent 42%),
            radial-gradient(circle at 90% 10%, rgba(255,255,255,0.35), transparent 33%),
            radial-gradient(circle at 10% 90%, rgba(0,0,0,0.03), transparent 35%);
        }
        .loyalty-shimmer {
          background: linear-gradient(120deg, rgba(255,255,255,0.05) 10%, rgba(255,255,255,0.32) 35%, rgba(255,255,255,0.05) 60%);
          background-size: 200% 100%;
          animation: loyaltyShimmer 3.8s linear infinite;
        }
        @keyframes loyaltyShimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
      `}</style>

      <header className="relative paper-bg">
        <div className="relative h-24 sm:h-30 md:h-36 overflow-hidden">
          {cfg.banner_url ? (
            <img src={cfg.banner_url} alt="Banner" className="w-full h-full object-cover object-center" />
          ) : (
            <div className="w-full h-full" style={{ background: `linear-gradient(125deg, ${cfg.cor_primaria}, #00000066)` }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/20 to-black/70" />
        </div>

        <div className="max-w-4xl mx-auto px-3 pb-2 -mt-6 relative z-10">
          <div className="rounded-lg bg-transparent overflow-hidden">
            <div className="p-0 sm:p-0">
              <div className="rounded-lg border border-zinc-200/80 bg-white/92 backdrop-blur px-2.5 py-2 sm:px-3 sm:py-2.5">
              <div className="flex items-start gap-2 sm:gap-2.5">
                <div className="shrink-0">
                  {cfg.logo_url ? (
                    <img src={cfg.logo_url} alt={cfg.nome_loja} className="w-12 h-12 sm:w-14 sm:h-14 rounded-md object-cover ring-2" style={{ borderColor: cfg.cor_primaria }} />
                  ) : (
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-md grid place-items-center text-white" style={{ background: cfg.cor_primaria }}>
                      <Store className="w-4 h-4" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <Badge className={cn("rounded-full px-2.5 text-[11px]", aberta ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                      {aberta ? "Aberto agora" : "Loja fechada"}
                    </Badge>
                    <Badge variant="secondary" className="rounded-full px-2.5 text-[11px] bg-zinc-100 text-zinc-700">
                      <Clock className="w-3 h-3 mr-1" /> {diaHojeNome}: {horarioHojeTexto}
                    </Badge>
                  </div>

                  <h1 className="text-[15px] sm:text-lg font-bold tracking-tight line-clamp-2">{cfg.nome_loja}</h1>

                  <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-1">
                    <div className="rounded-md border bg-white p-1 text-[11px]">
                      <p className="text-zinc-500">Entrega</p>
                      <p className="font-bold">{cfg.tempo_entrega_min || "40min - 1h20"}</p>
                    </div>
                    <div className="rounded-md border bg-white p-1 text-[11px]">
                      <p className="text-zinc-500">Horario</p>
                      <p className="font-bold">{horarioHojeTexto}</p>
                    </div>
                    <div className="rounded-md border bg-white p-1 text-[11px]">
                      <p className="text-zinc-500">Taxa de entrega</p>
                      <p className="font-bold flex items-center gap-1">
                        <Bike className="w-3 h-3" /> A partir de {brl(taxaMin)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-1.5 grid sm:grid-cols-[1fr_auto] gap-1">
                <div className="relative">
                  <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar na loja" className="pl-7 h-7.5 rounded-md border-zinc-300 text-xs" />
                </div>
                <Button type="button" onClick={() => categorias[0] && scrollToCat(categorias[0].id)} className="h-7.5 rounded-md text-white font-medium text-xs px-2.5">
                  Buscar produtos
                </Button>
              </div>
              </div>

            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-3 pb-2">
          <div className="rounded-lg p-0 bg-transparent border-0 shadow-none">
            <div className="mx-auto w-full max-w-[620px]">
              <div className="relative overflow-hidden rounded-[12px] bg-zinc-100" style={{ aspectRatio: "16 / 10.4" }}>
                {bannerSlides.length > 0 ? (
                  <>
                    {bannerSlides.map((src, idx) => (
                      <img
                        key={`${src}-${idx}`}
                        src={src}
                        alt={`Banner ${idx + 1}`}
                        className={cn(
                          "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
                          idx === bannerIndex ? "opacity-100" : "opacity-0"
                        )}
                        loading={idx === 0 ? "eager" : "lazy"}
                      />
                    ))}
                  </>
                ) : (
                  <div
                    className="absolute inset-0 grid place-items-center text-white text-center p-4"
                    style={{ background: `linear-gradient(135deg, ${cfg.cor_primaria}, #111827)` }}
                  >
                    <div>
                      <p className="text-sm uppercase tracking-[0.2em] opacity-80">Destaque da casa</p>
                      <p className="text-2xl sm:text-4xl font-black">{cfg.nome_loja}</p>
                    </div>
                  </div>
                )}
              </div>

              {bannerSlides.length > 1 && (
                <div className="mt-1.5 flex items-center justify-center gap-1">
                  {bannerSlides.map((_, idx) => (
                    <button
                      key={`dot-${idx}`}
                      type="button"
                      aria-label={`Ir para banner ${idx + 1}`}
                      onClick={() => setBannerIndex(idx)}
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        idx === bannerIndex ? "w-4 bg-zinc-500" : "w-1.5 bg-zinc-300 hover:bg-zinc-400"
                      )}
                    />
                  ))}
                </div>
              )}
            </div>

            <h2 className="text-[16px] sm:text-[17px] font-semibold mb-2 text-center tracking-tight">Mais Pedidos</h2>
            <div className="mx-auto w-full max-w-[700px] flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {maisPedidos.map((p, i) => (
                <article key={`top-${p.id}`} onClick={() => aberta && openAdd(p)} className="shrink-0 w-[132px] cursor-pointer">
                  <div className="relative h-[76px] rounded-md overflow-hidden bg-zinc-200 shadow-sm">
                    {p.imagem_url ? (
                      <img src={p.imagem_url} alt={p.nome} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full grid place-items-center"><UtensilsCrossed className="w-7 h-7 opacity-35" /></div>
                    )}
                    {i === 0 && <span className="absolute top-1.5 left-1.5 bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">🔥 O favorito!</span>}
                  </div>
                  <div className="pt-1 px-0.5">
                    <h3 className="font-semibold text-[12px] leading-4 line-clamp-2 min-h-[24px] uppercase tracking-tight text-zinc-800">{p.nome}</h3>
                    {p.promocao && p.preco_promocional != null ? (
                      <>
                        <p className="text-[10px] text-zinc-500 mt-0.5">A partir de</p>
                        <p className="text-[17px] font-semibold">{brl(precoEfetivo(p))}</p>
                      </>
                    ) : (
                      <p className="text-[17px] font-semibold mt-0.5">{brl(precoEfetivo(p))}</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </header>

      {!aberta && (
        <div className="max-w-4xl mx-auto px-3 mt-2">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
            {horarioHoje?.ativo
              ? `Estamos fechados no momento. Hoje (${diaHojeNome}) abrimos em ${horarioHojeTexto}.`
              : `Hoje (${diaHojeNome}) nao abrimos.`}
          </div>
        </div>
      )}

      {cfg.fidelidade_ativa && (
        <div className="max-w-4xl mx-auto px-3 mt-3">
          <div
            className="relative overflow-hidden rounded-[30px] border px-4 py-4 text-white shadow-[0_20px_44px_-30px_rgba(5,46,22,0.85)] sm:px-5"
            style={{
              borderColor: withAlpha(fidelidadeCor, 0.55),
              backgroundImage: `linear-gradient(120deg, ${withAlpha(fidelidadeCor, 0.96)}, ${withAlpha(fidelidadeCor, 0.78)})`,
            }}
          >
            <div className="pointer-events-none absolute inset-0 opacity-20 loyalty-shimmer" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 text-white shadow-inner">
                  <Trophy className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/80">Programa de fidelidade</p>
                  <h2 className="text-lg font-bold tracking-tight text-white">{cfg.fidelidade_texto || "A cada 10 pedidos, ganhe uma recompensa!"}</h2>
                  {fidelidadePedidoMinimo > 0 && (
                    <p className="mt-1 text-xs text-white/90">Pedidos a partir de {brl(fidelidadePedidoMinimo)} contam na fidelidade.</p>
                  )}
                </div>
              </div>
              <Button type="button" onClick={openFidelidadeDialog} className="bg-white hover:bg-white/90" style={{ color: withAlpha(fidelidadeCor, 0.95) }}>
                Ver minhas recompensas
              </Button>
            </div>
          </div>
        </div>
      )}

      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-40 border-y border-zinc-200 bg-[#f3f3f3]/95 backdrop-blur shadow-sm transition-all duration-300",
          showStickyCats ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
        )}
      >
        <div className="max-w-4xl mx-auto px-3 overflow-x-auto no-scrollbar">
          <div className="flex items-center min-w-max">
            {categorias.map((c) => {
              const active = activeCat === c.id;
              return (
                  <button
                  key={c.id}
                  onClick={() => scrollToCat(c.id)}
                  className={cn(
                    "px-3 py-2.5 text-[13px] sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                    active
                      ? "text-zinc-900 border-zinc-700"
                      : "text-zinc-500 border-transparent hover:text-zinc-700"
                  )}
                >
                  {c.nome}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <main ref={produtosInicioRef} className="max-w-4xl mx-auto px-3 py-5 space-y-6">

        <div className="flex items-center justify-between">
          <h2 className="text-lg sm:text-xl font-semibold">Cardapio</h2>
          <div className="text-xs sm:text-sm text-zinc-600 flex items-center gap-1">
            <Target className="w-4 h-4" /> {produtosFiltrados.length} produtos
          </div>
        </div>

        {promocoes.length > 0 && busca.trim() === "" && (
          <section>
            <h3 className="text-lg font-bold mb-3 flex items-center gap-1.5"><Flame className="w-4 h-4 text-orange-500" /> Promocoes</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {promocoes.slice(0, 6).map((p) => (
                <article key={`promo-${p.id}`} onClick={() => aberta && openAdd(p)} className="rounded-2xl border bg-white p-3 cursor-pointer hover:shadow-md transition">
                  <div className="flex gap-3">
                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-zinc-100 shrink-0">
                      {p.imagem_url ? (
                        <img src={p.imagem_url} alt={p.nome} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full grid place-items-center"><UtensilsCrossed className="w-5 h-5 opacity-35" /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-sm line-clamp-1">{p.nome}</h4>
                      {p.descricao && <p className="text-xs text-zinc-500 line-clamp-2 mt-0.5">{p.descricao}</p>}
                      <div className="flex items-end gap-2 mt-1">
                        <span className="text-xs line-through text-zinc-400">{brl(Number(p.preco))}</span>
                        <span className="font-semibold brand-text">{brl(precoEfetivo(p))}</span>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {categorias.map((c) => {
          const itens = produtosFiltrados.filter((p) => p.categoria_id === c.id);
          return (
            <section key={c.id} ref={(el) => (sectionRefs.current[c.id] = el)} className="scroll-mt-24">
              <h3 className="text-[20px] sm:text-[22px] font-semibold mb-2.5 text-center text-zinc-700 uppercase">
                {(c.emoji || c.icone) && <span className="mr-1">{c.emoji || c.icone}</span>}
                {c.nome}
              </h3>

              {itens.length === 0 ? (
                <div className="rounded-xl bg-white p-4 text-sm text-zinc-500">Nenhum item encontrado nesta categoria.</div>
              ) : (
                <div className="bg-[#f7f7f7]">
                  {itens.map((p) => {
                    const isPromo = p.promocao && p.preco_promocional != null;
                    const isTop = topSellers.has(p.id);
                    return (
                      <article
                        key={p.id}
                        onClick={() => aberta && openAdd(p)}
                        className="px-3 sm:px-3.5 py-3 sm:py-3.5 cursor-pointer hover:bg-zinc-50/70"
                      >
                        <div className="grid grid-cols-[1fr_76px] sm:grid-cols-[1fr_88px] gap-2.5 sm:gap-3 items-start">
                          <div className="min-w-0">
                            <div className="flex items-center flex-wrap gap-2">
                              <h4 className="font-semibold text-[14px] sm:text-[15px] leading-tight line-clamp-1 uppercase text-zinc-700">{p.nome}</h4>
                              {isTop && <Badge className="bg-amber-100 text-amber-700 rounded-full text-xs">Mais pedido</Badge>}
                            </div>
                            <p className="text-[11px] sm:text-[12px] text-zinc-500 mt-1 line-clamp-2">{p.descricao || "Sem descricao"}</p>
                            <div className="mt-1 inline-flex rounded-full bg-zinc-200/80 text-zinc-600 px-2 py-0.5 text-[9px] font-medium">{p.serve_texto || "Serve 1 pessoa"}</div>
                            <div className="mt-2.5 flex items-end gap-1.5 text-zinc-600">
                              <span className="text-[14px] leading-none">A partir de</span>
                              {isPromo && <span className="text-xs line-through text-zinc-400 mb-0.5">{brl(Number(p.preco))}</span>}
                              <span className="font-semibold text-[18px] leading-none text-zinc-700">{brl(precoEfetivo(p))}</span>
                            </div>
                          </div>

                          <div className="w-[76px] h-[76px] sm:w-[88px] sm:h-[88px] rounded-lg overflow-hidden bg-zinc-100 justify-self-end mt-1">
                            {p.imagem_url ? (
                              <img src={p.imagem_url} alt={p.nome} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full grid place-items-center"><UtensilsCrossed className="w-7 h-7 opacity-35" /></div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </main>

      {cart.length > 0 && aberta && (
        <button
          onClick={() => setCheckoutOpen(true)}
          className="fixed bottom-4 left-4 right-4 max-w-3xl mx-auto rounded-2xl shadow-2xl text-white p-4 flex items-center justify-between font-semibold z-40 hover:scale-[1.01] transition"
          style={{ background: cfg.cor_primaria }}
        >
          <span className="flex items-center gap-2">
            <span className="bg-white/20 rounded-full w-8 h-8 grid place-items-center text-sm">{totalItens}</span>
            <ShoppingBag className="w-5 h-5" /> Ver carrinho
          </span>
          <span className="text-lg font-bold">{brl(subtotal)}</span>
        </button>
      )}

      <ProdutoCascadeDialog
        open={!!adicionando}
        produto={adicionando}
        onClose={() => setAdicionando(null)}
        onConfirm={(item) => setCart((prev) => [...prev, item])}
        priceResolver={precoEfetivo}
        color={cfg.cor_primaria}
        fallbackAllGroups={isHamburger(adicionando)}
      />

      <Sheet open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
          <SheetHeader>
            <div className="px-5 pt-5 pb-3 border-b bg-white sticky top-0 z-10">
              <SheetTitle className="text-2xl font-bold">Seu pedido</SheetTitle>
              <p className="text-xs text-zinc-500 mt-1">{totalItens} item(ns) no carrinho</p>
            </div>
          </SheetHeader>

          <div className="px-5 py-4 space-y-3">
            {cart.map((i, idx) => (
              <div key={idx} className="flex gap-3 p-3 rounded-xl border bg-white shadow-sm">
                <div className="w-14 h-14 rounded-lg bg-muted overflow-hidden shrink-0">
                  {i.produto.imagem_url ? (
                    <img src={i.produto.imagem_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center"><UtensilsCrossed className="w-6 h-6 opacity-30" /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <div className="font-semibold text-sm truncate">{i.produto.nome}</div>
                    <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {i.adicionais.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {i.adicionais.map((adicional) => (
                        <p key={`${i.id}-${adicional.adicionalId}`} className="text-[11px] text-muted-foreground truncate">
                          + {adicional.grupoNome}: {adicional.adicionalNome} x{adicional.quantidade}
                        </p>
                      ))}
                    </div>
                  )}
                  {i.observacao && <p className="text-xs text-muted-foreground mt-0.5 truncate">↳ {i.observacao}</p>}
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(idx, -1)}><Minus className="w-3 h-3" /></Button>
                      <span className="w-6 text-center text-sm font-semibold">{i.quantidade}</span>
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(idx, 1)}><Plus className="w-3 h-3" /></Button>
                    </div>
                    <span className="font-bold text-sm">{brl(i.precoUnit * i.quantidade)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="px-5 space-y-3 mt-2">
            {renderFidelidadeBox(true)}

            <h3 className="text-lg font-bold mt-6">Como voce quer receber?</h3>
            <div className={cn("grid gap-2", retiradaAtiva ? "grid-cols-2" : "grid-cols-1")}>
              <button
                type="button"
                onClick={() => setTipoEntrega("delivery")}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-all",
                  tipoEntrega === "delivery"
                    ? "border-emerald-500 bg-emerald-50 shadow-sm"
                    : "border-zinc-200 bg-white hover:border-zinc-300"
                )}
              >
                <div className="flex items-center gap-2 text-base font-semibold">
                  <Bike className="h-5 w-5" /> Delivery
                </div>
                <p className="mt-1 text-xs text-zinc-600">Receba no endereco informado</p>
              </button>

              {retiradaAtiva && (
                <button
                  type="button"
                  onClick={() => setTipoEntrega("retirada")}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-all",
                    tipoEntrega === "retirada"
                      ? "border-blue-500 bg-blue-50 shadow-sm"
                      : "border-zinc-200 bg-white hover:border-zinc-300"
                  )}
                >
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <Store className="h-5 w-5" /> Retirada no balcao
                  </div>
                  {cfg?.endereco_estabelecimento ? (
                    <p className="mt-1 text-xs text-zinc-600">{cfg.endereco_estabelecimento}</p>
                  ) : (
                    <p className="mt-1 text-xs text-zinc-400 italic">Endereço não configurado</p>
                  )}
                </button>
              )}
            </div>

            <h3 className="text-lg font-bold mt-4">Dados do cliente</h3>
            <div className="space-y-2"><Label>Nome completo *</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} /></div>
            <div className="space-y-2"><Label>Telefone *</Label><Input value={tel} onChange={(e) => setTel(e.target.value)} maxLength={20} placeholder="(11) 99999-9999" /></div>

            {tipoEntrega === "delivery" ? (
              <>
                <div className="space-y-2"><Label>Endereco *</Label><Input value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={200} placeholder="Rua / Avenida" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2"><Label>Numero *</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} /></div>
                  <div className="space-y-2"><Label>Complemento</Label><Input value={complemento} onChange={(e) => setComplemento(e.target.value)} maxLength={80} /></div>
                </div>
                <div className="space-y-2">
                  <Label>Bairro *</Label>
                  <Select value={bairroId} onValueChange={setBairroId}>
                    <SelectTrigger><SelectValue placeholder="Selecione o bairro" /></SelectTrigger>
                    <SelectContent>
                      {bairros.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.nome} - {brl(Number(b.taxa))}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                Seu pedido ficara pronto em aproximadamente {tempoEstimadoRetirada} minutos. Retire no balcao!
              </div>
            )}
          </div>

          <div className="px-5 space-y-3 mt-6">
            <h3 className="text-lg font-bold">Pagamento</h3>
            <RadioGroup value={forma} onValueChange={(v) => setForma(v as Forma)}>
              <div className="flex items-center gap-2 border rounded-md p-2 md:p-3"><RadioGroupItem id="pix" value="pix" /><Label htmlFor="pix" className="flex-1 cursor-pointer text-sm md:text-base">PIX</Label></div>
              <div className="flex items-center gap-2 border rounded-md p-2 md:p-3"><RadioGroupItem id="dinheiro" value="dinheiro" /><Label htmlFor="dinheiro" className="flex-1 cursor-pointer text-sm md:text-base">Dinheiro</Label></div>
              <div className="flex items-center gap-1.5 border rounded-md p-2 md:p-3"><RadioGroupItem id="cartao" value="cartao" /><Label htmlFor="cartao" className="flex-1 cursor-pointer flex items-center gap-1 md:gap-2"><CreditCard className="w-4 h-4" /><span className="text-sm md:text-base">Cartão na entrega</span></Label></div>
            </RadioGroup>
            {forma === "dinheiro" && (
              <div className="space-y-2">
                <Label>Troco para quanto?</Label>
                <Input type="number" min={0} step="1" value={troco} onChange={(e) => setTroco(e.target.value)} placeholder="Ex: 100" />
              </div>
            )}
          </div>

          <div className="border-t mt-6 pt-3 px-5 pb-6 space-y-2">
            <div className="text-xs md:text-sm space-y-0.5 md:space-y-1">
              <div className="flex justify-between"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
              {rewardBenefit.itemGratis && (
                <div className="flex justify-between" style={{ color: withAlpha(fidelidadeCor, 0.95) }}><span>Item gratis</span><span>{rewardBenefit.itemGratis.nome}</span></div>
              )}
              {rewardBenefit.desconto > 0 && (
                <div className="flex justify-between" style={{ color: withAlpha(fidelidadeCor, 0.95) }}><span>Desconto fidelidade</span><span>-{brl(rewardBenefit.desconto)}</span></div>
              )}
              <div className="space-y-2 rounded-xl border bg-zinc-50 p-3">
                {!cupomAplicado ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Tem um cupom?</Label>
                      <Input
                        value={cupomCodigo}
                        onChange={(event) => setCupomCodigo(event.target.value.toUpperCase())}
                        placeholder="BURGER10"
                        className="uppercase"
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={() => void applyCoupon()} disabled={cupomBusy}>
                      {cupomBusy ? "Aplicando..." : "Aplicar"}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge className="border-emerald-500/25 bg-emerald-500/15 text-emerald-700">
                      Cupom aplicado ✅ {cupomAplicado.codigo}
                    </Badge>
                    <Button type="button" variant="outline" size="sm" onClick={removeCoupon}>
                      Remover
                    </Button>
                  </div>
                )}
              </div>
              {cupomAplicado?.tipo === "percentual" && (
                <div className="flex justify-between" style={{ color: withAlpha(fidelidadeCor, 0.95) }}>
                  <span>Desconto ({Number(cupomAplicado.valor || 0).toFixed(0)}%)</span>
                  <span>-{brl(descontoCupom)}</span>
                </div>
              )}
              {cupomAplicado?.tipo === "fixo" && (
                <div className="flex justify-between" style={{ color: withAlpha(fidelidadeCor, 0.95) }}>
                  <span>Desconto</span>
                  <span>-{brl(descontoCupom)}</span>
                </div>
              )}
              {cupomAplicado?.tipo === "frete_gratis" && (
                <div className="flex justify-between" style={{ color: withAlpha(fidelidadeCor, 0.95) }}>
                  <span>{tipoEntrega === "delivery" ? "Frete" : "Cupom"}</span>
                  <span>{tipoEntrega === "delivery" ? "Grátis 🎉" : "Aplicado"}</span>
                </div>
              )}
              {cupomAplicado?.tipo !== "frete_gratis" && (
                <div className="flex justify-between"><span>{tipoEntrega === "delivery" ? "Taxa de entrega" : "Taxa"}</span><span>{brl(taxaEfetiva)}</span></div>
              )}
              {cupomAplicado?.tipo === "frete_gratis" && tipoEntrega === "retirada" && (
                <div className="flex justify-between"><span>Taxa</span><span>{brl(0)}</span></div>
              )}
              <div className="flex justify-between text-base md:text-lg font-extrabold"><span>Total</span><span className="brand-text">{brl(total)}</span></div>
            </div>

            <Button className="w-full text-white hover:opacity-90 font-bold" size="lg" disabled={busy} onClick={fazerPedido}>
              {busy ? "Enviando..." : "Finalizar pedido"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={fidelidadeDialogOpen} onOpenChange={setFidelidadeDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0">
          <div className="p-4 sm:p-5">
            {renderFidelidadeBox()}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sucessoNumero} onOpenChange={(o) => !o && setSucessoNumero(null)}>
        <DialogContent>
          <div className="text-center py-4 space-y-3">
            <CheckCircle2 className="w-16 h-16 mx-auto text-emerald-500" />
            <h2 className="text-3xl font-bold">Pedido recebido! 🎉</h2>
            {sucessoTipoEntrega === "retirada" ? (
              <p className="text-muted-foreground">Retire no balcao em ~{sucessoTempoRetirada} minutos.</p>
            ) : (
              <p className="text-muted-foreground">Em breve entraremos em contato.</p>
            )}
            <div className="text-xs text-muted-foreground">Numero do pedido</div>
            <div className="text-2xl font-bold tracking-wider">#{sucessoNumero}</div>
            <Button onClick={() => setSucessoNumero(null)} className="w-full text-white" style={{ background: cfg.cor_primaria }}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
