import { useEffect, useState, useCallback } from "react";
import { Truck, Plus, Phone, MapPin, Clock, Bike, CheckCircle2, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import NovoDeliveryDialog from "@/components/delivery/NovoDeliveryDialog";

type EntregaStatus = "aguardando" | "saiu_para_entrega" | "entregue";

interface DeliveryRow {
  entrega_id: string;
  pedido_id: string;
  cliente_nome: string;
  cliente_telefone: string;
  endereco: string;
  bairro: string | null;
  taxa_entrega: number;
  status: EntregaStatus;
  criado_em: string;
  itens_total: number;
}

const statusCfg: Record<EntregaStatus, { label: string; icon: typeof Clock; color: string; next: EntregaStatus | null; nextLabel: string }> = {
  aguardando:        { label: "Aguardando",        icon: Clock,         color: "bg-status-pagamento/20 text-status-pagamento border-status-pagamento/30", next: "saiu_para_entrega", nextLabel: "Saiu para entrega" },
  saiu_para_entrega: { label: "Saiu para entrega", icon: Bike,          color: "bg-status-ocupada/20 text-status-ocupada border-status-ocupada/30",       next: "entregue",          nextLabel: "Marcar entregue" },
  entregue:          { label: "Entregue",          icon: CheckCircle2,  color: "bg-status-livre/20 text-status-livre border-status-livre/30",             next: null,                nextLabel: "" },
};

export default function Delivery() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoOpen, setNovoOpen] = useState(false);

  const load = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data: pedidos, error } = await supabase
      .from("pedidos")
      .select("id, criado_em")
      .eq("tipo", "delivery")
      .gte("criado_em", startOfDay.toISOString())
      .order("criado_em", { ascending: false });

    if (error) { toast.error(error.message); setLoading(false); return; }
    const pedidoIds = (pedidos || []).map((p) => p.id);
    if (!pedidoIds.length) { setRows([]); setLoading(false); return; }

    const [{ data: entregas }, { data: itens }] = await Promise.all([
      supabase.from("entregas").select("*").in("pedido_id", pedidoIds),
      supabase.from("pedido_itens").select("pedido_id, quantidade, preco_unitario").in("pedido_id", pedidoIds),
    ]);

    const totals = new Map<string, number>();
    (itens || []).forEach((i) => {
      totals.set(i.pedido_id, (totals.get(i.pedido_id) || 0) + Number(i.preco_unitario) * i.quantidade);
    });

    const list: DeliveryRow[] = (entregas || []).map((e) => {
      const ped = pedidos!.find((p) => p.id === e.pedido_id)!;
      return {
        entrega_id: e.id,
        pedido_id: e.pedido_id,
        cliente_nome: e.cliente_nome,
        cliente_telefone: e.cliente_telefone,
        endereco: e.endereco,
        bairro: e.bairro,
        taxa_entrega: Number(e.taxa_entrega),
        status: e.status as EntregaStatus,
        criado_em: ped.criado_em,
        itens_total: totals.get(e.pedido_id) || 0,
      };
    }).sort((a, b) => +new Date(b.criado_em) - +new Date(a.criado_em));

    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("delivery-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "entregas" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: "tipo=eq.delivery" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_itens" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const advance = async (row: DeliveryRow) => {
    const cfg = statusCfg[row.status];
    if (!cfg.next) return;
    const { error } = await supabase
      .from("entregas").update({ status: cfg.next }).eq("id", row.entrega_id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Entrega: ${statusCfg[cfg.next].label}`);
    // Recarregar imediatamente para garantir atualização visual
    await load();
  };

  const counts = {
    aguardando: rows.filter((r) => r.status === "aguardando").length,
    saiu: rows.filter((r) => r.status === "saiu_para_entrega").length,
    entregue: rows.filter((r) => r.status === "entregue").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-foreground flex items-center gap-3">
            <Truck className="w-8 h-8 text-primary" /> Delivery
          </h1>
          <p className="text-muted-foreground mt-1">Pedidos do dia em tempo real</p>
        </div>
        <Button size="lg" onClick={() => setNovoOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo delivery
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 flex items-center gap-3 shadow-soft">
          <div className="p-2 rounded-lg bg-status-pagamento/20"><Clock className="w-5 h-5 text-status-pagamento" /></div>
          <div><div className="font-display text-3xl leading-none">{counts.aguardando}</div><div className="text-xs text-muted-foreground">Aguardando</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3 shadow-soft">
          <div className="p-2 rounded-lg bg-status-ocupada/20"><Bike className="w-5 h-5 text-status-ocupada" /></div>
          <div><div className="font-display text-3xl leading-none">{counts.saiu}</div><div className="text-xs text-muted-foreground">A caminho</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3 shadow-soft">
          <div className="p-2 rounded-lg bg-status-livre/20"><CheckCircle2 className="w-5 h-5 text-status-livre" /></div>
          <div><div className="font-display text-3xl leading-none">{counts.entregue}</div><div className="text-xs text-muted-foreground">Entregues</div></div>
        </Card>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : rows.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Nenhum delivery hoje. Cadastre o primeiro pedido!</p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((r) => {
            const cfg = statusCfg[r.status];
            const Icon = cfg.icon;
            const total = r.itens_total + r.taxa_entrega;
            return (
              <Card key={r.entrega_id} className="p-5 shadow-card flex flex-col gap-3 hover:shadow-elegant transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-xl leading-tight">{r.cliente_nome}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {new Date(r.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <Badge variant="outline" className={cfg.color}>
                    <Icon className="h-3 w-3 mr-1" />{cfg.label}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-sm">
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{r.cliente_telefone}</span>
                  </div>
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{r.endereco}{r.bairro ? ` — ${r.bairro}` : ""}</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-3 border-t text-sm">
                  <div><div className="text-xs text-muted-foreground">Itens</div><div className="font-semibold">{brl(r.itens_total)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Taxa</div><div className="font-semibold">{brl(r.taxa_entrega)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Total</div><div className="font-display text-lg text-primary">{brl(total)}</div></div>
                </div>

                {cfg.next && (
                  <Button onClick={() => advance(r)} className="mt-auto" size="sm">
                    {cfg.nextLabel}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <NovoDeliveryDialog
        open={novoOpen}
        onClose={() => setNovoOpen(false)}
        onCreated={() => { setNovoOpen(false); load(); }}
      />
    </div>
  );
}
