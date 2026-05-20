import { useEffect, useState, useCallback } from "react";
import { Mesa, Conta, Pedido, PedidoItem, Produto, Configuracao } from "@/types/db";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import NovoPedidoDialog from "./NovoPedidoDialog";
import { Plus, Receipt, Clock, Printer, XCircle, AlertTriangle } from "lucide-react";
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

type MotivoCancelamento = "Erro do atendente" | "Cliente desistiu" | "Item indispon�vel" | "Outro";

const MOTIVOS_CANCELAMENTO: MotivoCancelamento[] = [
  "Erro do atendente",
  "Cliente desistiu",
  "Item indispon�vel",
  "Outro",
];

const statusLabel: Record<Pedido["status"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  pendente: { label: "Pendente", variant: "outline" },
  em_preparo: { label: "Em preparo", variant: "secondary" },
  pronto: { label: "Pronto", variant: "default" },
  entregue: { label: "Entregue", variant: "default" },
  cancelado: { label: "Cancelado", variant: "outline" },
};

const pedidoCancelavel = (status: Pedido["status"]) => status === "pendente" || status === "em_preparo";

export default function ContaSheet({ mesa, onClose, onClosed }: { mesa: Mesa | null; onClose: () => void; onClosed?: () => void }) {
  const { user } = useAuth();
  const [conta, setConta] = useState<Conta | null>(null);
  const [pedidos, setPedidos] = useState<PedidoComItens[]>([]);
  const [novoOpen, setNovoOpen] = useState(false);
  const [confirmFechar, setConfirmFechar] = useState(false);
  const [confirmCancelarConta, setConfirmCancelarConta] = useState(false);
  const [confirmarTextoCancelarConta, setConfirmarTextoCancelarConta] = useState(false);
  const [textoConfirmacaoConta, setTextoConfirmacaoConta] = useState("");
  const [showOfferFecharZero, setShowOfferFecharZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<Configuracao | null>(null);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ tipo: "item" | "pedido"; pedido: PedidoComItens; item?: ItemDetalhado } | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState<MotivoCancelamento | "">("");
  const [observacaoCancelamento, setObservacaoCancelamento] = useState("");

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

  useEffect(() => { 
    if (mesa) load();
    // Carregar configuração da loja uma vez
    (async () => {
      const { data } = await supabase.from("configuracoes").select("*").limit(1).maybeSingle();
      if (data) {
        setCfg(data as unknown as Configuracao);
      }
    })();
  }, [mesa, load]);

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
    (s, p) => s + p.itens.reduce((si, i) => {
      if (i.cancelado) return si;
      return si + Number(i.preco_unitario) * i.quantidade;
    }, 0),
    0
  );

  const hasItensAtivos = pedidos.some((p) => p.itens.some((i) => !i.cancelado));

  const nomeOperador = user?.user_metadata?.nome || user?.email || "Operador";

  const motivoComObservacao = (motivo: string, observacao: string) => {
    const texto = observacao.trim();
    return texto ? `${motivo} | Obs: ${texto}` : motivo;
  };

  const refreshContaTotal = async (contaId: string) => {
    const { data: peds } = await supabase
      .from("pedidos")
      .select("id, status, cancelado_em")
      .eq("conta_id", contaId);

    const pedidosAtivos = (peds || []).filter((p) => p.status !== "cancelado" && !p.cancelado_em);
    if (!pedidosAtivos.length) {
      await supabase.from("contas").update({ total: 0 }).eq("id", contaId);
      return;
    }

    const ids = pedidosAtivos.map((p) => p.id);
    const { data: itens } = await supabase
      .from("pedido_itens")
      .select("quantidade, preco_unitario, cancelado")
      .in("pedido_id", ids);

    const novoTotal = (itens || []).reduce((acc, i) => {
      if (i.cancelado) return acc;
      return acc + Number(i.preco_unitario) * i.quantidade;
    }, 0);

    await supabase.from("contas").update({ total: novoTotal }).eq("id", contaId);
  };

  const maybeOfferFecharContaZero = async () => {
    if (!conta) return;
    const { count, error } = await supabase
      .from("pedidos")
      .select("id", { head: true, count: "exact" })
      .eq("conta_id", conta.id)
      .neq("status", "cancelado")
      .is("cancelado_em", null);

    if (error) {
      toast.error(error.message);
      return;
    }

    if ((count ?? 0) === 0) {
      setShowOfferFecharZero(true);
    }
  };

  const handlePrint = () => {
    if (!mesa || !pedidos.length) return;
    printReceipt({
      tipo: "mesa",
      loja_nome: cfg?.nome_loja,
      mesa_numero: mesa.numero,
      pedidos: pedidos
        .map((p, idx) => {
          const itensAtivos = p.itens.filter((i) => !i.cancelado);
          return {
            numero: idx + 1,
            criado_em: p.criado_em,
            itens: itensAtivos.map((i) => ({
              nome: i.produto?.nome ?? "Item",
              quantidade: i.quantidade,
              preco_unitario: Number(i.preco_unitario),
              observacao: i.observacao,
              adicionais: i.adicionais,
            })),
          };
        })
        .filter((p) => p.itens.length > 0),
      total,
    });
  };

  const closeConta = async (valorFinal: number, mensagem: string) => {
    if (!conta || !mesa) return;
    setBusy(true);
    const { error: e1 } = await supabase
      .from("contas")
      .update({ status: "fechada", fechada_em: new Date().toISOString(), total: valorFinal })
      .eq("id", conta.id);
    if (e1) {
      setBusy(false);
      toast.error(e1.message);
      return;
    }

    const { error: e2 } = await supabase
      .from("mesas").update({ status: "livre" }).eq("id", mesa.id);
    setBusy(false);
    if (e2) {
      toast.error(e2.message);
      return;
    }

    toast.success(mensagem);
    setConfirmFechar(false);
    setShowOfferFecharZero(false);
    onClose();
    onClosed?.();
  };

  const handleFechar = async () => {
    await closeConta(total, `Mesa ${mesa?.numero} fechada � ${brl(total)}`);
  };

  const resetCancelDialog = () => {
    setCancelDialogOpen(false);
    setCancelTarget(null);
    setMotivoCancelamento("");
    setObservacaoCancelamento("");
  };

  const openItemCancelDialog = (pedido: PedidoComItens, item: ItemDetalhado) => {
    if (!pedidoCancelavel(pedido.status)) {
      toast.error("Pedido j� finalizado, fale com o gerente");
      return;
    }
    setCancelTarget({ tipo: "item", pedido, item });
    setCancelDialogOpen(true);
  };

  const openPedidoCancelDialog = (pedido: PedidoComItens) => {
    if (!pedidoCancelavel(pedido.status)) {
      toast.error("Pedido j� finalizado, fale com o gerente");
      return;
    }
    setCancelTarget({ tipo: "pedido", pedido });
    setCancelDialogOpen(true);
  };

  const handleConfirmCancelamento = async () => {
    if (!cancelTarget || !motivoCancelamento) {
      toast.error("Selecione o motivo do cancelamento");
      return;
    }

    if (!conta) return;

    const agora = new Date().toISOString();
    const motivoFinal = motivoComObservacao(motivoCancelamento, observacaoCancelamento);
    setBusy(true);

    if (cancelTarget.tipo === "item" && cancelTarget.item) {
      if (!pedidoCancelavel(cancelTarget.pedido.status)) {
        setBusy(false);
        toast.error("Pedido j� finalizado, fale com o gerente");
        return;
      }

      const { error: itemError } = await supabase
        .from("pedido_itens")
        .update({
          cancelado: true,
          cancelado_em: agora,
          motivo_cancelamento: motivoFinal,
        })
        .eq("id", cancelTarget.item.id)
        .eq("cancelado", false);

      if (itemError) {
        setBusy(false);
        toast.error(itemError.message);
        return;
      }

      const { data: ativos } = await supabase
        .from("pedido_itens")
        .select("id")
        .eq("pedido_id", cancelTarget.pedido.id)
        .eq("cancelado", false)
        .limit(1);

      if (!ativos?.length) {
        await supabase
          .from("pedidos")
          .update({
            status: "cancelado",
            cancelado_em: agora,
            motivo_cancelamento: motivoFinal,
            cancelado_por: nomeOperador,
          })
          .eq("id", cancelTarget.pedido.id);
      }

      await refreshContaTotal(conta.id);
      await load();
      setBusy(false);
      toast.success("Item cancelado com sucesso");
      resetCancelDialog();
      return;
    }

    if (cancelTarget.tipo === "pedido") {
      if (!pedidoCancelavel(cancelTarget.pedido.status)) {
        setBusy(false);
        toast.error("Pedido j� finalizado, fale com o gerente");
        return;
      }

      const [{ error: pedidoError }, { error: itensError }] = await Promise.all([
        supabase
          .from("pedidos")
          .update({
            status: "cancelado",
            cancelado_em: agora,
            motivo_cancelamento: motivoFinal,
            cancelado_por: nomeOperador,
          })
          .eq("id", cancelTarget.pedido.id),
        supabase
          .from("pedido_itens")
          .update({
            cancelado: true,
            cancelado_em: agora,
            motivo_cancelamento: motivoFinal,
          })
          .eq("pedido_id", cancelTarget.pedido.id),
      ]);

      if (pedidoError || itensError) {
        setBusy(false);
        toast.error(pedidoError?.message || itensError?.message || "Erro ao cancelar pedido");
        return;
      }

      await refreshContaTotal(conta.id);
      await load();
      await maybeOfferFecharContaZero();
      setBusy(false);
      toast.success("Pedido cancelado com sucesso");
      resetCancelDialog();
    }
  };

  const handleCancelarConta = async () => {
    if (!conta || !mesa) return;

    setBusy(true);
    const agora = new Date().toISOString();
    const motivo = "Conta cancelada";

    const { data: peds, error: pedidosError } = await supabase
      .from("pedidos")
      .select("id")
      .eq("conta_id", conta.id);

    if (pedidosError) {
      setBusy(false);
      toast.error(pedidosError.message);
      return;
    }

    const pedidoIds = (peds || []).map((p) => p.id);

    if (pedidoIds.length) {
      const [{ error: ePed }, { error: eItem }] = await Promise.all([
        supabase
          .from("pedidos")
          .update({
            status: "cancelado",
            cancelado_em: agora,
            motivo_cancelamento: motivo,
            cancelado_por: nomeOperador,
          })
          .in("id", pedidoIds),
        supabase
          .from("pedido_itens")
          .update({
            cancelado: true,
            cancelado_em: agora,
            motivo_cancelamento: motivo,
          })
          .in("pedido_id", pedidoIds),
      ]);

      if (ePed || eItem) {
        setBusy(false);
        toast.error(ePed?.message || eItem?.message || "Erro ao cancelar conta");
        return;
      }
    }

    await closeConta(0, `Conta da mesa ${mesa.numero} cancelada e encerrada com R$ 0,00`);
    setTextoConfirmacaoConta("");
    setConfirmarTextoCancelarConta(false);
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
            <div className="flex items-start justify-between gap-3">
              <div>
                <SheetTitle className="font-display text-4xl text-primary-foreground">
                  Mesa {mesa?.numero}
                </SheetTitle>
                <SheetDescription className="text-primary-foreground/70">
                  {conta ? `Conta aberta em ${new Date(conta.aberta_em).toLocaleString("pt-BR")}` : "Carregando..."}
                </SheetDescription>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setConfirmCancelarConta(true)}
                disabled={!conta || busy}
              >
                <AlertTriangle className="h-4 w-4 mr-1" /> Cancelar conta
              </Button>
            </div>
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
                const subtotal = p.itens.reduce((s, i) => {
                  if (i.cancelado) return s;
                  return s + Number(i.preco_unitario) * i.quantidade;
                }, 0);
                const hasItensNaoCancelados = p.itens.some((i) => !i.cancelado);

                return (
                  <Card key={p.id} className="p-4 shadow-soft">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-xl">Pedido #{idx + 1}</span>
                        <Badge variant={statusLabel[p.status].variant}>{statusLabel[p.status].label}</Badge>
                        {p.cancelado_em && (
                          <Badge variant="destructive">Cancelado</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(p.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    {pedidoCancelavel(p.status) && hasItensNaoCancelados && (
                      <div className="mb-3">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openPedidoCancelDialog(p)}
                          disabled={busy}
                        >
                          <XCircle className="h-4 w-4 mr-1" /> Cancelar pedido
                        </Button>
                      </div>
                    )}

                    {p.resgate && (
                      <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs uppercase tracking-wider text-amber-700">?? Recompensa aplicada</div>
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
                            <div className="flex items-center gap-2">
                              <span className={i.cancelado ? "font-medium line-through text-muted-foreground" : "font-medium"}>
                                {i.quantidade}� {i.produto?.nome ?? "Produto removido"}
                              </span>
                              {i.cancelado && (
                                <Badge variant="destructive">Cancelado</Badge>
                              )}
                              {!i.cancelado && pedidoCancelavel(p.status) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive hover:text-destructive"
                                  onClick={() => openItemCancelDialog(p, i)}
                                  title="Cancelar item"
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            {i.adicionais.map((a, ai) => (
                              <div key={ai} className={i.cancelado ? "text-xs text-muted-foreground pl-3 line-through" : "text-xs text-muted-foreground pl-3"}>
                                +{a.quantidade}x {a.nome}
                              </div>
                            ))}
                            {i.observacao && (
                              <div className={i.cancelado ? "text-xs text-muted-foreground italic pl-3 line-through" : "text-xs text-muted-foreground italic pl-3"}>
                                ? {i.observacao}
                              </div>
                            )}
                            {i.cancelado && i.motivo_cancelamento && (
                              <div className="text-xs text-destructive/80 pl-3">
                                Motivo: {i.motivo_cancelamento}
                              </div>
                            )}
                          </div>
                          <span className={i.cancelado ? "text-muted-foreground whitespace-nowrap line-through" : "text-muted-foreground whitespace-nowrap"}>
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
              <Button variant="outline" onClick={() => setNovoOpen(true)} disabled={!conta || busy}>
                <Plus className="h-4 w-4 mr-1" /> Novo pedido
              </Button>
              <Button variant="outline" onClick={handlePrint} disabled={!conta || !pedidos.length || busy}>
                <Printer className="h-4 w-4 mr-1" /> Imprimir
              </Button>
              <Button onClick={() => setConfirmFechar(true)} disabled={!conta || !hasItensAtivos || busy}>
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

      <Dialog open={cancelDialogOpen} onOpenChange={(open) => !busy && (open ? setCancelDialogOpen(true) : resetCancelDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {cancelTarget?.tipo === "item" ? "Cancelar item" : "Cancelar pedido"}
            </DialogTitle>
            <DialogDescription>
              Informe o motivo do cancelamento. Esta a��o n�o apaga dados, apenas marca como cancelado.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Motivo do cancelamento</Label>
              <Select value={motivoCancelamento} onValueChange={(value) => setMotivoCancelamento(value as MotivoCancelamento)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um motivo" />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVOS_CANCELAMENTO.map((motivo) => (
                    <SelectItem key={motivo} value={motivo}>{motivo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Observa��o (opcional)</Label>
              <Textarea
                value={observacaoCancelamento}
                onChange={(e) => setObservacaoCancelamento(e.target.value)}
                placeholder="Detalhes adicionais"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetCancelDialog} disabled={busy}>Voltar</Button>
            <Button variant="destructive" onClick={handleConfirmCancelamento} disabled={busy || !motivoCancelamento}>
              {busy ? "Cancelando..." : "Confirmar cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmFechar} onOpenChange={setConfirmFechar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Fechar conta da mesa {mesa?.numero}?</AlertDialogTitle>
            <AlertDialogDescription>
              Total a cobrar: <span className="font-semibold text-foreground">{brl(total)}</span>.
              A mesa voltar� a ficar livre.
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

      <AlertDialog open={showOfferFecharZero} onOpenChange={setShowOfferFecharZero}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Todos os pedidos foram cancelados</AlertDialogTitle>
            <AlertDialogDescription>
              Voc� pode fechar a conta com valor R$ 0,00 ou manter a conta aberta para novos pedidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Manter aberta</AlertDialogCancel>
            <AlertDialogAction onClick={() => closeConta(0, `Mesa ${mesa?.numero} fechada com R$ 0,00`)} disabled={busy}>
              Fechar conta R$ 0,00
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancelarConta} onOpenChange={setConfirmCancelarConta}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl text-destructive">Cancelar conta inteira?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta a��o vai cancelar todos os pedidos e itens, fechar a conta em R$ 0,00 e liberar a mesa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmCancelarConta(false);
                setConfirmarTextoCancelarConta(true);
              }}
              disabled={busy}
            >
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={confirmarTextoCancelarConta} onOpenChange={(open) => !busy && setConfirmarTextoCancelarConta(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-destructive">Confirma��o final</DialogTitle>
            <DialogDescription>
              Digite <strong>CANCELAR</strong> para confirmar o cancelamento da conta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirmacao-cancelar">Digite CANCELAR</Label>
            <Input
              id="confirmacao-cancelar"
              value={textoConfirmacaoConta}
              onChange={(e) => setTextoConfirmacaoConta(e.target.value)}
              placeholder="CANCELAR"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarTextoCancelarConta(false)} disabled={busy}>Voltar</Button>
            <Button
              variant="destructive"
              onClick={handleCancelarConta}
              disabled={busy || textoConfirmacaoConta.trim().toUpperCase() !== "CANCELAR"}
            >
              {busy ? "Cancelando conta..." : "Cancelar conta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
