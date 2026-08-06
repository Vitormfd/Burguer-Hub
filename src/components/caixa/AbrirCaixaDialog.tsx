import { useEffect, useState } from "react";
import { Save, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCaixaMoneyInput, parseCaixaMoney } from "@/hooks/useCaixaAberto";
import { toast } from "sonner";

type Props = {
  open: boolean;
  sugestaoValorInicial?: number | null;
  onClose: () => void;
  onOpened: () => void;
};

export default function AbrirCaixaDialog({ open, sugestaoValorInicial, onClose, onOpened }: Props) {
  const [valor, setValor] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValor(
      sugestaoValorInicial != null && Number.isFinite(sugestaoValorInicial)
        ? formatCaixaMoneyInput(sugestaoValorInicial)
        : "",
    );
    setObservacoes("");
  }, [open, sugestaoValorInicial]);

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) onClose();
  };

  const save = async () => {
    if (!valor.trim()) {
      toast.error("Informe o valor inicial");
      return;
    }

    const valorInicial = Number(parseCaixaMoney(valor).toFixed(2));
    if (valorInicial < 0) {
      toast.error("Valor inicial inválido");
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc("abrir_caixa", {
      p_valor_inicial: valorInicial,
      p_observacoes: observacoes.trim() || null,
    });
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Caixa aberto");
    onOpened();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" />
            Abrir caixa
          </DialogTitle>
          <DialogDescription>
            É preciso abrir o caixa antes de vender. Informe o valor inicial para começar a sessão do dia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="abrir-caixa-valor">Valor inicial</Label>
            <Input
              id="abrir-caixa-valor"
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              placeholder="Ex: 100,00"
              inputMode="decimal"
              autoFocus
            />
            {sugestaoValorInicial != null && (
              <p className="text-xs text-muted-foreground">
                Sugestão com base no último caixa: {formatCaixaMoneyInput(sugestaoValorInicial)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="abrir-caixa-obs">Observações</Label>
            <Textarea
              id="abrir-caixa-obs"
              value={observacoes}
              onChange={(event) => setObservacoes(event.target.value)}
              placeholder="Anotações da abertura (opcional)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            <Save className="h-4 w-4 mr-1" />
            {busy ? "Abrindo..." : "Abrir caixa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
