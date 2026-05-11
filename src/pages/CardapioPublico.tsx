import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ShoppingBag, Plus, Minus, Trash2, CheckCircle2, Clock, Store, Bike,
  ChevronLeft, ChevronRight, Flame, UtensilsCrossed, Sun, Moon,
} from "lucide-react";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "@/lib/utils";
import type { BairroTaxa, Categoria, Configuracao, Produto } from "@/types/db";

interface CartItem {
  produto: Produto;
  quantidade: number;
  observacao: string;
  precoUnit: number;
}

type Forma = "dinheiro" | "pix" | "cartao";

const checkoutSchema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome").max(100),
  telefone: z.string().trim().min(8, "Telefone inválido").max(20),
  endereco: z.string().trim().min(3, "Informe o endereço").max(200),
  numero: z.string().trim().min(1, "Número").max(20),
  complemento: z.string().trim().max(80).optional().or(z.literal("")),
  bairro_id: z.string().min(1, "Selecione o bairro"),
  forma: z.enum(["dinheiro", "pix", "cartao"]),
  troco: z.string().optional(),
});

const isOpenNow = (cfg: Configuracao) => {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [ah, am] = cfg.hora_abertura.split(":").map(Number);
  const [fh, fm] = cfg.hora_fechamento.split(":").map(Number);
  const ini = ah * 60 + am;
  const fim = fh * 60 + fm;
  return fim > ini ? cur >= ini && cur <= fim : cur >= ini || cur <= fim;
};

const precoEfetivo = (p: Produto) =>
  p.promocao && p.preco_promocional != null ? Number(p.preco_promocional) : Number(p.preco);

