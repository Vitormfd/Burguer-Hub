import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Clock, Flame, ArrowLeft, Utensils, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Status = "pendente" | "em_preparo" | "pronto" | "entregue";
type Tipo = "mesa" | "delivery";

interface KdsItem {
  id: string;
  nome: string;
  quantidade: number;
  observacao: string | null;
}

interface KdsCard {
  pedido_id: string;
  tipo: Tipo;
  status: Status;
  criado_em: string;
  rotulo: string; // "Mesa 03" or cliente name
  online: boolean;
  itens: KdsItem[];
}

const elapsed = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
};

export default function Cozinha() {
  const { session, loading: authLoading } = useAuth();
  const [cards, setCards] = useState<KdsCard[]>([]);
  const [tick, setTick] = useState(0);

  // re-render every 30s para atualizar "tempo decorrido"
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const { data: pedidos, error } = await supabase
      .from("pedidos")
      .select("id, tipo, status, criado_em, conta_id")
      .in("status", ["pendente", "em_preparo"])
      .order("criado_em", { ascending: true });
    if (error) { toast.error(error.message); return; }
    if (!pedidos?.length) { setCards([]); return; }

    const ids = pedidos.map((p) => p.id);
    const contaIds = Array.from(new Set(pedidos.map((p) => p.conta_id).filter(Boolean))) as string[];

    const [{ data: itens }, { data: contas }, { data: entregas }] = await Promise.all([
      supabase.from("pedido_itens").select("id, pedido_id, quantidade, observacao, produto_id").in("pedido_id", ids),
      contaIds.length ? supabase.from("contas").select("id, mesa_id").in("id", contaIds) : Promise.resolve({ data: [] as any[] }),
      supabase.from("entregas").select("pedido_id, cliente_nome, origem").in("pedido_id", ids),
    ]);

    const prodIds = Array.from(new Set((itens || []).map((i) => i.produto_id).filter(Boolean))) as string[];
    const mesaIds = Array.from(new Set((contas || []).map((c) => c.mesa_id).filter(Boolean))) as string[];

    const [{ data: produtos }, { data: mesas }] = await Promise.all([
      prodIds.length ? supabase.from("produtos").select("id, nome").in("id", prodIds) : Promise.resolve({ data: [] as any[] }),
      mesaIds.length ? supabase.from("mesas").select("id, numero").in("id", mesaIds) : Promise.resolve({ data: [] as any[] }),
    ]);

    const prodMap = new Map((produtos || []).map((p) => [p.id, p.nome as string]));
    const mesaMap = new Map((mesas || []).map((m) => [m.id, m.numero as number]));
    const contaToMesa = new Map((contas || []).map((c) => [c.id, c.mesa_id as string | null]));
    const entregaMap = new Map((entregas || []).map((e) => [e.pedido_id, e]));

    const list: KdsCard[] = pedidos.map((p) => {
      let rotulo = "—";
      let online = false;
      if (p.tipo === "mesa") {
        const mesaId = p.conta_id ? contaToMesa.get(p.conta_id) : null;
        const num = mesaId ? mesaMap.get(mesaId) : null;
        rotulo = num != null ? `Mesa ${String(num).padStart(2, "0")}` : "Mesa";
      } else {
        const e = entregaMap.get(p.id) as any;
        rotulo = e?.cliente_nome ?? "Delivery";
        online = e?.origem === "online";
      }
      const its = (itens || [])
        .filter((i) => i.pedido_id === p.id)
        .map<KdsItem>((i) => ({
          id: i.id,
          nome: i.produto_id ? prodMap.get(i.produto_id) ?? "Item" : "Item",
          quantidade: i.quantidade,
          observacao: i.observacao,
        }));
      return {
        pedido_id: p.id,
        tipo: p.tipo as Tipo,
        status: p.status as Status,
        criado_em: p.criado_em,
        rotulo,
        online,
        itens: its,
      };
    });

    setCards(list);
  }, []);

  useEffect(() => {
    if (!session) return;
    load();
    const ch = supabase
      .channel("kds-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_itens" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "entregas" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, load]);

  const advance = async (c: KdsCard, next: Status) => {
    const { error } = await supabase.from("pedidos").update({ status: next }).eq("id", c.pedido_id);
    if (error) toast.error(error.message);
  };

  const counts = useMemo(() => ({
    pendente: cards.filter((c) => c.status === "pendente").length,
    preparo: cards.filter((c) => c.status === "em_preparo").length,
  }), [cards]);

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center bg-secondary text-secondary-foreground font-display text-2xl">Carregando KDS...</div>;
  }
  if (!session) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-secondary text-secondary-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 bg-gradient-dark shadow-elegant">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-primary p-2.5 rounded-xl shadow-elegant">
              <ChefHat className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-display text-3xl leading-none">COZINHA — KDS</h1>
              <p className="text-xs text-secondary-foreground/60 uppercase tracking-widest mt-1">
                Sistema de exibição de pedidos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 px-4 py-2 rounded-lg bg-white/5 border border-white/10">
              <div className="text-center">
                <div className="font-display text-2xl leading-none text-status-pagamento">{counts.pendente}</div>
                <div className="text-[10px] uppercase tracking-wider text-secondary-foreground/60">Pendentes</div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <div className="font-display text-2xl leading-none text-primary">{counts.preparo}</div>
                <div className="text-[10px] uppercase tracking-wider text-secondary-foreground/60">Em preparo</div>
              </div>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-secondary-foreground/70 hover:text-secondary-foreground hover:bg-white/10">
              <Link to="/mesas"><ArrowLeft className="w-4 h-4 mr-1" /> Sair</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="flex-1 p-6">
        {cards.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-secondary-foreground/50">
            <Flame className="w-16 h-16 mb-4 opacity-40" />
            <h2 className="font-display text-4xl mb-2">Tudo em dia!</h2>
            <p className="text-sm">Nenhum pedido na fila. Novos pedidos aparecem aqui automaticamente.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {cards.map((c) => (
              <KdsCardView key={c.pedido_id} card={c} onAdvance={advance} _tick={tick} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function KdsCardView({
  card, onAdvance, _tick,
}: {
  card: KdsCard;
  onAdvance: (c: KdsCard, next: Status) => void;
  _tick: number;
}) {
  const isMesa = card.tipo === "mesa";
  const Icon = isMesa ? Utensils : Truck;

  // Mesa = âmbar, Delivery = azul
  const palette = isMesa
    ? {
        head: "bg-amber-500 text-amber-950",
        ring: "ring-amber-500/30",
        accent: "text-amber-700 dark:text-amber-300",
        chipBg: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
      }
    : {
        head: "bg-sky-500 text-sky-950",
        ring: "ring-sky-500/30",
        accent: "text-sky-700 dark:text-sky-300",
        chipBg: "bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300",
      };

  const statusLabel = card.status === "pendente" ? "Novo" : "Preparando";

  return (
    <Card
      className={cn(
        "overflow-hidden flex flex-col bg-card text-card-foreground shadow-card ring-2 transition-all",
        palette.ring,
        card.status === "pendente" && "animate-in fade-in zoom-in-95"
      )}
    >
      <div className={cn("flex items-center justify-between px-4 py-3", palette.head)}>
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-5 h-5 shrink-0" />
          <span className="font-display text-2xl truncate leading-none">{card.rotulo}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {card.online && (
            <Badge className="bg-purple-600 hover:bg-purple-600 text-white text-[10px] uppercase tracking-wider border-0">
              Delivery Online
            </Badge>
          )}
          <Badge variant="outline" className="bg-white/30 border-current text-current text-[10px] uppercase tracking-wider">
            {statusLabel}
          </Badge>
        </div>
      </div>

      <div className="px-4 pt-2 pb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {new Date(card.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className={cn("font-semibold", palette.accent)}>{elapsed(card.criado_em)}</span>
      </div>

      <ul className="px-4 py-3 space-y-2 flex-1 max-h-72 overflow-y-auto">
        {card.itens.map((it) => (
          <li key={it.id} className="flex items-start gap-3">
            <span className={cn("font-display text-xl leading-none w-8 text-right shrink-0", palette.accent)}>
              {it.quantidade}×
            </span>
            <div className="min-w-0">
              <div className="font-semibold leading-tight">{it.nome}</div>
              {it.observacao && (
                <div className={cn("mt-0.5 inline-block text-xs px-2 py-0.5 rounded border", palette.chipBg)}>
                  ↳ {it.observacao}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="p-3 border-t bg-muted/40 grid grid-cols-1">
        {card.status === "pendente" ? (
          <Button size="lg" className="font-display text-lg tracking-wider" onClick={() => onAdvance(card, "em_preparo")}>
            <Flame className="w-4 h-4 mr-2" /> Iniciar preparo
          </Button>
        ) : (
          <Button
            size="lg"
            variant="default"
            className="font-display text-lg tracking-wider bg-status-livre hover:bg-status-livre/90 text-white"
            onClick={() => onAdvance(card, "pronto")}
          >
            ✓ Pronto
          </Button>
        )}
      </div>
    </Card>
  );
}
