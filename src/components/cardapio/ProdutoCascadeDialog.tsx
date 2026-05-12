import { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { loadGruposProduto, type GrupoComAdicionais } from "@/lib/adicionais";
import type { Produto } from "@/types/db";
import type { CartItem } from "@/components/cardapio/cartTypes";

interface Props {
  open: boolean;
  produto: Produto | null;
  onClose: () => void;
  onConfirm: (item: CartItem) => void;
  priceResolver?: (produto: Produto) => number;
  color?: string;
  fallbackAllGroups?: boolean;
}

type Selections = Record<string, Record<string, number>>;

export default function ProdutoCascadeDialog({
  open,
  produto,
  onClose,
  onConfirm,
  priceResolver,
  color,
  fallbackAllGroups,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [qtd, setQtd] = useState(1);
  const [obs, setObs] = useState("");
  const [grupos, setGrupos] = useState<GrupoComAdicionais[]>([]);
  const [selecionados, setSelecionados] = useState<Selections>({});

  const precoBase = useMemo(() => {
    if (!produto) return 0;
    return priceResolver ? priceResolver(produto) : Number(produto.preco);
  }, [priceResolver, produto]);

  useEffect(() => {
    if (!open || !produto) return;

    setQtd(1);
    setObs("");
    setSelecionados({});
    setGrupos([]);

    setLoading(true);
    loadGruposProduto(produto.id, { fallbackAllAvailable: fallbackAllGroups })
      .then((data) => setGrupos(data.filter((g) => g.disponivel)))
      .finally(() => setLoading(false));
  }, [open, produto, fallbackAllGroups]);

  const adicionaisSelecionados = useMemo(() => {
    const list: CartItem["adicionais"] = [];

    grupos.forEach((grupo) => {
      const selected = selecionados[grupo.id] || {};
      Object.entries(selected).forEach(([adicionalId, quantidade]) => {
        if (quantidade <= 0) return;
        const adicional = grupo.adicionais.find((a) => a.id === adicionalId);
        if (!adicional) return;

        list.push({
          grupoId: grupo.id,
          grupoNome: grupo.nome,
          adicionalId: adicional.id,
          adicionalNome: adicional.nome,
          quantidade,
          precoUnitario: Number(adicional.preco),
        });
      });
    });

    return list;
  }, [grupos, selecionados]);

  const precoAdicionais = adicionaisSelecionados.reduce(
    (sum, adicional) => sum + adicional.precoUnitario * adicional.quantidade,
    0
  );

  const subtotalUnit = precoBase + precoAdicionais;
  const total = subtotalUnit * qtd;

  const regraGrupo = (grupo: GrupoComAdicionais) => {
    if (grupo.obrigatorio) {
      if (grupo.max_escolhas > 1) return `Obrigatorio, escolha de ${grupo.min_escolhas} a ${grupo.max_escolhas} opcoes`;
      return `Obrigatorio, escolha ${grupo.min_escolhas || 1}`;
    }
    if (grupo.max_escolhas > 1) return `Opcional, ate ${grupo.max_escolhas} opcoes`;
    return "Opcional, ate 1 opcao";
  };

  const gruposObrigatoriosPendentes = useMemo(
    () =>
      grupos.filter((grupo) => {
        if (!grupo.obrigatorio) return false;
        const totalGrupo = Object.values(selecionados[grupo.id] || {}).reduce((sum, qty) => sum + qty, 0);
        return totalGrupo < Math.max(1, grupo.min_escolhas);
      }),
    [grupos, selecionados]
  );

  const canConfirm = gruposObrigatoriosPendentes.length === 0;

  const quantidadeGrupo = (grupoId: string) =>
    Object.values(selecionados[grupoId] || {}).reduce((sum, qty) => sum + qty, 0);

  const updateAdicionalQuantidade = (
    grupoId: string,
    adicionalId: string,
    delta: number,
    max: number,
    disponivel: boolean
  ) => {
    if (!disponivel) return;

    setSelecionados((prev) => {
      const currentGroup = prev[grupoId] || {};
      const currentQty = currentGroup[adicionalId] || 0;
      const currentTotal = Object.values(currentGroup).reduce((sum, qty) => sum + qty, 0);

      if (delta > 0 && currentTotal >= max) {
        return prev;
      }

      const nextQty = Math.max(0, currentQty + delta);

      const nextGroup = { ...currentGroup };
      if (nextQty <= 0) delete nextGroup[adicionalId];
      else nextGroup[adicionalId] = nextQty;

      return {
        ...prev,
        [grupoId]: nextGroup,
      };
    });
  };

  const toggleAdicional = (grupoId: string, adicionalId: string, max: number, disponivel: boolean) => {
    if (!disponivel) return;
    const currentQty = (selecionados[grupoId] || {})[adicionalId] || 0;
    if (currentQty > 0) {
      setSelecionados((prev) => {
        const currentGroup = prev[grupoId] || {};
        const nextGroup = { ...currentGroup };
        delete nextGroup[adicionalId];
        return { ...prev, [grupoId]: nextGroup };
      });
      return;
    }
    updateAdicionalQuantidade(grupoId, adicionalId, 1, max, disponivel);
  };

  const grupoCheio = (grupoId: string, max: number) => quantidadeGrupo(grupoId) >= max;

  const isSelecionado = (grupoId: string, adicionalId: string) =>
    ((selecionados[grupoId] || {})[adicionalId] || 0) > 0;

  const quantidadeSelecionada = (grupoId: string, adicionalId: string) =>
    (selecionados[grupoId] || {})[adicionalId] || 0;

  const handleConfirm = () => {
    if (!produto || !canConfirm) return;

    onConfirm({
      id: crypto.randomUUID(),
      produto,
      quantidade: qtd,
      observacao: obs.trim().slice(0, 200),
      adicionais: adicionaisSelecionados,
      precoBaseUnit: precoBase,
      precoAdicionaisUnit: precoAdicionais,
      precoUnit: subtotalUnit,
    });

    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading && <p className="text-sm text-muted-foreground">Carregando adicionais...</p>}

          {!loading && produto && (
            <div className="space-y-4">
              {produto.imagem_url && (
                <div className="h-56 rounded-xl overflow-hidden border">
                  <img src={produto.imagem_url} alt={produto.nome} className="w-full h-full object-cover" />
                </div>
              )}

              <DialogHeader>
                <DialogTitle className="text-2xl">{produto.nome}</DialogTitle>
              </DialogHeader>

              {produto.descricao && <p className="text-sm text-muted-foreground">{produto.descricao}</p>}

              <div className="text-xl font-bold text-primary">{brl(precoBase)}</div>

              <div className="flex items-center gap-3 border rounded-lg p-3">
                <Label className="flex-1 font-semibold">Quantidade</Label>
                <Button size="icon" variant="outline" onClick={() => setQtd((v) => Math.max(1, v - 1))}>
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="text-2xl font-bold w-10 text-center">{qtd}</span>
                <Button size="icon" variant="outline" onClick={() => setQtd((v) => v + 1)}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Observacao</Label>
                <Textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  maxLength={200}
                  placeholder="Ex.: sem cebola"
                />
              </div>
            </div>
          )}

          {!loading && grupos.map((grupo) => (
            <div key={grupo.id} className="space-y-4">
              <div>
                <h3 className="text-xl font-bold">{grupo.nome}</h3>
                <p className="text-sm text-muted-foreground">{regraGrupo(grupo)}</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {grupo.adicionais.map((adicional) => {
                  const selected = isSelecionado(grupo.id, adicional.id);
                  const qtdAdicional = quantidadeSelecionada(grupo.id, adicional.id);
                  return (
                    <button
                      type="button"
                      key={adicional.id}
                      disabled={!adicional.disponivel}
                      onClick={() =>
                        toggleAdicional(grupo.id, adicional.id, grupo.max_escolhas, adicional.disponivel)
                      }
                      className={cn(
                        "text-left border rounded-xl p-3 transition",
                        selected ? "border-primary ring-2 ring-primary/30" : "border-border",
                        !adicional.disponivel && "opacity-50 cursor-not-allowed bg-muted"
                      )}
                    >
                      {adicional.imagem_url && (
                        <div className="h-28 rounded-lg overflow-hidden mb-2 bg-muted">
                          <img src={adicional.imagem_url} alt={adicional.nome} className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="font-semibold">{adicional.nome}</div>
                      <div className="text-sm text-muted-foreground">
                        {Number(adicional.preco) > 0 ? `+ ${brl(Number(adicional.preco))}` : "Gratis"}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateAdicionalQuantidade(grupo.id, adicional.id, -1, grupo.max_escolhas, adicional.disponivel);
                          }}
                          disabled={!adicional.disponivel || qtdAdicional === 0}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold">{qtdAdicional}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateAdicionalQuantidade(grupo.id, adicional.id, 1, grupo.max_escolhas, adicional.disponivel);
                          }}
                          disabled={!adicional.disponivel || (!selected && grupoCheio(grupo.id, grupo.max_escolhas))}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </button>
                  );
                })}
              </div>

              {grupo.max_escolhas > 1 && (
                <p className="text-xs text-muted-foreground">
                  Selecionados: {quantidadeGrupo(grupo.id)}/{grupo.max_escolhas}
                </p>
              )}
            </div>
          ))}

          {!loading && (
            <div className="border rounded-xl p-4 space-y-2">
              {adicionaisSelecionados.map((adicional) => (
                <div key={adicional.adicionalId} className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{adicional.grupoNome}: {adicional.adicionalNome}</span>
                  <span>{adicional.precoUnitario > 0 ? `+ ${brl(adicional.precoUnitario)}` : "Gratis"}</span>
                </div>
              ))}
              <div className="border-t pt-2 text-sm flex items-center justify-between">
                <span>Unitario</span>
                <span>{brl(subtotalUnit)}</span>
              </div>
              <div className="text-lg font-bold flex items-center justify-between">
                <span>Total x{qtd}</span>
                <span>{brl(total)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4 space-y-2">
          {!canConfirm && (
            <p className="text-xs text-destructive">
              Complete os grupos obrigatorios: {gruposObrigatoriosPendentes.map((g) => g.nome).join(", ")}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              className="text-white"
              style={color ? { backgroundColor: color } : undefined}
              onClick={handleConfirm}
              disabled={!canConfirm}
            >
              Adicionar ao carrinho - {brl(total)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
