import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import CardapioSelector, { Cart } from "@/components/cardapio/CardapioSelector";
import {
  cartSubtotal,
  loadPedidoCart,
  replacePedidoItens,
  updateDeliveryPedidoTotals,
} from "@/lib/pedidoEdit";
import { brl } from "@/lib/format";
import { printReceipt } from "@/lib/print";
import type { Configuracao } from "@/types/db";

const deliverySchema = z.object({
  cliente_nome: z.string().trim().min(2, "Nome muito curto").max(100),
  cliente_telefone: z.string().trim().min(8, "Telefone inválido").max(20),
  endereco: z.string().trim().min(5, "Endereço incompleto").max(200),
  numero: z.string().trim().min(1, "Número inválido").max(20),
  complemento: z.string().trim().max(200).optional().or(z.literal("")),
  bairro: z.string().trim().max(80).optional().or(z.literal("")),
  taxa_entrega: z.number().min(0, "Taxa inválida").max(999),
});

interface BairroTaxaOption {
  nome: string;
  taxa: number;
}

interface Props {
  open: boolean;
  pedidoId: string | null;
  variant: "mesa" | "delivery";
  mesaNumero?: number;
  tipoEntrega?: "delivery" | "retirada";
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export default function EditarPedidoDialog({
  open,
  pedidoId,
  variant,
  mesaNumero,
  tipoEntrega = "delivery",
  onClose,
  onSaved,
}: Props) {
  const [cart, setCart] = useState<Cart>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [cfg, setCfg] = useState<Configuracao | null>(null);

  const [entregaId, setEntregaId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [endereco, setEndereco] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [taxa, setTaxa] = useState("0");
  const [bairrosTaxas, setBairrosTaxas] = useState<BairroTaxaOption[]>([]);

  const isRetirada = tipoEntrega === "retirada";
  const taxaNum = isRetirada ? 0 : Number(taxa.replace(",", ".")) || 0;
  const subtotal = cartSubtotal(cart);

  const normalizeBairro = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const applyTaxaFromBairro = (bairroValue: string, fallbackToZero = false) => {
    if (isRetirada) {
      setTaxa("0");
      return;
    }
    const normalized = normalizeBairro(bairroValue);
    if (!normalized) {
      if (fallbackToZero) setTaxa("0");
      return;
    }
    const match = bairrosTaxas.find((item) => normalizeBairro(item.nome) === normalized);
    if (match) {
      setTaxa(String(Number(match.taxa || 0)));
      return;
    }
    if (fallbackToZero) setTaxa("0");
  };

  useEffect(() => {
    if (!open || !pedidoId) return;

    let cancelled = false;
    setLoading(true);
    setCart([]);

    (async () => {
      try {
        const [{ data: cfgData }, { data: bairrosData }] = await Promise.all([
          supabase.from("configuracoes").select("*").limit(1).maybeSingle(),
          variant === "delivery"
            ? supabase.from("bairros_taxas").select("nome, taxa").eq("ativo", true).order("nome")
            : Promise.resolve({ data: [] as BairroTaxaOption[] }),
        ]);

        if (cancelled) return;
        if (cfgData) setCfg(cfgData as unknown as Configuracao);
        if (bairrosData) setBairrosTaxas((bairrosData || []) as BairroTaxaOption[]);

        const loadedCart = await loadPedidoCart(pedidoId);
        if (cancelled) return;
        setCart(loadedCart);

        if (variant === "delivery") {
          const { data: entrega, error } = await supabase
            .from("entregas")
            .select("*")
            .eq("pedido_id", pedidoId)
            .maybeSingle();

          if (error) throw new Error(error.message);
          if (entrega) {
            setEntregaId(entrega.id);
            setNome(entrega.cliente_nome);
            setTel(entrega.cliente_telefone);
            setEndereco(entrega.endereco);
            setNumero(entrega.numero || "");
            setComplemento(entrega.complemento || "");
            setBairro(entrega.bairro || "");
            setTaxa(String(Number(entrega.taxa_entrega || 0)));
          }
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Erro ao carregar pedido");
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, pedidoId, variant, onClose]);

  useEffect(() => {
    if (!open || isRetirada || !bairro) return;
    applyTaxaFromBairro(bairro);
  }, [bairro, bairrosTaxas, open, isRetirada]);

  const handleSave = async () => {
    if (!pedidoId) return;
    if (!cart.length) return toast.error("Adicione pelo menos um item");

    let deliveryParsed: z.infer<typeof deliverySchema> | null = null;
    if (variant === "delivery") {
      const parsed = deliverySchema.safeParse({
        cliente_nome: nome,
        cliente_telefone: tel,
        endereco: isRetirada ? endereco || "Retirada no balcão" : endereco,
        numero: isRetirada ? numero || "-" : numero,
        complemento,
        bairro,
        taxa_entrega: taxaNum,
      });
      if (!parsed.success) return toast.error(parsed.error.errors[0].message);
      deliveryParsed = parsed.data;
    }

    setBusy(true);
    try {
      await replacePedidoItens(pedidoId, cart);

      if (variant === "delivery" && deliveryParsed && entregaId) {
        const { error: entregaError } = await supabase
          .from("entregas")
          .update({
            cliente_nome: deliveryParsed.cliente_nome,
            cliente_telefone: deliveryParsed.cliente_telefone,
            endereco: deliveryParsed.endereco,
            numero: deliveryParsed.numero,
            complemento: deliveryParsed.complemento || null,
            bairro: deliveryParsed.bairro || null,
            taxa_entrega: deliveryParsed.taxa_entrega,
          })
          .eq("id", entregaId);

        if (entregaError) throw new Error(entregaError.message);
        await updateDeliveryPedidoTotals(pedidoId, deliveryParsed.taxa_entrega);
      }

      toast.success("Pedido atualizado");

      if (autoPrint) {
        if (variant === "mesa" && mesaNumero != null) {
          printReceipt({
            tipo: "mesa",
            loja_nome: cfg?.nome_loja,
            mesa_numero: mesaNumero,
            pedidos: [{
              numero: 1,
              criado_em: new Date().toISOString(),
              itens: cart.map((item) => ({
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
            total: subtotal,
          });
        } else if (variant === "delivery" && deliveryParsed) {
          printReceipt({
            tipo: tipoEntrega,
            loja_nome: cfg?.nome_loja,
            cliente_nome: deliveryParsed.cliente_nome,
            cliente_telefone: deliveryParsed.cliente_telefone,
            endereco: deliveryParsed.endereco,
            numero: deliveryParsed.numero,
            complemento: deliveryParsed.complemento || null,
            bairro: deliveryParsed.bairro || null,
            taxa_entrega: deliveryParsed.taxa_entrega,
            itens: cart.map((item) => ({
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
            total: subtotal + deliveryParsed.taxa_entrega,
            criado_em: new Date().toISOString(),
          });
        }
      }

      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar pedido");
    } finally {
      setBusy(false);
    }
  };

  const titulo =
    variant === "mesa"
      ? `Editar pedido — Mesa ${mesaNumero ?? ""}`
      : isRetirada
        ? "Editar pedido — Retirada"
        : "Editar pedido — Delivery";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm sm:max-w-2xl md:max-w-4xl lg:max-w-5xl max-h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pb-2">
          <DialogTitle className="font-display text-2xl">{titulo}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Carregando pedido...</p>
        ) : (
          <>
            {variant === "delivery" && (
              <div className="shrink-0 grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2 pb-2">
                <div className="col-span-2 md:col-span-4 space-y-1">
                  <Label htmlFor="e-nome" className="text-xs">Nome do cliente *</Label>
                  <Input id="e-nome" className="h-9" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
                </div>
                <div className="col-span-2 md:col-span-2 space-y-1">
                  <Label htmlFor="e-tel" className="text-xs">Telefone *</Label>
                  <Input id="e-tel" className="h-9" value={tel} onChange={(e) => setTel(e.target.value)} maxLength={20} />
                </div>
                {!isRetirada && (
                  <>
                    <div className="col-span-2 md:col-span-3 space-y-1">
                      <Label htmlFor="e-end" className="text-xs">Endereço *</Label>
                      <Input id="e-end" className="h-9" value={endereco} onChange={(e) => setEndereco(e.target.value)} maxLength={200} />
                    </div>
                    <div className="col-span-1 md:col-span-1 space-y-1">
                      <Label htmlFor="e-numero" className="text-xs">Nº *</Label>
                      <Input id="e-numero" className="h-9" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} />
                    </div>
                    <div className="col-span-1 md:col-span-2 space-y-1">
                      <Label htmlFor="e-complemento" className="text-xs">Complemento</Label>
                      <Input id="e-complemento" className="h-9" value={complemento} onChange={(e) => setComplemento(e.target.value)} maxLength={200} />
                    </div>
                    <div className="col-span-1 md:col-span-4 space-y-1">
                      <Label htmlFor="e-bairro" className="text-xs">Bairro</Label>
                      <Input
                        id="e-bairro"
                        className="h-9"
                        value={bairro}
                        onChange={(e) => setBairro(e.target.value)}
                        onBlur={() => applyTaxaFromBairro(bairro, true)}
                        maxLength={80}
                      />
                    </div>
                    <div className="col-span-1 md:col-span-2 space-y-1">
                      <Label htmlFor="e-taxa" className="text-xs">Taxa (R$)</Label>
                      <Input
                        id="e-taxa"
                        className="h-9"
                        type="number"
                        min={0}
                        max={999}
                        step="0.50"
                        value={taxa}
                        onChange={(e) => setTaxa(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex-1 min-h-0">
              <CardapioSelector
                cart={cart}
                onCartChange={setCart}
                extraTotal={variant === "delivery" ? taxaNum : 0}
                extraRow={
                  variant === "delivery" && !isRetirada ? (
                    <div className="flex justify-between text-xs">
                      <span>Taxa de entrega</span>
                      <span>{brl(taxaNum)}</span>
                    </div>
                  ) : undefined
                }
                heightClass="h-[52vh] min-h-[280px]"
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
                Imprimir após salvar
              </label>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={busy}>
                  Cancelar
                </Button>
                <Button onClick={handleSave} disabled={busy || !cart.length} size="lg">
                  {busy
                    ? "Salvando..."
                    : variant === "delivery"
                      ? `Salvar — ${brl(subtotal + taxaNum)}`
                      : `Salvar (${cart.reduce((s, i) => s + i.quantidade, 0)} itens)`}
                </Button>
              </div>
            </div>
            <span className="hidden">{cartSubtotal(cart)}</span>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
