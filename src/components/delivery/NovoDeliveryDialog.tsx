import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import CardapioSelector, { Cart, cartSubtotal } from "@/components/cardapio/CardapioSelector";
import { brl } from "@/lib/format";
import { printReceipt } from "@/lib/print";
import { buildWhatsappPedidoDados, sendWhatsapp } from "@/lib/whatsapp";
import type { Cliente, Configuracao } from "@/types/db";

const deliverySchema = z.object({
  cliente_nome: z.string().trim().min(2, "Nome muito curto").max(100),
  cliente_telefone: z.string().trim().min(8, "Telefone inválido").max(20),
  endereco: z.string().trim().min(5, "Endereço incompleto").max(200),
  numero: z.string().trim().min(1, "Número inválido").max(20),
  complemento: z.string().trim().max(200).optional().or(z.literal("")),
  bairro: z.string().trim().max(80).optional().or(z.literal("")),
  taxa_entrega: z.number().min(0, "Taxa inválida").max(999),
});

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface BairroTaxaOption {
  nome: string;
  taxa: number;
}

export default function NovoDeliveryDialog({ open, onClose, onCreated }: Props) {
  const [cart, setCart] = useState<Cart>([]);
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [endereco, setEndereco] = useState("");
  const [bairro, setBairro] = useState("");
  const [taxa, setTaxa] = useState<string>("0");
  const [busy, setBusy] = useState(false);
  const [autoPrint, setAutoPrint] = useState(true);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [bairrosTaxas, setBairrosTaxas] = useState<BairroTaxaOption[]>([]);
  const [clienteSelecionado, setClienteSelecionado] = useState<string>("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [cfg, setCfg] = useState<Configuracao | null>(null);
  const [bairroOpen, setBairroOpen] = useState(false);
  const [clienteBusca, setClienteBusca] = useState("");
  const [clienteOpen, setClienteOpen] = useState(false);
  const bairroWrapRef = useRef<HTMLDivElement>(null);
  const clienteWrapRef = useRef<HTMLDivElement>(null);

  const normalizeSearch = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const normalizeBairro = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const applyTaxaFromBairro = (bairroValue: string, fallbackToZero = false) => {
    const normalized = normalizeBairro(bairroValue);
    if (!normalized) {
      if (fallbackToZero) setTaxa("0");
      return;
    }

    const bairroMatch = bairrosTaxas.find((item) => normalizeBairro(item.nome) === normalized);
    if (bairroMatch) {
      setTaxa(String(Number(bairroMatch.taxa || 0)));
      return;
    }

    if (fallbackToZero) setTaxa("0");
  };

  useEffect(() => {
    if (!open) return;
    
    (async () => {
      const [{ data: clientesData, error: clientesError }, { data: bairrosData, error: bairrosError }, { data: cfgData }] = await Promise.all([
        supabase.from("clientes").select("*").order("nome"),
        supabase.from("bairros_taxas").select("nome, taxa").eq("ativo", true).order("nome"),
        supabase.from("configuracoes").select("*").limit(1).maybeSingle(),
      ]);

      if (clientesError) {
        console.error("Erro ao buscar clientes:", clientesError);
        return;
      }

      if (bairrosError) {
        console.error("Erro ao buscar bairros e taxas:", bairrosError);
        return;
      }

      setClientes((clientesData || []) as Cliente[]);
      setBairrosTaxas((bairrosData || []) as BairroTaxaOption[]);
      if (cfgData) {
        setCfg(cfgData as unknown as Configuracao);
      }
    })();
  }, [open]);

  const reset = () => {
    setCart([]);
    setNome("");
    setTel("");
    setEndereco("");
    setNumero("");
    setComplemento("");
    setBairro("");
    setTaxa("0");
    setClienteSelecionado("");
    setClienteBusca("");
    setBairroOpen(false);
    setClienteOpen(false);
  };

  const handleSelectCliente = (cliente: Cliente) => {
    setClienteSelecionado(cliente.id);
    setClienteBusca(`${cliente.nome} - ${cliente.telefone}`);
    setNome(cliente.nome);
    setTel(cliente.telefone);
    setEndereco(cliente.endereco || "");
    const bairroCliente = cliente.bairro || "";
    setBairro(bairroCliente);
    applyTaxaFromBairro(bairroCliente, true);
    setNumero(cliente.numero || "");
    setComplemento(cliente.complemento || "");
    setClienteOpen(false);
  };

  const clearClienteSelecionado = () => {
    setClienteSelecionado("");
    setClienteBusca("");
    setClienteOpen(false);
  };

  useEffect(() => {
    if (!bairro) return;
    applyTaxaFromBairro(bairro);
  }, [bairro, bairrosTaxas]);

  const bairrosFiltrados = useMemo(() => {
    const termo = normalizeBairro(bairro);
    if (!termo) return bairrosTaxas;
    return bairrosTaxas.filter((item) => normalizeBairro(item.nome).includes(termo));
  }, [bairro, bairrosTaxas]);

  const clientesFiltrados = useMemo(() => {
    const termo = clienteBusca.trim();
    if (!termo) return clientes;

    const termoNorm = normalizeSearch(termo);
    const termoDigits = termo.replace(/\D/g, "");

    return clientes.filter((cliente) => {
      const nomeMatch = normalizeSearch(cliente.nome).includes(termoNorm);
      const telMatch = termoDigits.length >= 3
        && cliente.telefone.replace(/\D/g, "").includes(termoDigits);
      return nomeMatch || telMatch;
    });
  }, [clienteBusca, clientes]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (bairroWrapRef.current && !bairroWrapRef.current.contains(target)) {
        setBairroOpen(false);
      }
      if (clienteWrapRef.current && !clienteWrapRef.current.contains(target)) {
        setClienteOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectBairro = (nomeBairro: string, taxaBairro: number) => {
    setBairro(nomeBairro);
    setTaxa(String(Number(taxaBairro || 0)));
    setBairroOpen(false);
  };

  const taxaNum = Number(taxa.replace(",", ".")) || 0;
  const subtotal = cartSubtotal(cart);

  const handleConfirm = async () => {
    const items = cart;
    if (!items.length) return toast.error("Adicione pelo menos um item");

    const parsed = deliverySchema.safeParse({
      cliente_nome: nome,
      cliente_telefone: tel,
      endereco,
      numero,
      complemento,
      bairro,
      taxa_entrega: taxaNum,
    });
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);

    setBusy(true);
    // 1. Pedido
    const { data: pedido, error: e1 } = await supabase
      .from("pedidos")
      .insert({ conta_id: null, tipo: "delivery", status: "pendente" })
      .select().single();
    if (e1 || !pedido) { setBusy(false); return toast.error(e1?.message || "Erro"); }

    // 2. Itens
    const rows = items.map((i) => ({
      pedido_id: pedido.id,
      produto_id: i.produto.id,
      quantidade: i.quantidade,
      preco_unitario: i.precoUnit,
      observacao: i.observacao || null,
    }));
    const { data: insertedItems, error: e2 } = await supabase.from("pedido_itens").insert(rows).select("id");
    if (e2) { setBusy(false); return toast.error(e2.message); }

    const adicionaisRows = items.flatMap((item, idx) =>
      item.adicionais.map((adicional) => ({
        pedido_item_id: insertedItems?.[idx]?.id,
        adicional_id: adicional.adicionalId,
        quantidade: adicional.quantidade,
        preco_unitario: adicional.precoUnitario,
      }))
    ).filter((row) => !!row.pedido_item_id);

    if (adicionaisRows.length) {
      const { error: eAdd } = await supabase.from("pedido_item_adicionais").insert(adicionaisRows);
      if (eAdd) { setBusy(false); return toast.error(eAdd.message); }
    }

    // 3. Entrega
    const { error: e3 } = await supabase.from("entregas").insert({
      pedido_id: pedido.id,
      cliente_nome: parsed.data.cliente_nome,
      cliente_telefone: parsed.data.cliente_telefone,
      endereco: parsed.data.endereco,
      numero: parsed.data.numero,
      complemento: parsed.data.complemento || null,
      bairro: parsed.data.bairro || null,
      taxa_entrega: parsed.data.taxa_entrega,
      status: "aguardando",
    });
    setBusy(false);
    if (e3) return toast.error(e3.message);

    if (parsed.data.cliente_telefone) {
      sendWhatsapp(
        pedido.id,
        "confirmado",
        parsed.data.cliente_telefone,
        buildWhatsappPedidoDados(items, {
          nome: parsed.data.cliente_nome,
          taxaEntrega: parsed.data.taxa_entrega,
          total: brl(subtotal + parsed.data.taxa_entrega),
        })
      );
    }

    toast.success("Delivery cadastrado");

    if (autoPrint) {
      printReceipt({
        tipo: "delivery",
        loja_nome: cfg?.nome_loja,
        cliente_nome: parsed.data.cliente_nome,
        cliente_telefone: parsed.data.cliente_telefone,
        endereco: parsed.data.endereco,
        numero: parsed.data.numero,
        complemento: parsed.data.complemento || null,
        bairro: parsed.data.bairro || null,
        taxa_entrega: parsed.data.taxa_entrega,
        itens: items.map((item) => ({
          nome: item.produto.nome,
          quantidade: item.quantidade,
          preco_unitario: item.precoUnit,
          observacao: item.observacao || null,
          adicionais: item.adicionais.map((a) => ({
            nome: a.adicionalNome,
            quantidade: a.quantidade,
            preco_unitario: a.precoUnitario,
          })),
        })),
        subtotal,
        total: subtotal + taxaNum,
        criado_em: new Date().toISOString(),
      });
    }

    reset();
    onCreated();
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-sm sm:max-w-2xl md:max-w-4xl lg:max-w-5xl max-h-[92vh] flex flex-col overflow-hidden gap-3">
        <DialogHeader className="shrink-0 pb-2">
          <DialogTitle className="font-display text-2xl">Novo Delivery</DialogTitle>
        </DialogHeader>

        <div className="shrink-0 grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2 pb-2">
          <div className="col-span-2 md:col-span-6 space-y-1">
            <Label htmlFor="d-cliente" className="text-xs">Cliente (opcional)</Label>
            <div className="relative" ref={clienteWrapRef}>
              <Input
                id="d-cliente"
                className="h-9"
                value={clienteBusca}
                onChange={(e) => {
                  setClienteBusca(e.target.value);
                  setClienteSelecionado("");
                  setClienteOpen(true);
                }}
                onFocus={() => setClienteOpen(true)}
                placeholder="Buscar cliente por nome ou telefone..."
                autoComplete="off"
              />
              {clienteOpen && (
                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
                  {clienteSelecionado && (
                    <button
                      type="button"
                      className="w-full border-b px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={clearClienteSelecionado}
                    >
                      Limpar selecao
                    </button>
                  )}
                  {clientesFiltrados.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhum cliente encontrado.
                    </div>
                  ) : (
                    clientesFiltrados.map((cliente) => (
                      <button
                        key={cliente.id}
                        type="button"
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSelectCliente(cliente)}
                      >
                        <span className="font-medium">{cliente.nome}</span>
                        <span className="text-xs text-muted-foreground">{cliente.telefone}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="col-span-2 md:col-span-4 space-y-1">
            <Label htmlFor="d-nome" className="text-xs">Nome do cliente *</Label>
            <Input id="d-nome" className="h-9" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
          </div>
          <div className="col-span-2 md:col-span-2 space-y-1">
            <Label htmlFor="d-tel" className="text-xs">Telefone *</Label>
            <Input id="d-tel" className="h-9" value={tel} onChange={(e) => setTel(e.target.value)} maxLength={20} placeholder="(11) 99999-9999" />
          </div>
          <div className="col-span-2 md:col-span-3 space-y-1">
            <Label htmlFor="d-end" className="text-xs">Endereço *</Label>
            <Input id="d-end" className="h-9" value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={200} placeholder="Rua" />
          </div>
          <div className="col-span-1 md:col-span-1 space-y-1">
            <Label htmlFor="d-numero" className="text-xs">Nº *</Label>
            <Input id="d-numero" className="h-9" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} placeholder="123" />
          </div>
          <div className="col-span-1 md:col-span-2 space-y-1">
            <Label htmlFor="d-complemento" className="text-xs">Complemento</Label>
            <Input id="d-complemento" className="h-9" value={complemento} onChange={(e) => setComplemento(e.target.value)} maxLength={200} placeholder="Apt, sala" />
          </div>
          <div className="col-span-1 md:col-span-4 space-y-1">
            <Label htmlFor="d-bairro" className="text-xs">Bairro</Label>
            <div className="relative" ref={bairroWrapRef}>
              <Input
                id="d-bairro"
                className="h-9"
                value={bairro}
                onChange={(e) => {
                  setBairro(e.target.value);
                  setBairroOpen(true);
                }}
                onFocus={() => setBairroOpen(true)}
                onBlur={() => applyTaxaFromBairro(bairro, true)}
                maxLength={80}
                placeholder="Selecione ou digite o bairro"
                autoComplete="off"
              />
              {bairroOpen && bairrosTaxas.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-h-44 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
                  {bairrosFiltrados.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhum bairro encontrado. Continue digitando para usar um bairro personalizado.
                    </div>
                  ) : (
                    bairrosFiltrados.map((item) => (
                      <button
                        key={item.nome}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSelectBairro(item.nome, item.taxa)}
                      >
                        <span>{item.nome}</span>
                        <span className="text-xs text-muted-foreground">{brl(item.taxa)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="col-span-1 md:col-span-2 space-y-1">
            <Label htmlFor="d-taxa" className="text-xs">Taxa (R$)</Label>
            <Input
              id="d-taxa" className="h-9"
              type="number" min={0} max={999} step="0.50"
              value={taxa} onChange={(e) => setTaxa(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          <CardapioSelector
            cart={cart}
            onCartChange={setCart}
            extraTotal={taxaNum}
            extraRow={
              <div className="flex justify-between text-xs">
                <span>Taxa de entrega</span><span>{brl(taxaNum)}</span>
              </div>
            }
            heightClass="h-full"
          />
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 pt-2">
          <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            Imprimir automaticamente
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} disabled={busy}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={busy} size="lg">
              {busy ? "Enviando..." : `Confirmar pedido — ${brl(subtotal + taxaNum)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
