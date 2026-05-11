import { useEffect, useMemo, useState } from "react";
import { Categoria, Produto } from "@/types/db";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { brl } from "@/lib/format";
import { Minus, Plus, Trash2 } from "lucide-react";

export interface CartItem {
  produto: Produto;
  quantidade: number;
  observacao: string;
}

export type Cart = Record<string, CartItem>;

interface Props {
  cart: Cart;
  onCartChange: (cart: Cart) => void;
  /** Optional extra row above the total (e.g. delivery fee) */
  extraTotal?: number;
  extraRow?: React.ReactNode;
  /** Custom height class for the categories panel */
  heightClass?: string;
}

export const cartSubtotal = (cart: Cart) =>
  Object.values(cart).reduce((s, i) => s + Number(i.produto.preco) * i.quantidade, 0);

export default function CardapioSelector({
  cart, onCartChange, extraTotal = 0, extraRow, heightClass = "h-[45vh]",
}: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase.from("categorias").select("*").eq("ativo", true).order("nome"),
        supabase.from("produtos").select("*").eq("disponivel", true).order("nome"),
      ]);
      setCategorias((cs || []) as Categoria[]);
      setProdutos((ps || []) as Produto[]);
    })();
  }, []);

  const subtotal = useMemo(() => cartSubtotal(cart), [cart]);
  const total = subtotal + extraTotal;

  const updateQty = (p: Produto, delta: number) => {
    const cur = cart[p.id]?.quantidade ?? 0;
    const next = Math.max(0, cur + delta);
    const copy = { ...cart };
    if (next === 0) delete copy[p.id];
    else copy[p.id] = { produto: p, quantidade: next, observacao: cart[p.id]?.observacao ?? "" };
    onCartChange(copy);
  };

  const setObs = (id: string, obs: string) => {
    if (!cart[id]) return;
    onCartChange({ ...cart, [id]: { ...cart[id], observacao: obs.slice(0, 200) } });
  };

  return (
    <div className="grid md:grid-cols-[1fr_300px] gap-0 border rounded-lg overflow-hidden bg-card">
      <div className="min-h-0 flex flex-col border-r">
        <Tabs defaultValue={categorias[0]?.id} className="flex-1 flex flex-col min-h-0">
          <ScrollArea className="px-4">
            <TabsList className="my-2">
              {categorias.map((c) => (
                <TabsTrigger key={c.id} value={c.id}>{c.nome}</TabsTrigger>
              ))}
            </TabsList>
          </ScrollArea>

          {categorias.map((c) => (
            <TabsContent key={c.id} value={c.id} className="flex-1 min-h-0 m-0">
              <ScrollArea className={`${heightClass} px-4 pb-4`}>
                <div className="grid sm:grid-cols-2 gap-3">
                  {produtos.filter((p) => p.categoria_id === c.id).map((p) => {
                    const qty = cart[p.id]?.quantidade ?? 0;
                    return (
                      <Card key={p.id} className="p-3 flex flex-col gap-2 hover:shadow-card transition-shadow">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <div className="font-semibold text-sm leading-tight">{p.nome}</div>
                            {p.descricao && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.descricao}</p>}
                          </div>
                          <div className="text-primary font-semibold text-sm whitespace-nowrap">{brl(Number(p.preco))}</div>
                        </div>
                        <div className="flex items-center justify-between mt-auto pt-1">
                          <div className="flex items-center gap-2">
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(p, -1)} disabled={qty === 0}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-5 text-center text-sm font-semibold">{qty}</span>
                            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(p, 1)}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          {qty === 0 && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateQty(p, 1)}>
                              Adicionar
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="bg-muted/30 flex flex-col min-h-0">
        <div className="p-3 border-b">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Itens</div>
        </div>
        <ScrollArea className={heightClass}>
          <div className="p-3 space-y-2">
            {Object.values(cart).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">Nenhum item adicionado</p>
            )}
            {Object.values(cart).map((i) => (
              <Card key={i.produto.id} className="p-2 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="text-xs font-medium">{i.quantidade}× {i.produto.nome}</div>
                  <button onClick={() => updateQty(i.produto, -i.quantidade)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <Input
                  placeholder="Observação"
                  value={i.observacao}
                  onChange={(e) => setObs(i.produto.id, e.target.value)}
                  maxLength={200}
                  className="h-7 text-xs"
                />
                <div className="text-xs text-right text-muted-foreground">
                  {brl(Number(i.produto.preco) * i.quantidade)}
                </div>
              </Card>
            ))}
          </div>
        </ScrollArea>
        <div className="p-3 border-t bg-card space-y-2">
          <div className="flex justify-between text-xs">
            <span>Subtotal</span><span>{brl(subtotal)}</span>
          </div>
          {extraRow}
          <div className="flex justify-between items-center pt-2 border-t">
            <span className="text-xs uppercase tracking-wider font-semibold">Total</span>
            <span className="font-display text-2xl text-primary">{brl(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
