import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Categoria } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const schema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(60),
  ativo: z.boolean(),
  icone: z.string().trim().max(4).optional().or(z.literal("")),
  destaque: z.boolean(),
  emoji: z.string().trim().max(4).optional().or(z.literal("")),
});

interface Props {
  open: boolean;
  categoria: Categoria | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function CategoriaDialog({ open, categoria, onClose, onSaved }: Props) {
  const [nome, setNome] = useState("");
  const [icone, setIcone] = useState("");
  const [emoji, setEmoji] = useState("");
  const [destaque, setDestaque] = useState(false);
  const [ativo, setAtivo] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNome(categoria?.nome ?? "");
      setAtivo(categoria?.ativo ?? true);
      setIcone(categoria?.icone ?? "");
      setEmoji(categoria?.emoji ?? "");
      setDestaque(categoria?.destaque ?? false);
    }
  }, [open, categoria]);

  const save = async () => {
    const parsed = schema.safeParse({ nome, ativo, icone, destaque, emoji });
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);

    const data = {
      nome: parsed.data.nome,
      ativo: parsed.data.ativo,
      icone: parsed.data.icone || null,
      destaque: parsed.data.destaque,
      emoji: parsed.data.emoji || null,
    };
    setBusy(true);
    const { error } = categoria
      ? await supabase.from("categorias").update(data).eq("id", categoria.id)
      : await supabase.from("categorias").insert([data]);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(categoria ? "Categoria atualizada" : "Categoria criada");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {categoria ? "Editar categoria" : "Nova categoria"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-nome">Nome</Label>
            <Input id="cat-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-icone">Ícone / Emoji (opcional)</Label>
            <Input id="cat-icone" value={icone} onChange={(e) => setIcone(e.target.value)} maxLength={4} placeholder="🍔" />
            <p className="text-xs text-muted-foreground">Aparece na navegação do cardápio público</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-emoji">Emoji de destaque (opcional)</Label>
            <Input id="cat-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} placeholder="⭐" />
            <p className="text-xs text-muted-foreground">Mostrado no titulo da seção do cardápio público</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="cat-ativo" className="cursor-pointer">Ativa</Label>
              <p className="text-xs text-muted-foreground">Categorias inativas não aparecem ao montar pedidos</p>
            </div>
            <Switch id="cat-ativo" checked={ativo} onCheckedChange={setAtivo} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="cat-destaque" className="cursor-pointer">Categoria em destaque</Label>
              <p className="text-xs text-muted-foreground">Destaca visualmente a seção no /cardapio</p>
            </div>
            <Switch id="cat-destaque" checked={destaque} onCheckedChange={setDestaque} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
