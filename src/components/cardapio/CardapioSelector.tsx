import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Categoria, Produto } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { brl } from "@/lib/format";
import ProdutoCascadeDialog from "@/components/cardapio/ProdutoCascadeDialog";
import type { Cart, CartItem } from "@/components/cardapio/cartTypes";
import { cartSubtotal } from "@/components/cardapio/cartTypes";

interface Props {
  cart: Cart;
  onCartChange: (cart: Cart) => void;
  extraTotal?: number;
  extraRow?: React.ReactNode;
  heightClass?: string;
}

export type { Cart, CartItem };
export { cartSubtotal };

export default function CardapioSelector({
  cart,
  onCartChange,
  extraTotal = 0,
  extraRow,
  heightClass = "h-[45vh]",
}: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null);

  const categoriaById = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const isHamburger = (produto: Produto | null) => {
    if (!produto) return false;
    const categoria = produto.categoria_id ? categoriaById.get(produto.categoria_id) : null;
    const categoriaNome = normalize(categoria?.nome || "");
    const produtoNome = normalize(produto.nome || "");
    return (
      categoriaNome.includes("lanche") ||
      categoriaNome.includes("hamburg") ||
      categoriaNome.includes("burger") ||
      produtoNome.includes("hamburg") ||
      produtoNome.includes("burger")
    );
  };

  useEffect(() => {
    (async () => {
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase.from("categorias").select("*").eq("ativo", true).order("ordem").order("nome"),
        supabase.from("produtos").select("*").eq("disponivel", true).order("ordem"),
      ]);
      setCategorias((cs || []) as Categoria[]);
      setProdutos((ps || []) as Produto[]);
    })();
  }, []);

  const subtotal = useMemo(() => cartSubtotal(cart), [cart]);
  const total = subtotal + extraTotal;

  const updateItemQty = (itemId: string, delta: number) => {
    const updated = cart
      .map((item) => {
        if (item.id !== itemId) return item;
        return { ...item, quantidade: Math.max(0, item.quantidade + delta) };
      })
      .filter((item) => item.quantidade > 0);

    onCartChange(updated);
  };

  const removeItem = (itemId: string) => onCartChange(cart.filter((item) => item.id !== itemId));

  const updateObs = (itemId: string, observacao: string) => {
    onCartChange(
      cart.map((item) =>
        item.id === itemId
          ? {
              ...item,
              observacao: observacao.slice(0, 200),
            }
          : item
      )
    );
  };

  const totalItens = cart.reduce((sum, item) => sum + item.quantidade, 0);

  return (
    <>
      <div className="grid md:grid-cols-[1fr_320px] gap-0 border rounded-lg overflow-hidden bg-card">
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
                    {produtos.filter((p) => p.categoria_id === c.id).map((p) => (
                      <Card key={p.id} className="p-3 flex flex-col gap-2 hover:shadow-card transition-shadow">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <div className="font-semibold text-sm leading-tight">{p.nome}</div>
                            {p.descricao && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.descricao}</p>}
                          </div>
                          <div className="text-primary font-semibold text-sm whitespace-nowrap">{brl(Number(p.preco))}</div>
                        </div>
                        <div className="flex justify-end mt-auto pt-1">
                          <Button size="sm" onClick={() => setProdutoSelecionado(p)}>Adicionar</Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <div className="bg-muted/30 flex flex-col min-h-0">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Itens</div>
            <div className="text-xs text-muted-foreground">{totalItens} item(ns)</div>
          </div>
          <ScrollArea className={heightClass}>
            <div className="p-3 space-y-2">
              {cart.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">Nenhum item adicionado</p>
              )}
              {cart.map((item) => (
                <Card key={item.id} className="p-2 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div className="text-xs font-medium">{item.quantidade}x {item.produto.nome}</div>
                    <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {item.adicionais.length > 0 && (
                    <div className="space-y-0.5">
                      {item.adicionais.map((adicional) => (
                        <div key={`${item.id}-${adicional.adicionalId}`} className="text-[11px] text-muted-foreground">
                          + {adicional.grupoNome}: {adicional.adicionalNome} x{adicional.quantidade} {adicional.precoUnitario > 0 ? `(${brl(adicional.precoUnitario)})` : "(gratis)"}
                        </div>
                      ))}
                    </div>
                  )}

                  <Input
                    placeholder="Observacao"
                    value={item.observacao}
                    onChange={(e) => updateObs(item.id, e.target.value)}
                    maxLength={200}
                    className="h-7 text-xs"
                  />

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateItemQty(item.id, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-5 text-center text-sm font-semibold">{item.quantidade}</span>
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateItemQty(item.id, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="text-xs text-right text-muted-foreground">{brl(item.precoUnit * item.quantidade)}</div>
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

      <ProdutoCascadeDialog
        open={!!produtoSelecionado}
        produto={produtoSelecionado}
        onClose={() => setProdutoSelecionado(null)}
        onConfirm={(item) => onCartChange([...cart, item])}
        fallbackAllGroups={isHamburger(produtoSelecionado)}
      />
    </>
  );
}
