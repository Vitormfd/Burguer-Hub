import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import CardapioSelector, { Cart, cartSubtotal } from "@/components/cardapio/CardapioSelector";
import { printReceipt } from "@/lib/print";
import type { Configuracao } from "@/types/db";

interface Props {
  open: boolean;
  contaId: string;
  mesaNumero?: number;
  onClose: () => void;
  onCreated: () => void;
}

export default function NovoPedidoDialog({ open, contaId, mesaNumero, onClose, onCreated }: Props) {
  const [cart, setCart] = useState<Cart>([]);
  const [busy, setBusy] = useState(false);
  const [autoPrint, setAutoPrint] = useState(true);
  const [cfg, setCfg] = useState<Configuracao | null>(null);

  useEffect(() => { 
    if (open) {
      setCart([]);
      // Carregar configuração da loja
      (async () => {
        const { data } = await supabase.from("configuracoes").select("*").limit(1).maybeSingle();
        if (data) {
          setCfg(data as unknown as Configuracao);
        }
      })();
    }
  }, [open]);

  const handleConfirm = async () => {
    const items = cart;
    if (!items.length) return toast.error("Adicione pelo menos um item");

    setBusy(true);
    const pedidoPayload: { conta_id: string; tipo: "mesa"; status: "pendente"; owner_id?: string } = {
      conta_id: contaId,
      tipo: "mesa",
      status: "pendente",
    };
    if (cfg?.owner_id) {
      pedidoPayload.owner_id = cfg.owner_id;
    }

    const { data: pedido, error: e1 } = await supabase
      .from("pedidos")
      .insert(pedidoPayload)
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

    toast.success("Pedido registrado");

    if (autoPrint && mesaNumero != null) {
      printReceipt({
        tipo: "mesa",
        loja_nome: cfg?.nome_loja,
        mesa_numero: mesaNumero,
        pedidos: [{
          numero: 1,
          criado_em: new Date().toISOString(),
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
        }],
        total: cartSubtotal(items),
      });
    }

    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm sm:max-w-2xl md:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Novo Pedido</DialogTitle>
        </DialogHeader>

        <CardapioSelector cart={cart} onCartChange={setCart} />

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
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={handleConfirm} disabled={busy || !cart.length} size="lg">
              {busy ? "Enviando..." : `Enviar (${cart.reduce((s, i) => s + i.quantidade, 0)} itens)`}
            </Button>
          </div>
        </div>
        <span className="hidden">{cartSubtotal(cart)}</span>
      </DialogContent>
    </Dialog>
  );
}
