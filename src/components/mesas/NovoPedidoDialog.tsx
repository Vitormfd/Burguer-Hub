import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import CardapioSelector, { Cart, cartSubtotal } from "@/components/cardapio/CardapioSelector";

interface Props {
  open: boolean;
  contaId: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function NovoPedidoDialog({ open, contaId, onClose, onCreated }: Props) {
  const [cart, setCart] = useState<Cart>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setCart([]); }, [open]);

  const handleConfirm = async () => {
    const items = cart;
    if (!items.length) return toast.error("Adicione pelo menos um item");

    setBusy(true);
    const { data: pedido, error: e1 } = await supabase
      .from("pedidos")
      .insert({ conta_id: contaId, tipo: "mesa", status: "pendente" })
      .select().single();
    if (e1 || !pedido) { setBusy(false); return toast.error(e1?.message || "Erro"); }

    const rows = items.map((i) => ({
      pedido_id: pedido.id,
      produto_id: i.produto.id,
      quantidade: i.quantidade,
      preco_unitario: i.precoUnit,
      observacao: i.observacao || null,
    }));
    const { data: insertedItems, error: e2 } = await supabase.from("pedido_itens").insert(rows).select("id");
    setBusy(false);
    if (e2) return toast.error(e2.message);

    const adicionaisRows = items.flatMap((item, idx) =>
      item.adicionais.map((adicional) => ({
        pedido_item_id: insertedItems?.[idx]?.id,
        adicional_id: adicional.adicionalId,
        quantidade: adicional.quantidade,
        preco_unitario: adicional.precoUnitario,
      }))
    ).filter((row) => !!row.pedido_item_id);

    if (adicionaisRows.length) {
      const { error: e3 } = await supabase.from("pedido_item_adicionais").insert(adicionaisRows);
      if (e3) return toast.error(e3.message);
    }

    toast.success("Pedido enviado para a cozinha");
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Novo Pedido</DialogTitle>
        </DialogHeader>

        <CardapioSelector cart={cart} onCartChange={setCart} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={busy || !cart.length} size="lg">
            {busy ? "Enviando..." : `Enviar (${cart.reduce((s, i) => s + i.quantidade, 0)} itens)`}
          </Button>
        </div>
        <span className="hidden">{cartSubtotal(cart)}</span>
      </DialogContent>
    </Dialog>
  );
}
