import { useState, useEffect } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import CardapioSelector, { Cart, cartSubtotal } from "@/components/cardapio/CardapioSelector";
import { brl } from "@/lib/format";
import { printReceipt } from "@/lib/print";
import type { Cliente } from "@/types/db";

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
      const [{ data: clientesData, error: clientesError }, { data: bairrosData, error: bairrosError }] = await Promise.all([
        supabase.from("clientes").select("*").order("nome"),
        supabase.from("bairros_taxas").select("nome, taxa").eq("ativo", true).order("nome"),
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
    })();
  }, [open]);

  const reset = () => {
    setCart([]); setNome(""); setTel(""); setEndereco(""); setNumero(""); setComplemento(""); setBairro(""); setTaxa("0"); setClienteSelecionado("");
  };

  const handleSelectCliente = (clienteId: string) => {
    const cliente = clientes.find(c => c.id === clienteId);
    if (!cliente) return;
    
    setClienteSelecionado(clienteId);
    setNome(cliente.nome);
    setTel(cliente.telefone);
    setEndereco(cliente.endereco || "");
    const bairroCliente = cliente.bairro || "";
    setBairro(bairroCliente);
    applyTaxaFromBairro(bairroCliente, true);
    setNumero(cliente.numero || "");
    setComplemento(cliente.complemento || "");
  };

  useEffect(() => {
    if (!bairro) return;
    applyTaxaFromBairro(bairro);
  }, [bairro, bairrosTaxas]);

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

    toast.success("Delivery cadastrado");

    if (autoPrint) {
      printReceipt({
        tipo: "delivery",
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
      <DialogContent className="max-w-5xl max-h-[95vh] flex flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Novo Delivery</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="d-cliente">Cliente (opcional)</Label>
            <Select value={clienteSelecionado} onValueChange={handleSelectCliente}>
              <SelectTrigger id="d-cliente">
                <SelectValue placeholder="Selecione um cliente cadastrado..." />
              </SelectTrigger>
              <SelectContent>
                {clientes.map((cliente) => (
                  <SelectItem key={cliente.id} value={cliente.id}>
                    {cliente.nome} - {cliente.telefone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-nome">Nome do cliente *</Label>
            <Input id="d-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-tel">Telefone *</Label>
            <Input id="d-tel" value={tel} onChange={(e) => setTel(e.target.value)} maxLength={20} placeholder="(11) 99999-9999" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="d-end">Endereço *</Label>
            <Input id="d-end" value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={200} placeholder="Rua" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-numero">Número *</Label>
            <Input id="d-numero" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} placeholder="123" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-complemento">Complemento</Label>
            <Input id="d-complemento" value={complemento} onChange={(e) => setComplemento(e.target.value)} maxLength={200} placeholder="Apt, sala, etc" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-bairro">Bairro</Label>
            <Input
              id="d-bairro"
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
              onBlur={() => applyTaxaFromBairro(bairro, true)}
              maxLength={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-taxa">Taxa de entrega (R$)</Label>
            <Input
              id="d-taxa" type="number" min={0} max={999} step="0.50"
              value={taxa} onChange={(e) => setTaxa(e.target.value)}
            />
          </div>
        </div>

        <CardapioSelector
          cart={cart}
          onCartChange={setCart}
          extraTotal={taxaNum}
          extraRow={
            <div className="flex justify-between text-xs">
              <span>Taxa de entrega</span><span>{brl(taxaNum)}</span>
            </div>
          }
          heightClass="h-[35vh]"
        />

        <div className="flex items-center justify-between gap-2 pt-2">
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
