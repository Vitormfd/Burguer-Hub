import { useEffect, useState, useCallback } from "react";
import { Truck, Plus, Phone, MapPin, Clock, Bike, CheckCircle2, Package, Printer, Store, Flame, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import NovoDeliveryDialog from "@/components/delivery/NovoDeliveryDialog";
import EditarPedidoDialog from "@/components/pedidos/EditarPedidoDialog";
import { pedidoEditavel } from "@/lib/pedidoEdit";
import { printReceipt } from "@/lib/print";
import { sendWhatsapp } from "@/lib/whatsapp";
import type { PedidoStatus } from "@/types/db";

type EntregaStatus = "aguardando" | "saiu_para_entrega" | "entregue";
type EntregaTipo = "delivery" | "retirada";
type FiltroTipo = "todos" | EntregaTipo;
type PedidoStatusAtivo = Extract<PedidoStatus, "pendente" | "em_preparo" | "pronto" | "entregue">;

interface DeliveryRow {
  entrega_id: string;
  pedido_id: string;
  tipo_entrega: EntregaTipo;
  pedido_status: PedidoStatusAtivo;
  cliente_nome: string;
  cliente_telefone: string;
  endereco: string;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  taxa_entrega: number;
  status: EntregaStatus;
  criado_em: string;
  itens_total: number;
  resgate: {
    id: string;
    nome: string;
    status: "pendente" | "aplicado" | "cancelado";
  } | null;
}

const pedidoStatusCfg: Record<
  Extract<PedidoStatusAtivo, "pendente" | "em_preparo" | "pronto">,
  { label: string; color: string; next: PedidoStatusAtivo | null; nextLabel: string }
> = {
  pendente: {
    label: "Novo",
    color: "bg-amber-100 text-amber-800 border-amber-200",
    next: "em_preparo",
    nextLabel: "Iniciar preparo",
  },
  em_preparo: {
    label: "Em preparo",
    color: "bg-orange-100 text-orange-800 border-orange-200",
    next: "pronto",
    nextLabel: "Marcar pronto",
  },
  pronto: {
    label: "Pronto",
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    next: null,
    nextLabel: "",
  },
};

const statusCfgDelivery: Record<EntregaStatus, { label: string; icon: typeof Clock; color: string; next: EntregaStatus | null; nextLabel: string }> = {
  aguardando:        { label: "Aguardando",        icon: Clock,         color: "bg-status-pagamento/20 text-status-pagamento border-status-pagamento/30", next: "saiu_para_entrega", nextLabel: "Saiu para entrega" },
  saiu_para_entrega: { label: "Saiu para entrega", icon: Bike,          color: "bg-status-ocupada/20 text-status-ocupada border-status-ocupada/30",       next: "entregue",          nextLabel: "Marcar entregue" },
  entregue:          { label: "Entregue",          icon: CheckCircle2,  color: "bg-status-livre/20 text-status-livre border-status-livre/30",             next: null,                nextLabel: "" },
};

const statusCfgRetirada: Record<EntregaStatus, { label: string; icon: typeof Clock; color: string; next: EntregaStatus | null; nextLabel: string }> = {
  aguardando:        { label: "Em preparo",         icon: Clock,         color: "bg-blue-100 text-blue-700 border-blue-200", next: "saiu_para_entrega", nextLabel: "Marcar pronto p/ retirada" },
  saiu_para_entrega: { label: "Pronto p/ retirada", icon: Store,         color: "bg-blue-200 text-blue-800 border-blue-300", next: "entregue",          nextLabel: "Marcar retirado" },
  entregue:          { label: "Retirado",           icon: CheckCircle2,  color: "bg-emerald-100 text-emerald-700 border-emerald-200", next: null,        nextLabel: "" },
};

const getStatusCfg = (row: DeliveryRow) => row.tipo_entrega === "retirada" ? statusCfgRetirada[row.status] : statusCfgDelivery[row.status];

export default function Delivery() {
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoOpen, setNovoOpen] = useState(false);
  const [editRow, setEditRow] = useState<DeliveryRow | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");
  const notifyItemCancelado = useCallback(async (payload: { new?: { cancelado?: boolean; produto_id?: string | null; pedido_id?: string }; old?: { cancelado?: boolean } }) => {
    const current = payload?.new;
    const previous = payload?.old;
    if (!current?.cancelado || previous?.cancelado || !current.pedido_id) return;

    const [{ data: produto }, { data: entrega }] = await Promise.all([
      current.produto_id
        ? supabase.from("produtos").select("nome").eq("id", current.produto_id).maybeSingle()
        : Promise.resolve({ data: null as { nome: string } | null }),
      supabase.from("entregas").select("cliente_nome").eq("pedido_id", current.pedido_id).maybeSingle(),
    ]);

    const rotulo = entrega?.cliente_nome || "Delivery";
    const nomeItem = produto?.nome || "Item";
    toast.error(`Item cancelado: ${nomeItem} — ${rotulo}`);
  }, []);

  const load = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data: pedidos, error } = await supabase
      .from("pedidos")
      .select("id, criado_em, tipo_entrega, status")
      .eq("tipo", "delivery")
      .gte("criado_em", startOfDay.toISOString())
      .order("criado_em", { ascending: false });

    if (error) { toast.error(error.message); setLoading(false); return; }
    const pedidoIds = (pedidos || []).map((p) => p.id);
    if (!pedidoIds.length) {
      setRows([]);
      setLoading(false);
      return;
    }

    const [{ data: entregas }, { data: itens }, { data: resgates }] = await Promise.all([
      supabase.from("entregas").select("*").in("pedido_id", pedidoIds),
      supabase.from("pedido_itens").select("pedido_id, quantidade, preco_unitario").in("pedido_id", pedidoIds),
      supabase.from("resgates").select("id, pedido_id, recompensa_id, status").in("pedido_id", pedidoIds),
    ]);

    const rewardIds = Array.from(new Set((resgates || []).map((item) => item.recompensa_id)));
    const { data: rewards } = rewardIds.length
      ? await supabase.from("recompensas").select("id, nome").in("id", rewardIds)
      : { data: [] as { id: string; nome: string }[] };

    const totals = new Map<string, number>();
    (itens || []).forEach((i) => {
      totals.set(i.pedido_id, (totals.get(i.pedido_id) || 0) + Number(i.preco_unitario) * i.quantidade);
    });

    const rewardMap = new Map((rewards || []).map((reward) => [reward.id, reward.nome as string]));
    const resgateMap = new Map(
      (resgates || []).map((resgate) => [
        resgate.pedido_id,
        {
          id: resgate.id,
          nome: rewardMap.get(resgate.recompensa_id) || "Recompensa",
          status: resgate.status as "pendente" | "aplicado" | "cancelado",
        },
      ])
    );

    const list: DeliveryRow[] = (entregas || []).map((e) => {
      const ped = pedidos!.find((p) => p.id === e.pedido_id)!;
      return {
        entrega_id: e.id,
        pedido_id: e.pedido_id,
        tipo_entrega: (ped.tipo_entrega as EntregaTipo) || "delivery",
        pedido_status: (ped.status as PedidoStatusAtivo) || "pendente",
        cliente_nome: e.cliente_nome,
        cliente_telefone: e.cliente_telefone,
        endereco: e.endereco,
        numero: e.numero,
        complemento: e.complemento,
        bairro: e.bairro,
        taxa_entrega: Number(e.taxa_entrega),
        status: e.status as EntregaStatus,
        criado_em: ped.criado_em,
        itens_total: totals.get(e.pedido_id) || 0,
        resgate: resgateMap.get(e.pedido_id) || null,
      };
    }).sort((a, b) => +new Date(b.criado_em) - +new Date(a.criado_em));

    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => {
      void load();
    }, 15000);

    const ch = supabase
      .channel("delivery-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "entregas" }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: "tipo=eq.delivery" }, () => { void load(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedido_itens" }, (payload) => {
        void notifyItemCancelado(payload);
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_itens" }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "resgates" }, () => { void load(); })
      .subscribe();

    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [load, notifyItemCancelado]);

  const printDeliveryCard = useCallback(async (row: DeliveryRow) => {
    const { data: itens } = await supabase
      .from("pedido_itens")
      .select("id, quantidade, preco_unitario, observacao, produto_id")
      .eq("pedido_id", row.pedido_id);

    const itensList = itens || [];
    const prodIds = Array.from(new Set(itensList.map((i) => i.produto_id).filter(Boolean))) as string[];
    const itemIds = itensList.map((i) => i.id);

    const [{ data: produtos }, { data: itemAdicionais }, { data: cfgData }] = await Promise.all([
      prodIds.length
        ? supabase.from("produtos").select("id, nome").in("id", prodIds)
        : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
      itemIds.length
        ? supabase.from("pedido_item_adicionais").select("pedido_item_id, adicional_id, quantidade, preco_unitario").in("pedido_item_id", itemIds)
        : Promise.resolve({ data: [] as { pedido_item_id: string; adicional_id: string; quantidade: number; preco_unitario: number }[] }),
      supabase.from("configuracoes").select("*").limit(1).maybeSingle(),
    ]);

    const adicionalIds = Array.from(new Set((itemAdicionais || []).map((a) => a.adicional_id).filter(Boolean)));
    const { data: adicionais } = adicionalIds.length
      ? await supabase.from("adicionais").select("id, nome").in("id", adicionalIds)
      : { data: [] as { id: string; nome: string }[] };

    const prodMap = new Map((produtos || []).map((p) => [p.id, p.nome as string]));
    const adicionalMap = new Map((adicionais || []).map((a) => [a.id, a.nome as string]));
    const adPorItem = new Map<string, { nome: string; quantidade: number; preco_unitario: number }[]>();
    (itemAdicionais || []).forEach((a) => {
      const cur = adPorItem.get(a.pedido_item_id) ?? [];
      cur.push({ nome: adicionalMap.get(a.adicional_id) ?? "Adicional", quantidade: a.quantidade, preco_unitario: Number(a.preco_unitario) });
      adPorItem.set(a.pedido_item_id, cur);
    });

    const { data: entrega } = await supabase
      .from("entregas")
      .select("forma_pagamento, troco_para")
      .eq("id", row.entrega_id)
      .maybeSingle();

    printReceipt({
      tipo: row.tipo_entrega,
      loja_nome: (cfgData as any)?.nome_loja,
      cliente_nome: row.cliente_nome,
      cliente_telefone: row.cliente_telefone,
      endereco: row.endereco,
      numero: row.numero,
      complemento: row.complemento,
      bairro: row.bairro,
      taxa_entrega: row.taxa_entrega,
      forma_pagamento: (entrega as { forma_pagamento?: string | null } | null)?.forma_pagamento ?? null,
      troco_para: (entrega as { troco_para?: number | null } | null)?.troco_para != null
        ? Number((entrega as { troco_para: number }).troco_para)
        : null,
      itens: itensList.map((i) => ({
        nome: i.produto_id ? prodMap.get(i.produto_id) ?? "Item" : "Item",
        quantidade: i.quantidade,
        preco_unitario: Number(i.preco_unitario),
        observacao: i.observacao,
        adicionais: adPorItem.get(i.id) ?? [],
      })),
      subtotal: row.itens_total,
      total: row.itens_total + row.taxa_entrega,
      criado_em: row.criado_em,
    });
  }, []);

  const advancePedido = async (row: DeliveryRow) => {
    const cfg = pedidoStatusCfg[row.pedido_status as keyof typeof pedidoStatusCfg];
    if (!cfg?.next) return;

    const { error } = await supabase.from("pedidos").update({ status: cfg.next }).eq("id", row.pedido_id);
    if (error) {
      toast.error(error.message);
      return;
    }

    if (row.cliente_telefone) {
      if (cfg.next === "em_preparo") {
        sendWhatsapp(row.pedido_id, "em_preparo", row.cliente_telefone, {
          nome: row.cliente_nome,
        });
      } else if (cfg.next === "pronto" && row.tipo_entrega === "retirada") {
        sendWhatsapp(row.pedido_id, "retirada_pronto", row.cliente_telefone, {
          nome: row.cliente_nome,
        });
      }
    }

    toast.success(
      cfg.next === "em_preparo"
        ? "Pedido em preparo"
        : "Pedido pronto"
    );
    await load();
  };

  const advance = async (row: DeliveryRow) => {
    const cfg = getStatusCfg(row);
    if (!cfg.next) return;
    const { error } = await supabase
      .from("entregas").update({ status: cfg.next }).eq("id", row.entrega_id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Entrega: ${(row.tipo_entrega === "retirada" ? statusCfgRetirada : statusCfgDelivery)[cfg.next].label}`);

    // Enviar WhatsApp conforme o status e tipo de entrega
    if (row.cliente_telefone) {
      if (cfg.next === "saiu_para_entrega" && row.tipo_entrega === "delivery") {
        sendWhatsapp(row.pedido_id, "saiu_entrega", row.cliente_telefone, {
          nome: row.cliente_nome,
        });
      } else if (
        cfg.next === "saiu_para_entrega"
        && row.tipo_entrega === "retirada"
        && row.pedido_status !== "pronto"
      ) {
        sendWhatsapp(row.pedido_id, "retirada_pronto", row.cliente_telefone, {
          nome: row.cliente_nome,
        });
      } else if (cfg.next === "entregue" && row.tipo_entrega === "delivery") {
        sendWhatsapp(row.pedido_id, "entregue", row.cliente_telefone, {
          nome: row.cliente_nome,
        });
      }
    }

    // Recarregar imediatamente para garantir atualização visual
    await load();
  };

  const rowsFiltrados = rows.filter((row) => filtroTipo === "todos" ? true : row.tipo_entrega === filtroTipo);

  const updateResgateStatus = async (row: DeliveryRow, status: "aplicado" | "cancelado") => {
    if (!row.resgate) return;
    const { error } = await supabase.from("resgates").update({ status }).eq("id", row.resgate.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(status === "aplicado" ? "Recompensa confirmada" : "Resgate cancelado");
    await load();
  };

  const counts = {
    pedidoPendente: rowsFiltrados.filter((r) => r.pedido_status === "pendente").length,
    pedidoPreparo: rowsFiltrados.filter((r) => r.pedido_status === "em_preparo").length,
    aguardando: rowsFiltrados.filter((r) => r.status === "aguardando").length,
    saiu: rowsFiltrados.filter((r) => r.status === "saiu_para_entrega").length,
    entregue: rowsFiltrados.filter((r) => r.status === "entregue").length,
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="p-4 flex items-center gap-3 shadow-soft">
          <div className="p-2 rounded-lg bg-amber-100"><Flame className="w-5 h-5 text-amber-700" /></div>
          <div><div className="font-display text-3xl leading-none">{counts.pedidoPendente}</div><div className="text-xs text-muted-foreground">Novos</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3 shadow-soft">
          <div className="p-2 rounded-lg bg-orange-100"><Clock className="w-5 h-5 text-orange-700" /></div>
          <div><div className="font-display text-3xl leading-none">{counts.pedidoPreparo}</div><div className="text-xs text-muted-foreground">Em preparo</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3 shadow-soft">
          <div className="p-2 rounded-lg bg-status-pagamento/20"><Clock className="w-5 h-5 text-status-pagamento" /></div>
          <div><div className="font-display text-3xl leading-none">{counts.aguardando}</div><div className="text-xs text-muted-foreground">Aguardando envio</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3 shadow-soft">
          <div className="p-2 rounded-lg bg-status-ocupada/20"><Bike className="w-5 h-5 text-status-ocupada" /></div>
          <div><div className="font-display text-3xl leading-none">{counts.saiu}</div><div className="text-xs text-muted-foreground">A caminho</div></div>
        </Card>
        <Card className="p-4 flex items-center gap-3 shadow-soft col-span-2 sm:col-span-1">
          <div className="p-2 rounded-lg bg-status-livre/20"><CheckCircle2 className="w-5 h-5 text-status-livre" /></div>
          <div><div className="font-display text-3xl leading-none">{counts.entregue}</div><div className="text-xs text-muted-foreground">Entregues</div></div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={filtroTipo === "todos" ? "default" : "outline"} size="sm" onClick={() => setFiltroTipo("todos")}>Todos</Button>
        <Button variant={filtroTipo === "delivery" ? "default" : "outline"} size="sm" onClick={() => setFiltroTipo("delivery")}>
          <Bike className="h-3.5 w-3.5 mr-1" /> Delivery
        </Button>
        <Button variant={filtroTipo === "retirada" ? "default" : "outline"} size="sm" onClick={() => setFiltroTipo("retirada")}>
          <Store className="h-3.5 w-3.5 mr-1" /> Retirada
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : rowsFiltrados.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Nenhum pedido para o filtro selecionado.</p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rowsFiltrados.map((r) => {
            const cfg = getStatusCfg(r);
            const pedidoCfg =
              r.pedido_status === "entregue"
                ? null
                : pedidoStatusCfg[r.pedido_status as keyof typeof pedidoStatusCfg];
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
                  <div className="flex flex-col items-end gap-1">
                    {pedidoCfg && (
                      <Badge variant="outline" className={pedidoCfg.color}>
                        {pedidoCfg.label}
                      </Badge>
                    )}
                    <Badge variant="outline" className={cfg.color}>
                      <Icon className="h-3 w-3 mr-1" />{cfg.label}
                    </Badge>
                  </div>
                </div>

                <Badge
                  variant="outline"
                  className={r.tipo_entrega === "retirada" ? "w-fit border-blue-300 bg-blue-100 text-blue-800" : "w-fit border-sky-300 bg-sky-100 text-sky-800"}
                >
                  {r.tipo_entrega === "retirada" ? "Retirada 🏃" : "Delivery 🛵"}
                </Badge>

                <div className="space-y-1.5 text-sm">
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{r.cliente_telefone}</span>
                  </div>
                  {r.tipo_entrega === "delivery" ? (
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        {r.endereco}
                        {r.numero ? `, ${r.numero}` : ""}
                        {r.complemento ? ` - ${r.complemento}` : ""}
                        {r.bairro ? ` — ${r.bairro}` : ""}
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
                      Cliente retira no balcao.
                    </div>
                  )}
                </div>

                {r.resgate && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-amber-700">🎁 Recompensa aplicada</div>
                        <div className="font-semibold text-amber-950">{r.resgate.nome}</div>
                      </div>
                      <Badge variant="outline">{r.resgate.status}</Badge>
                    </div>
                    {r.resgate.status === "pendente" && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => updateResgateStatus(r, "aplicado")}>Confirmar aplicacao</Button>
                        <Button size="sm" variant="outline" onClick={() => updateResgateStatus(r, "cancelado")}>Cancelar resgate</Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 pt-3 border-t text-sm">
                  <div><div className="text-xs text-muted-foreground">Itens</div><div className="font-semibold">{brl(r.itens_total)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Taxa</div><div className="font-semibold">{brl(r.tipo_entrega === "retirada" ? 0 : r.taxa_entrega)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Total</div><div className="font-display text-lg text-primary">{brl(total)}</div></div>
                </div>

                {pedidoCfg?.next && (
                  <Button onClick={() => advancePedido(r)} className="mt-auto" size="sm" variant="secondary">
                    <Flame className="h-3.5 w-3.5 mr-1" />
                    {pedidoCfg.nextLabel}
                  </Button>
                )}
                {cfg.next && (
                  <Button onClick={() => advance(r)} className={pedidoCfg?.next ? "" : "mt-auto"} size="sm">
                    {cfg.nextLabel}
                  </Button>
                )}
                {pedidoEditavel(r.pedido_status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    onClick={() => setEditRow(r)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Editar pedido
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => printDeliveryCard(r)}
                >
                  <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir notinha
                </Button>
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

      <EditarPedidoDialog
        open={!!editRow}
        pedidoId={editRow?.pedido_id ?? null}
        variant="delivery"
        tipoEntrega={editRow?.tipo_entrega ?? "delivery"}
        onClose={() => setEditRow(null)}
        onSaved={() => load()}
      />
    </div>
  );
}
