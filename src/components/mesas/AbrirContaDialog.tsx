import { useEffect, useState } from "react";
import { Mesa, ModalidadeConsumo } from "@/types/db";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import { ShoppingBag, UtensilsCrossed } from "lucide-react";

interface Props {
  mesa: Mesa | null;
  onClose: () => void;
  onOpened: () => void;
  onMesaUpdated?: () => void;
}

const modalidadeLabel: Record<ModalidadeConsumo, string> = {
  local: "Consumir no local",
  levar: "Levar",
};

export default function AbrirContaDialog({ mesa, onClose, onOpened, onMesaUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const [modalidade, setModalidade] = useState<ModalidadeConsumo>("local");

  useEffect(() => {
    if (mesa) setModalidade("local");
  }, [mesa]);

  const handleConfirm = async () => {
    if (!mesa) return;
    setBusy(true);
    const { error: e1 } = await supabase
      .from("contas")
      .insert({ mesa_id: mesa.id, status: "aberta", total: 0, modalidade_consumo: modalidade });
    if (e1) { setBusy(false); return toast.error(e1.message); }

    const { error: e2 } = await supabase
      .from("mesas")
      .update({ status: "ocupada" })
      .eq("id", mesa.id);

    setBusy(false);
    if (e2) return toast.error(e2.message);
    toast.success(`Mesa ${mesa.numero} aberta · ${modalidadeLabel[modalidade]}`);
    onOpened();
    onMesaUpdated?.();
  };

  return (
    <Dialog open={!!mesa} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Abrir mesa {mesa?.numero}?</DialogTitle>
          <DialogDescription>
            Escolha a modalidade e a mesa será marcada como ocupada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <p className="text-sm font-medium text-foreground">Modalidade</p>
          <ToggleGroup
            type="single"
            value={modalidade}
            onValueChange={(v) => { if (v) setModalidade(v as ModalidadeConsumo); }}
            className="grid grid-cols-2 gap-2"
          >
            <ToggleGroupItem
              value="local"
              aria-label="Consumir no local"
              className="h-auto flex-col gap-1.5 py-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <UtensilsCrossed className="h-5 w-5" />
              <span className="text-sm font-medium">Consumir no local</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="levar"
              aria-label="Levar"
              className="h-auto flex-col gap-1.5 py-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <ShoppingBag className="h-5 w-5" />
              <span className="text-sm font-medium">Levar</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? "Abrindo..." : "Abrir conta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