export default function CardapioPublico() {
  const [cfg, setCfg] = useState<Configuracao | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [bairros, setBairros] = useState<BairroTaxa[]>([]);
  const [topSellers, setTopSellers] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<CartItem[]>([]);

  const [adicionando, setAdicionando] = useState<Produto | null>(null);
  const [qtd, setQtd] = useState(1);
  const [obs, setObs] = useState("");

  const [activeCat, setActiveCat] = useState<string>("");
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    (typeof window !== "undefined" && localStorage.getItem("cardapio-theme") as "light" | "dark") || "light"
  );

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
  const [sucessoNumero, setSucessoNumero] = useState<string | null>(null);

  const promoScroll = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // Theme on root
  useEffect(() => {
    document.documentElement.classList.toggle("cardapio-dark", theme === "dark");
    localStorage.setItem("cardapio-theme", theme);
    return () => document.documentElement.classList.remove("cardapio-dark");
  }, [theme]);

  // Load
  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: cat }, { data: prod }, { data: b }, { data: itens }] = await Promise.all([
        supabase.from("configuracoes").select("*").limit(1).maybeSingle(),
        supabase.from("categorias").select("*").eq("ativo", true).order("nome"),
        supabase.from("produtos").select("*").eq("disponivel", true).order("nome"),
        supabase.from("bairros_taxas").select("*").eq("ativo", true).order("nome"),
        supabase.from("pedido_itens").select("produto_id, quantidade").limit(1000),
      ]);
      if (c) setCfg(c as Configuracao);
      const cs = (cat || []) as Categoria[];
      setCategorias(cs);
      setProdutos((prod || []) as Produto[]);
      setBairros((b || []) as BairroTaxa[]);
      if (cs[0]) setActiveCat(cs[0].id);

      // Top 3 mais vendidos
      const counts = new Map<string, number>();
      (itens || []).forEach((i: any) => {
        if (!i.produto_id) return;
        counts.set(i.produto_id, (counts.get(i.produto_id) || 0) + (i.quantidade || 0));
      });
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
      setTopSellers(new Set(top));
    })();
  }, []);

  // SEO + cor primária
  useEffect(() => {
    if (!cfg) return;
    document.title = cfg.seo_titulo || cfg.nome_loja;
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement("meta"); m.setAttribute("name", "description"); document.head.appendChild(m); }
    m.setAttribute("content", cfg.seo_descricao || "");
  }, [cfg]);

  const corStyle = useMemo(() => {
    if (!cfg) return {};
    return {
      ["--brand" as any]: cfg.cor_primaria,
    };
  }, [cfg]);

  const subtotal = cart.reduce((s, i) => s + i.precoUnit * i.quantidade, 0);
  const totalItens = cart.reduce((s, i) => s + i.quantidade, 0);
  const taxa = bairros.find((b) => b.id === bairroId)?.taxa ?? 0;
  const total = subtotal + Number(taxa);

  const promocoes = useMemo(() => produtos.filter((p) => p.promocao), [produtos]);

  const openAdd = (p: Produto) => { setAdicionando(p); setQtd(1); setObs(""); };
  const confirmAdd = () => {
    if (!adicionando) return;
    setCart((prev) => [...prev, {
      produto: adicionando,
      quantidade: qtd,
      observacao: obs.slice(0, 200),
      precoUnit: precoEfetivo(adicionando),
    }]);
    setAdicionando(null);
  };
  const removeItem = (idx: number) => setCart((prev) => prev.filter((_, i) => i !== idx));
  const updateQty = (idx: number, delta: number) =>
    setCart((prev) => prev.map((it, i) => i === idx ? { ...it, quantidade: Math.max(1, it.quantidade + delta) } : it));

  const scrollToCat = (id: string) => {
    setActiveCat(id);
    const el = sectionRefs.current[id];
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 140;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  const scrollPromo = (dir: 1 | -1) => {
    const el = promoScroll.current;
    if (el) el.scrollBy({ left: dir * 320, behavior: "smooth" });
  };

  const fazerPedido = async () => {
    const parsed = checkoutSchema.safeParse({ nome, telefone: tel, endereco, numero, complemento, bairro_id: bairroId, forma, troco });
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    if (!cart.length) return toast.error("Carrinho vazio");
    const bairro = bairros.find((b) => b.id === bairroId)!;

    setBusy(true);
    const { data: pedido, error: e1 } = await supabase
      .from("pedidos").insert({ tipo: "delivery", status: "pendente" }).select().single();
    if (e1 || !pedido) { setBusy(false); return toast.error(e1?.message || "Erro"); }

    const itensRows = cart.map((i) => ({
      pedido_id: pedido.id,
      produto_id: i.produto.id,
      quantidade: i.quantidade,
      preco_unitario: i.precoUnit,
      observacao: i.observacao || null,
    }));
    const { error: e2 } = await supabase.from("pedido_itens").insert(itensRows);
    if (e2) { setBusy(false); return toast.error(e2.message); }

    const enderecoFull = `${endereco}, ${numero}${complemento ? ` - ${complemento}` : ""}`;
    const trocoVal = forma === "dinheiro" && troco ? Number(troco.replace(",", ".")) : null;
    const { error: e3 } = await supabase.from("entregas").insert({
      pedido_id: pedido.id,
      cliente_nome: nome,
      cliente_telefone: tel,
      endereco: enderecoFull,
      bairro: bairro.nome,
      taxa_entrega: Number(bairro.taxa),
      status: "aguardando",
      origem: "online",
      numero,
      complemento: complemento || null,
      forma_pagamento: forma,
      troco_para: trocoVal,
    });
    setBusy(false);
    if (e3) return toast.error(e3.message);

    setSucessoNumero(pedido.id.slice(0, 8).toUpperCase());
    setCart([]); setCheckoutOpen(false);
    setNome(""); setTel(""); setEndereco(""); setNumero(""); setComplemento(""); setBairroId(""); setForma("pix"); setTroco("");
  };

  if (!cfg) return <div className="min-h-screen grid place-items-center">Carregando...</div>;

  const aberta = cfg.ativo && isOpenNow(cfg);
  const isDark = theme === "dark";
  const taxaMin = bairros.length ? Math.min(...bairros.map((b) => Number(b.taxa))) : 0;

  return (
    <div
      className={cn(
        "min-h-screen pb-32 cardapio-root font-cardapio",
        isDark ? "bg-[#1a1a1a] text-zinc-100" : "bg-white text-zinc-900"
      )}
      style={corStyle as React.CSSProperties}
    >
      <style>{`
        .font-cardapio { font-family: 'Inter', 'Poppins', system-ui, sans-serif; }
        .brand-bg { background-color: var(--brand); }
        .brand-text { color: var(--brand); }
        .brand-border { border-color: var(--brand); }
        .brand-ring { box-shadow: 0 0 0 2px var(--brand); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* HEADER / BANNER */}
      <header className="relative">
        <div className="relative h-48 sm:h-64 md:h-72 overflow-hidden">
          {cfg.banner_url ? (
            <img
              src={cfg.banner_url}
              alt="Banner"
              className="w-full h-full object-cover object-center"
            />
          ) : (
            <div
              className="w-full h-full"
              style={{
                background: `linear-gradient(135deg, ${cfg.cor_primaria}, ${cfg.cor_primaria}99)`,
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/60" />
          {/* theme toggle */}
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label="Alternar tema"
            className="absolute top-4 right-4 w-10 h-10 grid place-items-center rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60 transition"
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>

        <div className={cn("relative", isDark ? "bg-[#1a1a1a]" : "bg-white")}>
          <div className="max-w-5xl mx-auto px-4 pb-5">
            {/* Logo overlapping banner */}
            <div className="-mt-12 sm:-mt-14 flex justify-center">
              {cfg.logo_url ? (
                <img
                  src={cfg.logo_url}
                  alt={cfg.nome_loja}
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl object-cover shadow-2xl ring-4"
                  style={{ boxShadow: "0 12px 40px rgba(0,0,0,0.35)", borderColor: cfg.cor_primaria }}
                />
              ) : (
                <div
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl grid place-items-center text-white shadow-2xl"
                  style={{ background: cfg.cor_primaria, boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }}
                >
                  <Store className="w-10 h-10" />
                </div>
              )}
            </div>

            <div className="text-center mt-3">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{cfg.nome_loja}</h1>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2 text-sm">
                <span
                  className={cn(
                    "px-3 py-1 rounded-full font-medium flex items-center gap-1.5",
                    aberta ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-red-500/15 text-red-500"
                  )}
                >
                  <span className={cn("w-2 h-2 rounded-full", aberta ? "bg-emerald-500" : "bg-red-500")} />
                  {aberta ? "Aberto agora" : "Fechado"}
                </span>
                <span className={cn("px-3 py-1 rounded-full flex items-center gap-1.5", isDark ? "bg-zinc-800" : "bg-zinc-100")}>
                  <Clock className="w-3.5 h-3.5" /> {cfg.tempo_entrega_min || "30-45 min"}
                </span>
                <span className={cn("px-3 py-1 rounded-full flex items-center gap-1.5", isDark ? "bg-zinc-800" : "bg-zinc-100")}>
                  <Bike className="w-3.5 h-3.5" /> Entrega a partir de {brl(taxaMin)}
                </span>
              </div>
              <p className={cn("text-xs mt-2", isDark ? "text-zinc-400" : "text-zinc-500")}>
                Funcionamento: {cfg.hora_abertura.slice(0, 5)} às {cfg.hora_fechamento.slice(0, 5)}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* SEM ABERTURA */}
      {!aberta && (
        <div className="max-w-3xl mx-auto px-4 mt-4">
          <div className={cn("rounded-2xl p-6 text-center border", isDark ? "bg-zinc-900 border-zinc-800" : "bg-zinc-50 border-zinc-200")}>
            <h2 className="text-2xl font-bold mb-1">Estamos fechados no momento</h2>
            <p className={cn("text-sm", isDark ? "text-zinc-400" : "text-zinc-600")}>
              Volte entre {cfg.hora_abertura.slice(0, 5)} e {cfg.hora_fechamento.slice(0, 5)}
            </p>
          </div>
        </div>
      )}

      {/* STICKY CATEGORIAS */}
      <nav
        className={cn(
          "sticky top-0 z-30 border-b backdrop-blur",
          isDark ? "bg-[#1a1a1a]/90 border-zinc-800" : "bg-white/90 border-zinc-200"
        )}
      >
        <div className="max-w-5xl mx-auto px-2 overflow-x-auto no-scrollbar">
          <div className="flex gap-1 py-2 min-w-max">
            {categorias.map((c) => {
              const active = activeCat === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => scrollToCat(c.id)}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5",
                    active
                      ? "text-white shadow-md"
                      : isDark
                        ? "text-zinc-300 hover:bg-zinc-800"
                        : "text-zinc-700 hover:bg-zinc-100"
                  )}
                  style={active ? { background: cfg.cor_primaria } : {}}
                >
                  {c.icone && <span>{c.icone}</span>}
                  {c.nome}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-10">
        {/* PROMOÇÕES CARROSSEL */}
        {promocoes.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Flame className="w-6 h-6 text-red-500" /> Promoções
              </h2>
              <div className="hidden sm:flex gap-1">
                <button
                  onClick={() => scrollPromo(-1)}
                  className={cn("w-9 h-9 rounded-full grid place-items-center", isDark ? "bg-zinc-800 hover:bg-zinc-700" : "bg-zinc-100 hover:bg-zinc-200")}
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => scrollPromo(1)}
                  className={cn("w-9 h-9 rounded-full grid place-items-center", isDark ? "bg-zinc-800 hover:bg-zinc-700" : "bg-zinc-100 hover:bg-zinc-200")}
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div ref={promoScroll} className="flex gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-2 -mx-4 px-4">
              {promocoes.map((p) => {
                const promo = Number(p.preco_promocional ?? p.preco);
                return (
                  <article
                    key={p.id}
                    className={cn(
                      "snap-start shrink-0 w-64 rounded-2xl overflow-hidden border transition-all hover:-translate-y-1 hover:shadow-xl cursor-pointer",
                      isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-zinc-200"
                    )}
                    onClick={() => aberta && openAdd(p)}
                  >
                    <div className="relative h-36 bg-zinc-200 dark:bg-zinc-800">
                      {p.imagem_url ? (
                        <img src={p.imagem_url} alt={p.nome} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full grid place-items-center"><UtensilsCrossed className="w-10 h-10 opacity-30" /></div>
                      )}
                      <span className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-md shadow">
                        PROMO
                      </span>
                    </div>
                    <div className="p-3">
                      <h3 className="font-semibold text-sm line-clamp-1">{p.nome}</h3>
                      {p.descricao && <p className={cn("text-xs line-clamp-1 mt-0.5", isDark ? "text-zinc-400" : "text-zinc-500")}>{p.descricao}</p>}
                      <div className="flex items-end gap-2 mt-2">
                        <span className={cn("text-xs line-through", isDark ? "text-zinc-500" : "text-zinc-400")}>
                          {brl(Number(p.preco))}
                        </span>
                        <span className="text-lg font-bold brand-text">{brl(promo)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* CATEGORIAS / PRODUTOS */}
        {categorias.map((c) => {
          const itens = produtos.filter((p) => p.categoria_id === c.id);
          if (!itens.length) return null;
          return (
            <section
              key={c.id}
              ref={(el) => (sectionRefs.current[c.id] = el)}
              className="scroll-mt-32"
            >
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                {c.icone && <span>{c.icone}</span>} {c.nome}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {itens.map((p) => {
                  const isPromo = p.promocao && p.preco_promocional != null;
                  const preco = isPromo ? Number(p.preco_promocional) : Number(p.preco);
                  const isTop = topSellers.has(p.id);
                  return (
                    <article
                      key={p.id}
                      onClick={() => aberta && openAdd(p)}
                      className={cn(
                        "relative rounded-2xl border overflow-hidden flex transition-all hover:-translate-y-0.5 hover:shadow-xl cursor-pointer",
                        isDark ? "bg-zinc-900 border-zinc-800 hover:border-zinc-700" : "bg-white border-zinc-200 hover:border-zinc-300"
                      )}
                      style={{ minHeight: 140 }}
                    >
                      <div className="flex-1 p-4 pr-3 flex flex-col">
                        <div className="flex items-start gap-2 flex-wrap">
                          <h3 className="font-bold text-base leading-tight">{p.nome}</h3>
                          {isTop && (
                            <span className="bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Flame className="w-3 h-3" /> Mais pedido
                            </span>
                          )}
                        </div>
                        {p.descricao && (
                          <p className={cn("text-xs mt-1 line-clamp-2", isDark ? "text-zinc-400" : "text-zinc-500")}>
                            {p.descricao}
                          </p>
                        )}
                        <div className="mt-auto pt-2 flex items-end gap-2">
                          {isPromo && (
                            <span className={cn("text-xs line-through", isDark ? "text-zinc-500" : "text-zinc-400")}>
                              {brl(Number(p.preco))}
                            </span>
                          )}
                          <span className="text-lg font-bold brand-text">{brl(preco)}</span>
                        </div>
                      </div>
                      <div className="relative w-[40%] shrink-0 bg-zinc-100 dark:bg-zinc-800">
                        {p.imagem_url ? (
                          <img src={p.imagem_url} alt={p.nome} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="absolute inset-0 grid place-items-center">
                            <UtensilsCrossed className="w-10 h-10 opacity-30" />
                          </div>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); aberta && openAdd(p); }}
                          disabled={!aberta}
                          aria-label="Adicionar"
                          className="absolute bottom-2 right-2 w-10 h-10 rounded-full grid place-items-center text-white shadow-lg hover:scale-105 active:scale-95 transition disabled:opacity-50"
                          style={{ background: cfg.cor_primaria }}
                        >
                          <Plus className="w-5 h-5" />
                        </button>
                        {isPromo && (
                          <span className="absolute top-2 left-2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">
                            PROMO
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      {/* CARRINHO FLUTUANTE */}
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

      {/* MODAL PRODUTO */}
      <Dialog open={!!adicionando} onOpenChange={(o) => !o && setAdicionando(null)}>
        <DialogContent className="max-w-md p-0 overflow-hidden">
          {adicionando?.imagem_url && (
            <div className="h-56 -mt-0">
              <img src={adicionando.imagem_url} alt={adicionando.nome} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">{adicionando?.nome}</DialogTitle>
            </DialogHeader>
            {adicionando?.descricao && (
              <p className="text-sm text-muted-foreground">{adicionando.descricao}</p>
            )}
            <div className="flex items-end gap-2">
              {adicionando && adicionando.promocao && adicionando.preco_promocional != null && (
                <span className="text-sm line-through text-muted-foreground">{brl(Number(adicionando.preco))}</span>
              )}
              <span className="text-2xl font-bold brand-text">
                {brl(adicionando ? precoEfetivo(adicionando) : 0)}
              </span>
            </div>
            <div className="flex items-center gap-3 border-t pt-4">
              <Label className="flex-1 font-semibold">Quantidade</Label>
              <Button size="icon" variant="outline" onClick={() => setQtd((v) => Math.max(1, v - 1))}><Minus className="w-4 h-4" /></Button>
              <span className="text-2xl font-bold w-10 text-center">{qtd}</span>
              <Button size="icon" variant="outline" onClick={() => setQtd((v) => v + 1)}><Plus className="w-4 h-4" /></Button>
            </div>
            <div className="space-y-2">
              <Label>Alguma observação?</Label>
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} maxLength={200} placeholder="Sem cebola, ponto da carne..." />
            </div>
            <Button
              onClick={confirmAdd}
              size="lg"
              className="w-full text-white hover:opacity-90 font-bold"
              style={{ background: cfg.cor_primaria }}
            >
              Adicionar — {brl((adicionando ? precoEfetivo(adicionando) : 0) * qtd)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CHECKOUT */}
      <Sheet open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-2xl font-bold">Seu pedido</SheetTitle>
          </SheetHeader>

          <div className="space-y-3 mt-4">
            {cart.map((i, idx) => (
              <div key={idx} className="flex gap-3 p-3 rounded-xl border">
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

          <div className="space-y-3 mt-6">
            <h3 className="text-lg font-bold">Entrega</h3>
            <div className="space-y-2"><Label>Nome completo *</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} /></div>
            <div className="space-y-2"><Label>Telefone *</Label><Input value={tel} onChange={(e) => setTel(e.target.value)} maxLength={20} placeholder="(11) 99999-9999" /></div>
            <div className="space-y-2"><Label>Endereço *</Label><Input value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={200} placeholder="Rua / Avenida" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2"><Label>Número *</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} /></div>
              <div className="space-y-2"><Label>Complemento</Label><Input value={complemento} onChange={(e) => setComplemento(e.target.value)} maxLength={80} /></div>
            </div>
            <div className="space-y-2">
              <Label>Bairro *</Label>
              <Select value={bairroId} onValueChange={setBairroId}>
                <SelectTrigger><SelectValue placeholder="Selecione o bairro" /></SelectTrigger>
                <SelectContent>
                  {bairros.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.nome} — {brl(Number(b.taxa))}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 mt-6">
            <h3 className="text-lg font-bold">Pagamento</h3>
            <RadioGroup value={forma} onValueChange={(v) => setForma(v as Forma)}>
              <div className="flex items-center gap-2 border rounded-md p-3"><RadioGroupItem id="pix" value="pix" /><Label htmlFor="pix" className="flex-1 cursor-pointer">PIX</Label></div>
              <div className="flex items-center gap-2 border rounded-md p-3"><RadioGroupItem id="dinheiro" value="dinheiro" /><Label htmlFor="dinheiro" className="flex-1 cursor-pointer">Dinheiro</Label></div>
              <div className="flex items-center gap-2 border rounded-md p-3"><RadioGroupItem id="cartao" value="cartao" /><Label htmlFor="cartao" className="flex-1 cursor-pointer">Cartão na entrega</Label></div>
            </RadioGroup>
            {forma === "dinheiro" && (
              <div className="space-y-2">
                <Label>Troco para quanto?</Label>
                <Input type="number" min={0} step="1" value={troco} onChange={(e) => setTroco(e.target.value)} placeholder="Ex: 100" />
              </div>
            )}
          </div>

          <div className="border-t mt-6 pt-4 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
            <div className="flex justify-between"><span>Taxa de entrega</span><span>{brl(Number(taxa))}</span></div>
            <div className="flex justify-between text-2xl font-bold pt-2"><span>Total</span><span className="brand-text">{brl(total)}</span></div>
          </div>

          <Button
            className="w-full mt-4 text-white hover:opacity-90 font-bold bg-emerald-600 hover:bg-emerald-700"
            size="lg"
            disabled={busy}
            onClick={fazerPedido}
          >
            {busy ? "Enviando..." : "Finalizar pedido"}
          </Button>
        </SheetContent>
      </Sheet>

      {/* SUCESSO */}
      <Dialog open={!!sucessoNumero} onOpenChange={(o) => !o && setSucessoNumero(null)}>
        <DialogContent>
          <div className="text-center py-4 space-y-3">
            <CheckCircle2 className="w-16 h-16 mx-auto text-emerald-500" />
            <h2 className="text-3xl font-bold">Pedido recebido!</h2>
            <p className="text-muted-foreground">Em breve entraremos em contato.</p>
            <div className="text-xs text-muted-foreground">Número do pedido</div>
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
