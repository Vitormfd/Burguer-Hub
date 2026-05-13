import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
} from "lucide-react";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "@/lib/utils";
import type { BairroTaxa, Categoria, Configuracao, Produto } from "@/types/db";
import ProdutoCascadeDialog from "@/components/cardapio/ProdutoCascadeDialog";
import type { CartItem } from "@/components/cardapio/cartTypes";

type Forma = "dinheiro" | "pix" | "cartao";

const checkoutSchema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome").max(100),
  telefone: z.string().trim().min(8, "Telefone invalido").max(20),
  endereco: z.string().trim().min(3, "Informe o endereco").max(200),
  numero: z.string().trim().min(1, "Numero").max(20),
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
  const [activeCat, setActiveCat] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [bannerIndex, setBannerIndex] = useState(0);

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

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

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
  }, []);

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

  const subtotal = cart.reduce((s, i) => s + i.precoUnit * i.quantidade, 0);
  const totalItens = cart.reduce((s, i) => s + i.quantidade, 0);
  const taxa = bairros.find((b) => b.id === bairroId)?.taxa ?? 0;
  const total = subtotal + Number(taxa);

  const promocoes = useMemo(() => produtos.filter((p) => p.promocao), [produtos]);
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

    const bairro = bairros.find((b) => b.id === bairroId);
    if (!bairro) return toast.error("Selecione o bairro");

    setBusy(true);

    const { data: pedido, error: e1 } = await supabase
      .from("pedidos")
      .insert({ tipo: "delivery", status: "pendente" })
      .select()
      .single();
    if (e1 || !pedido) {
      setBusy(false);
      return toast.error(e1?.message || "Erro ao criar pedido");
    }

    const itensRows = cart.map((i) => ({
      pedido_id: pedido.id,
      produto_id: i.produto.id,
      quantidade: i.quantidade,
      preco_unitario: i.precoUnit,
      observacao: i.observacao || null,
    }));

    const { data: insertedItens, error: e2 } = await supabase.from("pedido_itens").insert(itensRows).select("id");
    if (e2) {
      setBusy(false);
      return toast.error(e2.message);
    }

    const adicionaisRows = cart
      .flatMap((item, idx) =>
        item.adicionais.map((adicional) => ({
          pedido_item_id: insertedItens?.[idx]?.id,
          adicional_id: adicional.adicionalId,
          quantidade: adicional.quantidade,
          preco_unitario: adicional.precoUnitario,
        }))
      )
      .filter((row) => !!row.pedido_item_id);

    if (adicionaisRows.length) {
      const { error: eAdd } = await supabase.from("pedido_item_adicionais").insert(adicionaisRows);
      if (eAdd) {
        setBusy(false);
        return toast.error(eAdd.message);
      }
    }

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
  };

  if (!cfg) return <div className="min-h-screen grid place-items-center">Carregando...</div>;

  const aberta = cfg.ativo && isOpenNow(cfg);
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
                      {aberta ? `Abrimos hoje as ${cfg.hora_abertura.slice(0, 5)}` : "Loja fechada"}
                    </Badge>
                    <Badge variant="secondary" className="rounded-full px-2.5 text-[11px] bg-zinc-100 text-zinc-700">
                      <Clock className="w-3 h-3 mr-1" /> {cfg.hora_abertura.slice(0, 5)} - {cfg.hora_fechamento.slice(0, 5)}
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
                      <p className="font-bold">{cfg.hora_abertura.slice(0, 5)} - {cfg.hora_fechamento.slice(0, 5)}</p>
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
            Estamos fechados no momento. Volte entre {cfg.hora_abertura.slice(0, 5)} e {cfg.hora_fechamento.slice(0, 5)}.
          </div>
        </div>
      )}

      <nav className="sticky top-0 z-30 border-y border-zinc-200 bg-[#f3f3f3]/95 backdrop-blur">
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

      <main className="max-w-4xl mx-auto px-3 py-5 space-y-6">
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
            <section key={c.id} ref={(el) => (sectionRefs.current[c.id] = el)} className="scroll-mt-28">
              <h3 className="text-[22px] sm:text-[24px] font-semibold mb-3 text-center text-zinc-700 uppercase">
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
                        className="px-3 sm:px-4 py-3.5 sm:py-4 cursor-pointer hover:bg-zinc-50/70"
                      >
                        <div className="grid grid-cols-[1fr_84px] sm:grid-cols-[1fr_96px] gap-3 sm:gap-4 items-start">
                          <div className="min-w-0">
                            <div className="flex items-center flex-wrap gap-2">
                              <h4 className="font-semibold text-[15px] sm:text-base leading-tight line-clamp-1 uppercase text-zinc-700">{p.nome}</h4>
                              {isTop && <Badge className="bg-amber-100 text-amber-700 rounded-full text-xs">Mais pedido</Badge>}
                            </div>
                            <p className="text-[12px] sm:text-[13px] text-zinc-500 mt-1.5 line-clamp-2">{p.descricao || "Sem descricao"}</p>
                            <div className="mt-1.5 inline-flex rounded-full bg-zinc-200/80 text-zinc-600 px-2 py-0.5 text-[10px] font-medium">Serve 1 pessoa</div>
                            <div className="mt-3 flex items-end gap-1.5 text-zinc-600">
                              <span className="text-[15px] leading-none">A partir de</span>
                              {isPromo && <span className="text-xs line-through text-zinc-400 mb-0.5">{brl(Number(p.preco))}</span>}
                              <span className="font-semibold text-[20px] leading-none text-zinc-700">{brl(precoEfetivo(p))}</span>
                            </div>
                          </div>

                          <div className="w-[84px] h-[84px] sm:w-[96px] sm:h-[96px] rounded-lg overflow-hidden bg-zinc-100 justify-self-end mt-1">
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
            <h3 className="text-lg font-bold">Entrega</h3>
            <div className="space-y-2"><Label>Nome completo *</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} /></div>
            <div className="space-y-2"><Label>Telefone *</Label><Input value={tel} onChange={(e) => setTel(e.target.value)} maxLength={20} placeholder="(11) 99999-9999" /></div>
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
          </div>

          <div className="px-5 space-y-3 mt-6 pb-36">
            <h3 className="text-lg font-bold">Pagamento</h3>
            <RadioGroup value={forma} onValueChange={(v) => setForma(v as Forma)}>
              <div className="flex items-center gap-2 border rounded-md p-3"><RadioGroupItem id="pix" value="pix" /><Label htmlFor="pix" className="flex-1 cursor-pointer">PIX</Label></div>
              <div className="flex items-center gap-2 border rounded-md p-3"><RadioGroupItem id="dinheiro" value="dinheiro" /><Label htmlFor="dinheiro" className="flex-1 cursor-pointer">Dinheiro</Label></div>
              <div className="flex items-center gap-2 border rounded-md p-3"><RadioGroupItem id="cartao" value="cartao" /><Label htmlFor="cartao" className="flex-1 cursor-pointer flex items-center gap-2"><CreditCard className="w-4 h-4" /> Cartao na entrega</Label></div>
            </RadioGroup>
            {forma === "dinheiro" && (
              <div className="space-y-2">
                <Label>Troco para quanto?</Label>
                <Input type="number" min={0} step="1" value={troco} onChange={(e) => setTroco(e.target.value)} placeholder="Ex: 100" />
              </div>
            )}
          </div>

          <div className="fixed bottom-0 right-0 w-full sm:w-[var(--radix-sheet-content-width)] border-t bg-white/95 backdrop-blur px-5 py-4 space-y-2">
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
              <div className="flex justify-between"><span>Taxa de entrega</span><span>{brl(Number(taxa))}</span></div>
              <div className="flex justify-between text-xl font-extrabold pt-1"><span>Total</span><span className="brand-text">{brl(total)}</span></div>
            </div>

            <Button className="w-full text-white hover:opacity-90 font-bold" size="lg" disabled={busy} onClick={fazerPedido}>
              {busy ? "Enviando..." : "Finalizar pedido"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!sucessoNumero} onOpenChange={(o) => !o && setSucessoNumero(null)}>
        <DialogContent>
          <div className="text-center py-4 space-y-3">
            <CheckCircle2 className="w-16 h-16 mx-auto text-emerald-500" />
            <h2 className="text-3xl font-bold">Pedido recebido!</h2>
            <p className="text-muted-foreground">Em breve entraremos em contato.</p>
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
