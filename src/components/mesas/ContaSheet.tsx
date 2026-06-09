import { useEffect, useState, useCallback } from "react";
import { Mesa, Conta, ContaPagamento, FormaPagamento, Pedido, PedidoItem, Produto, Configuracao } from "@/types/db";
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
import EditarPedidoDialog from "@/components/pedidos/EditarPedidoDialog";
import { pedidoEditavel } from "@/lib/pedidoEdit";
import { Plus, Receipt, Clock, Printer, XCircle, AlertTriangle, Pencil } from "lucide-react";
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

const formaPagamentoOptions: FormaPagamento[] = ["pix", "boleto", "cartao", "dinheiro"];
const formaPagamentoLabel: Record<FormaPagamento, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao: "Cartão",
  boleto: "Boleto",
};

export default function ContaSheet({ mesa, onClose, onClosed }: { mesa: Mesa | null; onClose: () => void; onClosed?: () => void }) {
  const { user } = useAuth();
  const [conta, setConta] = useState<Conta | null>(null);
  const [pedidos, setPedidos] = useState<PedidoComItens[]>([]);
  const [pagamentos, setPagamentos] = useState<ContaPagamento[]>([]);
  const [novoPagamentoForma, setNovoPagamentoForma] = useState<FormaPagamento>("pix");
  const [pagamentoValor, setPagamentoValor] = useState<string>("");
  const [novoOpen, setNovoOpen] = useState(false);
  const [editPedido, setEditPedido] = useState<PedidoComItens | null>(null);
  const [confirmFechar, setConfirmFechar] = useState(false);
  const [confirmCancelarConta, setConfirmCancelarConta] = useState(false);
  const [confirmarTextoCancelarConta, setConfirmarTextoCancelarConta] = useState(false);
  const [textoConfirmacaoConta, setTextoConfirmacaoConta] = useState("");
  const [showOfferFecharZero, setShowOfferFecharZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<Configuracao | null>(null);
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>("dinheiro");
  const [trocoPara, setTrocoPara] = useState("");

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ tipo: "item" | "pedido"; pedido: PedidoComItens; item?: ItemDetalhado } | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState<MotivoCancelamento | "">("");
  const [observacaoCancelamento, setObservacaoCancelamento] = useState("");
  const [clienteDialogOpen, setClienteDialogOpen] = useState(false);
  const [clienteNome, setClienteNome] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");
  const [pendingCloseConta, setPendingCloseConta] = useState<{ valor: number; forma?: FormaPagamento } | null>(null);

  const load = useCallback(async () => {
    if (!mesa) return;
    const { data: c } = await supabase
      .from("contas").select("*")
      .eq("mesa_id", mesa.id).eq("status", "aberta")
      .order("aberta_em", { ascending: false }).limit(1).maybeSingle();

    if (!c) {
      setConta(null);
      setPedidos([]);
      setPagamentos([]);
      setFormaPagamento("dinheiro");
      setTrocoPara("");
      return;
    }
    const contaData = c as Conta;
    setConta(contaData);
    setFormaPagamento(contaData.forma_pagamento ?? "dinheiro");
    setTrocoPara(contaData.troco_para != null ? String(contaData.troco_para) : "");

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

    const { data: pagamentosData } = await supabase
      .from("conta_pagamentos")
      .select("*")
      .eq("conta_id", c.id)
      .order("criado_em");

    setPagamentos((pagamentosData || []) as ContaPagamento[]);
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

  const pagamentosTotal = pagamentos.reduce((s, pagamento) => s + Number(pagamento.valor), 0);
  const restante = Math.max(0, total - pagamentosTotal);

  const valorDinheiroRegistrado = pagamentos
    .filter((pagamento) => pagamento.forma_pagamento === "dinheiro")
    .reduce((s, pagamento) => s + Number(pagamento.valor), 0);

  const valorDinheiroPendente =
    novoPagamentoForma === "dinheiro" && restante > 0
      ? (() => {
          const v = Number(pagamentoValor.replace(",", "."));
          if (Number.isFinite(v) && v > 0) return Math.min(v, restante);
          return restante;
        })()
      : 0;

  const valorDinheiroConta = valorDinheiroRegistrado + valorDinheiroPendente;
  const baseTroco = pagamentos.length > 0 ? valorDinheiroConta : total;

  const exibirCampoTroco =
    (pagamentos.length === 0 && formaPagamento === "dinheiro") ||
    valorDinheiroRegistrado > 0 ||
    (restante > 0 && novoPagamentoForma === "dinheiro");

  const parseTrocoPara = () => {
    const raw = trocoPara.trim();
    if (!raw) return null;
    const value = Number(raw.replace(",", "."));
    return Number.isFinite(value) ? value : null;
  };

  const trocoParaValor = parseTrocoPara();
  const trocoCalculado =
    trocoParaValor != null && baseTroco > 0 && trocoParaValor > baseTroco
      ? trocoParaValor - baseTroco
      : null;

  const hasItensAtivos = pedidos.some((p) => p.itens.some((i) => !i.cancelado));

  const nomeOperador = user?.user_metadata?.nome || user?.email || "Operador";

  const addPagamento = () => {
    if (!conta) {
      toast.error("Abra a conta primeiro");
      return;
    }

    let valor = Number(pagamentoValor.replace(",", "."));
    if (novoPagamentoForma === "dinheiro" && restante > 0 && (!valor || valor <= 0)) {
      valor = restante;
    }
    if (!valor || valor <= 0) {
      toast.error("Digite um valor válido");
      return;
    }

    if (valor > restante) {
      toast.error("O valor não pode ser maior que o restante");
      return;
    }

    const novo: ContaPagamento = {
      id: "",
      conta_id: conta.id,
      forma_pagamento: novoPagamentoForma,
      valor,
      criado_em: new Date().toISOString(),
    };

    setPagamentos((current) => [...current, novo]);
    setPagamentoValor("");
  };

  const removePagamento = (index: number) => {
    setPagamentos((current) => {
      const next = current.filter((_, idx) => idx !== index);
      if (!next.some((pagamento) => pagamento.forma_pagamento === "dinheiro")) {
        setTrocoPara("");
      }
      return next;
    });
  };

  const persistPagamentos = async () => {
    if (!conta) return true;

    const { error: deleteError } = await supabase
      .from("conta_pagamentos")
      .delete()
      .eq("conta_id", conta.id);

    if (deleteError) {
      toast.error(deleteError.message);
      return false;
    }

    if (!pagamentos.length) return true;

    const insertRows = pagamentos.map((pagamento) => ({
      conta_id: conta.id,
      forma_pagamento: pagamento.forma_pagamento,
      valor: pagamento.valor,
    }));

    const { error: insertError } = await supabase
      .from("conta_pagamentos")
      .insert(insertRows);

    if (insertError) {
      toast.error(insertError.message);
      return false;
    }

    return true;
  };

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

  const validarTroco = () => {
    if (!exibirCampoTroco && valorDinheiroRegistrado <= 0) return true;
    const valor = parseTrocoPara();
    if (valor == null) return true;
    if (valor < baseTroco) {
      toast.error(
        pagamentos.length > 0
          ? `O valor recebido deve ser maior ou igual ao pagamento em dinheiro (${brl(baseTroco)})`
          : "O valor do troco deve ser maior ou igual ao total da conta"
      );
      return false;
    }
    return true;
  };

  const handlePrint = () => {
    if (!mesa || !pedidos.length) return;
    const trocoVal = exibirCampoTroco || valorDinheiroRegistrado > 0 ? parseTrocoPara() : null;
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
      pagamentos: pagamentos.length > 0 ? pagamentos.map((p) => ({ forma: p.forma_pagamento, valor: Number(p.valor) })) : undefined,
      forma_pagamento: pagamentos.length === 0 ? formaPagamento : undefined,
      troco_para: trocoVal,
    });
  };

  const closeConta = async (valorFinal: number, forma?: FormaPagamento, telefone?: string, nome?: string) => {
    if (!conta || !mesa) return;
    setBusy(true);
    
    // Registrar clientes para fidelidade se telefone for fornecido
    if (telefone) {
      const telefoneLimpo = telefone.replace(/\D/g, '');
      if (telefoneLimpo.length >= 10) {
        for (const pedido of pedidos) {
          if (pedido.status !== 'cancelado' && pedido.itens.some(i => !i.cancelado)) {
            const { error } = await (supabase as any).rpc('register_cliente_mesa_pedido', {
              p_pedido_id: pedido.id,
              p_nome: nome || 'Cliente',
              p_telefone: telefone,
            });
            if (error) {
              console.error('Erro ao registrar cliente para fidelidade:', error);
            }
          }
        }
      }
    }

    if (pagamentos.length > 0) {
      const persisted = await persistPagamentos();
      if (!persisted) {
        setBusy(false);
        return;
      }
    }

    const trocoVal = exibirCampoTroco || valorDinheiroRegistrado > 0 ? parseTrocoPara() : null;

    const { error: e1 } = await supabase
      .from("contas")
      .update({
        status: "fechada",
        fechada_em: new Date().toISOString(),
        total: valorFinal,
        forma_pagamento: forma ?? (pagamentos.length > 0 ? pagamentos[0].forma_pagamento : formaPagamento),
        troco_para: trocoVal,
      })
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

    toast.success(`Mesa ${mesa?.numero} fechada a ${brl(valorFinal)}`);
    setConfirmFechar(false);
    setShowOfferFecharZero(false);
    setClienteDialogOpen(false);
    setClienteNome("");
    setClienteTelefone("");
    setPendingCloseConta(null);
    setTrocoPara("");
    onClose();
    onClosed?.();
  };

  const handleFechar = async () => {
    if (pagamentos.length > 0 && pagamentosTotal !== total) {
      toast.error("O total dos pagamentos deve ser igual ao valor da conta");
      return;
    }
    if (!validarTroco()) return;
    setPendingCloseConta({ valor: total, forma: pagamentos.length > 0 ? pagamentos[0].forma_pagamento : formaPagamento });
    setClienteDialogOpen(true);
  };

  const handleConfirmCliente = async () => {
    if (!pendingCloseConta) return;
    await closeConta(
      pendingCloseConta.valor,
      pagamentos.length > 0 ? undefined : pendingCloseConta.forma,
      clienteTelefone,
      clienteNome
    );
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
          .eq("pedido_id", cancelTarget.pedido.id)
          .eq("cancelado", false),
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
          .in("pedido_id", pedidoIds)
          .eq("cancelado", false),
      ]);

      if (ePed || eItem) {
        setBusy(false);
        toast.error(ePed?.message || eItem?.message || "Erro ao cancelar conta");
        return;
      }
    }

    await closeConta(0);
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

                    {pedidoEditavel(p.status) && hasItensNaoCancelados && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditPedido(p)}
                          disabled={busy}
                        >
                          <Pencil className="h-4 w-4 mr-1" /> Editar pedido
                        </Button>
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
            <div className="space-y-3">
              <div className="rounded-2xl border border-border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Pagamentos</div>
                    <div className="text-xs text-muted-foreground">Adicione os métodos usados para pagar a conta.</div>
                  </div>
                  <div className="text-right text-sm font-semibold">
                    {pagamentos.length ? brl(pagamentosTotal) : brl(0)}
                  </div>
                </div>

                {pagamentos.length > 0 ? (
                  <div className="space-y-2">
                    {pagamentos.map((pagamento, index) => (
                      <div key={`${pagamento.forma_pagamento}-${pagamento.valor}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-muted p-3">
                        <div>
                          <div className="font-medium">{formaPagamentoLabel[pagamento.forma_pagamento]}</div>
                          <div className="text-xs text-muted-foreground">{brl(pagamento.valor)}</div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removePagamento(index)} disabled={busy}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Nenhum pagamento parcial adicionado.</div>
                )}

                <div className="grid gap-2 sm:grid-cols-[1fr_140px_120px]">
                  <Select
                    value={novoPagamentoForma}
                    onValueChange={(value) => {
                      const forma = value as FormaPagamento;
                      setNovoPagamentoForma(forma);
                      if (forma === "dinheiro" && restante > 0 && !pagamentoValor.trim()) {
                        setPagamentoValor(String(restante));
                      }
                      if (forma !== "dinheiro" && pagamentos.every((p) => p.forma_pagamento !== "dinheiro")) {
                        setTrocoPara("");
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Forma" />
                    </SelectTrigger>
                    <SelectContent>
                      {formaPagamentoOptions.map((forma) => (
                        <SelectItem key={forma} value={forma}>{formaPagamentoLabel[forma]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={pagamentoValor}
                    onChange={(e) => setPagamentoValor(e.target.value)}
                    placeholder="Valor"
                    min={0}
                    step="0.01"
                  />
                  <Button onClick={addPagamento} disabled={busy || !restante || !conta}>
                    Adicionar
                  </Button>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Restante</span>
                  <span className={restante === 0 ? "text-emerald-600 font-semibold" : "text-foreground font-semibold"}>{brl(restante)}</span>
                </div>

                {pagamentos.length > 0 && pagamentosTotal !== total && (
                  <div className="text-sm text-destructive">O total dos pagamentos deve ser igual ao valor da conta para fechar.</div>
                )}

                {pagamentos.length === 0 && (
                  <div className="space-y-2 pt-1 border-t">
                    <Label>Forma de pagamento</Label>
                    <Select
                      value={formaPagamento}
                      onValueChange={(value) => {
                        const forma = value as FormaPagamento;
                        setFormaPagamento(forma);
                        if (forma !== "dinheiro") setTrocoPara("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {formaPagamentoOptions.map((forma) => (
                          <SelectItem key={forma} value={forma}>{formaPagamentoLabel[forma]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {exibirCampoTroco && (
                  <div className="space-y-2 pt-1 border-t">
                    <Label htmlFor="mesa-troco">Quanto o cliente pagou em dinheiro?</Label>
                    <Input
                      id="mesa-troco"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="1"
                      value={trocoPara}
                      onChange={(e) => setTrocoPara(e.target.value)}
                      placeholder={pagamentos.length > 0 ? `Ex: ${Math.ceil(baseTroco)}` : "Ex: 100"}
                    />
                    {pagamentos.length > 0 && baseTroco > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Valor da conta em dinheiro: <span className="font-semibold text-foreground">{brl(baseTroco)}</span>
                      </p>
                    )}
                    {trocoCalculado != null && (
                      <p className="text-sm font-medium text-emerald-700">
                        Troco a devolver: <span className="font-bold">{brl(trocoCalculado)}</span>
                      </p>
                    )}
                    {trocoParaValor != null && trocoParaValor > 0 && trocoParaValor < baseTroco && (
                      <p className="text-xs text-destructive">
                        O valor recebido deve ser pelo menos {brl(baseTroco)}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => setNovoOpen(true)} disabled={!conta || busy}>
                <Plus className="h-4 w-4 mr-1" /> Novo pedido
              </Button>
              <Button variant="outline" onClick={handlePrint} disabled={!conta || !pedidos.length || busy}>
                <Printer className="h-4 w-4 mr-1" /> Imprimir
              </Button>
              <Button onClick={() => setConfirmFechar(true)} disabled={!conta || !hasItensAtivos || busy || (pagamentos.length > 0 && pagamentosTotal !== total)}>
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

      <EditarPedidoDialog
        open={!!editPedido}
        pedidoId={editPedido?.id ?? null}
        variant="mesa"
        mesaNumero={mesa?.numero}
        onClose={() => setEditPedido(null)}
        onSaved={async () => {
          if (conta) await refreshContaTotal(conta.id);
          await load();
        }}
      />

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
              {pagamentos.length > 0 ? (
                <>Pagamentos: <span className="font-semibold text-foreground">{pagamentos.length} método(s)</span>.</>
              ) : (
                <>Forma: <span className="font-semibold text-foreground">{formaPagamentoLabel[formaPagamento]}</span>.</>
              )}
              {trocoCalculado != null && trocoParaValor != null && (
                <> Cliente pagou <span className="font-semibold text-foreground">{brl(trocoParaValor)}</span> em dinheiro
                  (devolver <span className="font-semibold text-foreground">{brl(trocoCalculado)}</span>).
                </>
              )}
              {" "}A mesa voltará a ficar livre.
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
            <AlertDialogAction onClick={() => closeConta(0)} disabled={busy}>
              Fechar conta R$ 0,00
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={clienteDialogOpen} onOpenChange={(open) => !busy && setClienteDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Dados do cliente (opcional)</DialogTitle>
            <DialogDescription>
              Para registrar a fidelidade do cliente, informe o telefone. Caso não deseje, deixe em branco e clique em Fechar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cliente-nome">Nome do cliente</Label>
              <Input
                id="cliente-nome"
                value={clienteNome}
                onChange={(e) => setClienteNome(e.target.value)}
                placeholder="Opcional"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-telefone">Telefone para fidelidade</Label>
              <Input
                id="cliente-telefone"
                value={clienteTelefone}
                onChange={(e) => setClienteTelefone(e.target.value)}
                placeholder="(11) 99999-9999"
                maxLength={20}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setClienteDialogOpen(false);
              setClienteNome("");
              setClienteTelefone("");
              setPendingCloseConta(null);
            }} disabled={busy}>Cancelar</Button>
            <Button onClick={handleConfirmCliente} disabled={busy}>
              {busy ? "Fechando..." : "Fechar conta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
