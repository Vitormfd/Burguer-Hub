import { useState } from "react";
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

const deliverySchema = z.object({
  cliente_nome: z.string().trim().min(2, "Nome muito curto").max(100),
  cliente_telefone: z.string().trim().min(8, "Telefone inválido").max(20),
  endereco: z.string().trim().min(5, "Endereço incompleto").max(200),
  bairro: z.string().trim().max(80).optional().or(z.literal("")),
  taxa_entrega: z.number().min(0, "Taxa inválida").max(999),
});

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
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

  const reset = () => {
    setCart([]); setNome(""); setTel(""); setEndereco(""); setBairro(""); setTaxa("0");
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
          <div className="space-y-2">
            <Label htmlFor="d-nome">Nome do cliente *</Label>
            <Input id="d-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-tel">Telefone *</Label>
            <Input id="d-tel" value={tel} onChange={(e) => setTel(e.target.value)} maxLength={20} placeholder="(11) 99999-9999" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="d-end">Endereço completo *</Label>
            <Input id="d-end" value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={200} placeholder="Rua, número, complemento" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-bairro">Bairro</Label>
            <Input id="d-bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} maxLength={80} />
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
