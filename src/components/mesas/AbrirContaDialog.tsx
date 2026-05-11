import { useState } from "react";
import { Mesa } from "@/types/db";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Props {
  mesa: Mesa | null;
  onClose: () => void;
  onOpened: () => void;
}

export default function AbrirContaDialog({ mesa, onClose, onOpened }: Props) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (!mesa) return;
    setBusy(true);
    const { error: e1 } = await supabase
      .from("contas")
      .insert({ mesa_id: mesa.id, status: "aberta", total: 0 });
    if (e1) { setBusy(false); return toast.error(e1.message); }

    const { error: e2 } = await supabase
      .from("mesas")
      .update({ status: "ocupada" })
      .eq("id", mesa.id);

    setBusy(false);
    if (e2) return toast.error(e2.message);
    toast.success(`Mesa ${mesa.numero} aberta`);
    onOpened();
  };

  return (
    <Dialog open={!!mesa} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Abrir mesa {mesa?.numero}?</DialogTitle>
          <DialogDescription>
            Uma nova conta será criada e a mesa marcada como ocupada.
          </DialogDescription>
        </DialogHeader>
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
