import { useEffect, useState, useCallback } from "react";
import { Mesa, Conta, Pedido, PedidoItem, Produto } from "@/types/db";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import NovoPedidoDialog from "./NovoPedidoDialog";
import { Plus, Receipt, Clock, Printer } from "lucide-react";
import { printReceipt } from "@/lib/print";

type ItemAdicional = { nome: string; quantidade: number; preco_unitario: number };
type ItemDetalhado = PedidoItem & { produto: Produto | null; adicionais: ItemAdicional[] };
type PedidoComItens = Pedido & {
  itens: ItemDetalhado[];
  resgate: {
    id: string;
    nome: string;
    status: "pendente" | "aplicado" | "cancelado";
  } | null;
};

const statusLabel: Record<Pedido["status"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  pendente: { label: "Pendente", variant: "outline" },
  em_preparo: { label: "Em preparo", variant: "secondary" },
  pronto: { label: "Pronto", variant: "default" },
  entregue: { label: "Entregue", variant: "default" },
  cancelado: { label: "Cancelado", variant: "outline" },
};

export default function ContaSheet({ mesa, onClose, onClosed }: { mesa: Mesa | null; onClose: () => void; onClosed?: () => void }) {
  const [conta, setConta] = useState<Conta | null>(null);
  const [pedidos, setPedidos] = useState<PedidoComItens[]>([]);
  const [novoOpen, setNovoOpen] = useState(false);
  const [confirmFechar, setConfirmFechar] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!mesa) return;
    const { data: c } = await supabase
      .from("contas").select("*")
      .eq("mesa_id", mesa.id).eq("status", "aberta")
      .order("aberta_em", { ascending: false }).limit(1).maybeSingle();

    if (!c) { setConta(null); setPedidos([]); return; }
    setConta(c as Conta);

    const { data: peds } = await supabase
      .from("pedidos").select("*").eq("conta_id", c.id).order("criado_em");
    const pedList = (peds || []) as Pedido[];

    if (!pedList.length) { setPedidos([]); return; }

    const ids = pedList.map((p) => p.id);
    const [{ data: itens }, { data: resgates }] = await Promise.all([
      supabase.from("pedido_itens").select("*").in("pedido_id", ids),
      supabase.from("resgates").select("id, pedido_id, recompensa_id, status").in("pedido_id", ids),
    ]);
    const itensList = (itens || []) as PedidoItem[];
    const prodIds = Array.from(new Set(itensList.map((i) => i.produto_id).filter(Boolean))) as string[];
    const itemIds = itensList.map((i) => i.id);
    const rewardIds = Array.from(new Set((resgates || []).map((resgate) => resgate.recompensa_id)));

    const [{ data: prods }, { data: itemAdicionais }, { data: rewards }] = await Promise.all([
      prodIds.length
        ? supabase.from("produtos").select("*").in("id", prodIds)
        : Promise.resolve({ data: [] as Produto[] }),
      itemIds.length
        ? supabase.from("pedido_item_adicionais").select("pedido_item_id, adicional_id, quantidade, preco_unitario").in("pedido_item_id", itemIds)
        : Promise.resolve({ data: [] as { pedido_item_id: string; adicional_id: string; quantidade: number; preco_unitario: number }[] }),
      rewardIds.length
        ? supabase.from("recompensas").select("id, nome").in("id", rewardIds)
        : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    ]);

    const adicionalIds = Array.from(new Set((itemAdicionais || []).map((a) => a.adicional_id).filter(Boolean)));
    const { data: adicionais } = adicionalIds.length
      ? await supabase.from("adicionais").select("id, nome").in("id", adicionalIds)
      : { data: [] as { id: string; nome: string }[] };

    const prodMap = new Map((prods || []).map((p) => [p.id, p as Produto]));
    const adicionalMap = new Map((adicionais || []).map((a) => [a.id, a.nome]));
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
    const adPorItem = new Map<string, ItemAdicional[]>();
    (itemAdicionais || []).forEach((row) => {
      const cur = adPorItem.get(row.pedido_item_id) ?? [];
      cur.push({
        nome: adicionalMap.get(row.adicional_id) ?? "Adicional",
        quantidade: row.quantidade,
        preco_unitario: Number(row.preco_unitario),
      });
      adPorItem.set(row.pedido_item_id, cur);
    });

    setPedidos(pedList.map((p) => ({
      ...p,
      resgate: resgateMap.get(p.id) || null,
      itens: itensList
        .filter((i) => i.pedido_id === p.id)
        .map((i) => ({
          ...i,
          produto: i.produto_id ? prodMap.get(i.produto_id) ?? null : null,
          adicionais: adPorItem.get(i.id) ?? [],
        })),
    })));
  }, [mesa]);

  useEffect(() => { if (mesa) load(); }, [mesa, load]);

  // Realtime sobre pedidos/itens da conta atual
  useEffect(() => {
    if (!conta) return;
    const ch = supabase
      .channel(`conta-${conta.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: `conta_id=eq.${conta.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "pedido_itens" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "resgates" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conta, load]);

  const total = pedidos.reduce(
    (s, p) => s + p.itens.reduce((si, i) => si + Number(i.preco_unitario) * i.quantidade, 0),
    0
  );

  const handlePrint = () => {
    if (!mesa || !pedidos.length) return;
    printReceipt({
      tipo: "mesa",
      mesa_numero: mesa.numero,
      pedidos: pedidos.map((p, idx) => ({
        numero: idx + 1,
        criado_em: p.criado_em,
        itens: p.itens.map((i) => ({
          nome: i.produto?.nome ?? "Item",
          quantidade: i.quantidade,
          preco_unitario: Number(i.preco_unitario),
          observacao: i.observacao,
          adicionais: i.adicionais,
        })),
      })),
      total,
    });
  };

  const handleFechar = async () => {
    if (!conta || !mesa) return;
    setBusy(true);
    const { error: e1 } = await supabase
      .from("contas")
      .update({ status: "fechada", fechada_em: new Date().toISOString(), total })
      .eq("id", conta.id);
    if (e1) { setBusy(false); return toast.error(e1.message); }

    const { error: e2 } = await supabase
      .from("mesas").update({ status: "livre" }).eq("id", mesa.id);
    setBusy(false);
    if (e2) return toast.error(e2.message);

    toast.success(`Mesa ${mesa.numero} fechada — ${brl(total)}`);
    setConfirmFechar(false);
    onClose();
    // Recarrega mesas após sucesso
    onClosed?.();
  };

  const updateResgateStatus = async (resgateId: string, status: "aplicado" | "cancelado") => {
    const { error } = await supabase.from("resgates").update({ status }).eq("id", resgateId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(status === "aplicado" ? "Recompensa confirmada" : "Resgate cancelado");
    await load();
  };

  return (
    <>
      <Sheet open={!!mesa} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
          <SheetHeader className="p-6 pb-3 border-b bg-gradient-hero text-primary-foreground">
            <SheetTitle className="font-display text-4xl text-primary-foreground">
              Mesa {mesa?.numero}
            </SheetTitle>
            <SheetDescription className="text-primary-foreground/70">
              {conta ? `Conta aberta em ${new Date(conta.aberta_em).toLocaleString("pt-BR")}` : "Carregando..."}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="p-6 space-y-4">
              {pedidos.length === 0 && (
                <Card className="p-8 text-center border-dashed">
                  <Receipt className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhum pedido ainda</p>
                </Card>
              )}

              {pedidos.map((p, idx) => {
                const subtotal = p.itens.reduce((s, i) => s + Number(i.preco_unitario) * i.quantidade, 0);
                return (
                  <Card key={p.id} className="p-4 shadow-soft">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-xl">Pedido #{idx + 1}</span>
                        <Badge variant={statusLabel[p.status].variant}>{statusLabel[p.status].label}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(p.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {p.resgate && (
                      <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs uppercase tracking-wider text-amber-700">🎁 Recompensa aplicada</div>
                            <div className="font-semibold text-amber-950">{p.resgate.nome}</div>
                          </div>
                          <Badge variant="outline">{p.resgate.status}</Badge>
                        </div>
                        {p.resgate.status === "pendente" && (
                          <div className="mt-3 flex gap-2">
                            <Button size="sm" onClick={() => updateResgateStatus(p.resgate!.id, "aplicado")}>Confirmar aplicacao</Button>
                            <Button size="sm" variant="outline" onClick={() => updateResgateStatus(p.resgate!.id, "cancelado")}>Cancelar resgate</Button>
                          </div>
                        )}
                      </div>
                    )}
                    <ul className="space-y-2">
                      {p.itens.map((i) => (
                        <li key={i.id} className="flex justify-between gap-3 text-sm">
                          <div className="flex-1">
                            <div>
                              <span className="font-medium">{i.quantidade}×</span>{" "}
                              {i.produto?.nome ?? "Produto removido"}
                            </div>
                            {i.adicionais.map((a, ai) => (
                              <div key={ai} className="text-xs text-muted-foreground pl-3">
                                +{a.quantidade}x {a.nome}
                              </div>
                            ))}
                            {i.observacao && (
                              <div className="text-xs text-muted-foreground italic pl-3">↳ {i.observacao}</div>
                            )}
                          </div>
                          <span className="text-muted-foreground whitespace-nowrap">
                            {brl(Number(i.preco_unitario) * i.quantidade)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex justify-between mt-3 pt-3 border-t text-sm font-semibold">
                      <span>Subtotal</span><span>{brl(subtotal)}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>

          <div className="border-t bg-card p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">Total</span>
              <span className="font-display text-4xl text-primary">{brl(total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => setNovoOpen(true)} disabled={!conta}>
                <Plus className="h-4 w-4 mr-1" /> Novo pedido
              </Button>
              <Button variant="outline" onClick={handlePrint} disabled={!conta || !pedidos.length}>
                <Printer className="h-4 w-4 mr-1" /> Imprimir
              </Button>
              <Button onClick={() => setConfirmFechar(true)} disabled={!conta || !pedidos.length}>
                Fechar conta
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {conta && (
        <NovoPedidoDialog
          open={novoOpen}
          contaId={conta.id}
          mesaNumero={mesa?.numero}
          onClose={() => setNovoOpen(false)}
          onCreated={() => { setNovoOpen(false); load(); }}
        />
      )}

      <AlertDialog open={confirmFechar} onOpenChange={setConfirmFechar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Fechar conta da mesa {mesa?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              Total a cobrar: <span className="font-semibold text-foreground">{brl(total)}</span>.
              A mesa voltará a ficar livre.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleFechar} disabled={busy}>
              {busy ? "Fechando..." : "Confirmar fechamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
