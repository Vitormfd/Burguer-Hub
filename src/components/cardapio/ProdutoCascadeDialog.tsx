import { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
}

type Selections = Record<string, string[]>;

export default function ProdutoCascadeDialog({
  open,
  produto,
  onClose,
  onConfirm,
  priceResolver,
  color,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
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

    setStep(0);
    setQtd(1);
    setObs("");
    setSelecionados({});
    setGrupos([]);

    setLoading(true);
    loadGruposProduto(produto.id)
      .then((data) => setGrupos(data.filter((g) => g.disponivel)))
      .finally(() => setLoading(false));
  }, [open, produto]);

  const totalSteps = grupos.length + 2;
  const onSummary = step === totalSteps - 1;
  const onProductStep = step === 0;
  const grupoAtual = !onProductStep && !onSummary ? grupos[step - 1] : null;

  const adicionaisSelecionados = useMemo(() => {
    const list: CartItem["adicionais"] = [];

    grupos.forEach((grupo) => {
      const selected = selecionados[grupo.id] || [];
      selected.forEach((adicionalId) => {
        const adicional = grupo.adicionais.find((a) => a.id === adicionalId);
        if (!adicional) return;

        list.push({
          grupoId: grupo.id,
          grupoNome: grupo.nome,
          adicionalId: adicional.id,
          adicionalNome: adicional.nome,
          quantidade: 1,
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

  const canProceedCurrentStep = useMemo(() => {
    if (!grupoAtual) return true;
    const selectedCount = (selecionados[grupoAtual.id] || []).length;
    if (!grupoAtual.obrigatorio) return true;
    return selectedCount >= Math.max(1, grupoAtual.min_escolhas);
  }, [grupoAtual, selecionados]);

  const toggleAdicional = (grupoId: string, adicionalId: string, max: number, disponivel: boolean) => {
    if (!disponivel) return;

    setSelecionados((prev) => {
      const current = prev[grupoId] || [];
      if (current.includes(adicionalId)) {
        return {
          ...prev,
          [grupoId]: current.filter((id) => id !== adicionalId),
        };
      }

      if (max <= 1) {
        return {
          ...prev,
          [grupoId]: [adicionalId],
        };
      }

      if (current.length >= max) return prev;

      return {
        ...prev,
        [grupoId]: [...current, adicionalId],
      };
    });
  };

  const handleNext = () => {
    if (onSummary || !produto) return;
    setStep((s) => Math.min(totalSteps - 1, s + 1));
  };

  const handleBack = () => setStep((s) => Math.max(0, s - 1));

  const handleConfirm = () => {
    if (!produto) return;

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
        <div className="p-4 border-b space-y-2 bg-muted/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Etapa {step + 1} de {totalSteps}</span>
            <span>{Math.round(((step + 1) / totalSteps) * 100)}%</span>
          </div>
          <Progress value={((step + 1) / totalSteps) * 100} className="h-2" />
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading && <p className="text-sm text-muted-foreground">Carregando adicionais...</p>}

          {!loading && onProductStep && produto && (
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

          {!loading && grupoAtual && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-bold">{grupoAtual.nome}</h3>
                <p className="text-sm text-muted-foreground">{regraGrupo(grupoAtual)}</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {grupoAtual.adicionais.map((adicional) => {
                  const selected = (selecionados[grupoAtual.id] || []).includes(adicional.id);
                  return (
                    <button
                      type="button"
                      key={adicional.id}
                      disabled={!adicional.disponivel}
                      onClick={() =>
                        toggleAdicional(grupoAtual.id, adicional.id, grupoAtual.max_escolhas, adicional.disponivel)
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
                    </button>
                  );
                })}
              </div>

              {grupoAtual.max_escolhas > 1 && (
                <p className="text-xs text-muted-foreground">
                  Selecionados: {(selecionados[grupoAtual.id] || []).length}/{grupoAtual.max_escolhas}
                </p>
              )}
            </div>
          )}

          {!loading && onSummary && produto && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">Resumo do pedido</h3>
              <div className="border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{produto.nome}</span>
                  <span>{brl(precoBase)}</span>
                </div>
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
            </div>
          )}
        </div>

        <div className="border-t p-4 flex items-center justify-between gap-2">
          <Button variant="outline" onClick={handleBack} disabled={step === 0}>
            Voltar
          </Button>

          {onSummary ? (
            <Button className="text-white" style={color ? { backgroundColor: color } : undefined} onClick={handleConfirm}>
              Adicionar ao carrinho - {brl(total)}
            </Button>
          ) : (
            <Button
              className="text-white"
              style={color ? { backgroundColor: color } : undefined}
              onClick={handleNext}
              disabled={!!grupoAtual && !canProceedCurrentStep}
            >
              {step === 0 && grupos.length === 0 ? "Ver resumo" : "Proximo"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
