import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function NovaMesaDialog({ open, onClose, onCreated }: Props) {
  const [numero, setNumero] = useState("");
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (!numero.trim()) {
      return toast.error("Digite o número da mesa");
    }

    setBusy(true);
    const { error } = await supabase
      .from("mesas")
      .insert({
        numero: parseInt(numero),
        status: "livre",
      });

    setBusy(false);
    if (error) {
      return toast.error(error.message);
    }

    toast.success("Mesa criada com sucesso");
    setNumero("");
    onCreated();
    onClose();
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setNumero("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Nova Mesa</DialogTitle>
          <DialogDescription>
            Cadastre uma nova mesa no sistema
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Número da mesa</label>
            <Input
              type="number"
              placeholder="Ex: 1, 2, 3..."
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? "Criando..." : "Criar mesa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
