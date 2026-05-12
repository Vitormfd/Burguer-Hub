import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Categoria, GrupoAdicional, Produto, ProdutoGrupoAdicional } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";

const schema = z.object({
  nome: z.string().trim().min(2, "Nome muito curto").max(80),
  descricao: z.string().trim().max(300).optional().or(z.literal("")),
  preco: z.number().min(0, "Preço inválido").max(9999),
  categoria_id: z.string().uuid().nullable(),
  imagem_url: z.string().trim().max(500).optional().or(z.literal("")),
  disponivel: z.boolean(),
  promocao: z.boolean(),
  preco_promocional: z.number().min(0).max(9999).nullable(),
});

interface Props {
  open: boolean;
  produto: Produto | null;
  categorias: Categoria[];
  defaultCategoriaId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ProdutoDialog({ open, produto, categorias, defaultCategoriaId, onClose, onSaved }: Props) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [preco, setPreco] = useState("0");
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [imagemUrl, setImagemUrl] = useState("");
  const [disponivel, setDisponivel] = useState(true);
  const [promocao, setPromocao] = useState(false);
  const [precoPromo, setPrecoPromo] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [grupos, setGrupos] = useState<GrupoAdicional[]>([]);
  const [gruposVinculados, setGruposVinculados] = useState<ProdutoGrupoAdicional[]>([]);
  const [novoGrupoId, setNovoGrupoId] = useState<string>("__none");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Selecione uma imagem válida");
    if (file.size > 2 * 1024 * 1024) return toast.error("Imagem deve ter no máximo 2MB");

    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `produtos/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("loja").upload(path, file, { upsert: true });
    setUploading(false);

    if (error) return toast.error("Erro ao fazer upload: " + error.message);

    const { data } = supabase.storage.from("loja").getPublicUrl(path);
    setImagemUrl(data.publicUrl);
    toast.success("Imagem enviada!");
  };

  useEffect(() => {
    if (!open) return;
    setNome(produto?.nome ?? "");
    setDescricao(produto?.descricao ?? "");
    setPreco(produto ? String(produto.preco) : "0");
    setCategoriaId(produto?.categoria_id ?? defaultCategoriaId ?? null);
    setImagemUrl(produto?.imagem_url ?? "");
    setDisponivel(produto?.disponivel ?? true);
    setPromocao(produto?.promocao ?? false);
    setPrecoPromo(produto?.preco_promocional != null ? String(produto.preco_promocional) : "");
  }, [open, produto, defaultCategoriaId]);

  useEffect(() => {
    if (!open) return;

    (async () => {
      const { data: gs } = await supabase
        .from("grupos_adicionais")
        .select("*")
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true });
      setGrupos((gs || []) as GrupoAdicional[]);

      if (!produto) {
        setGruposVinculados([]);
        return;
      }

      const { data: vinculos } = await supabase
        .from("produto_grupos_adicionais")
        .select("*")
        .eq("produto_id", produto.id)
        .order("ordem", { ascending: true });
      setGruposVinculados((vinculos || []) as ProdutoGrupoAdicional[]);
    })();
  }, [open, produto]);

  const persistOrdemVinculos = async (next: ProdutoGrupoAdicional[]) => {
    const updates = next.map((item, idx) =>
      supabase.from("produto_grupos_adicionais").update({ ordem: idx }).eq("id", item.id)
    );
    const results = await Promise.all(updates);
    const erro = results.find((res) => res.error)?.error;
    if (erro) toast.error(erro.message);
  };

  const vincularGrupo = async () => {
    if (!produto || novoGrupoId === "__none") return;

    const { error } = await supabase.from("produto_grupos_adicionais").insert({
      produto_id: produto.id,
      grupo_id: novoGrupoId,
      ordem: gruposVinculados.length,
    });

    if (error) return toast.error(error.message);

    const { data: vinculos } = await supabase
      .from("produto_grupos_adicionais")
      .select("*")
      .eq("produto_id", produto.id)
      .order("ordem", { ascending: true });
    setGruposVinculados((vinculos || []) as ProdutoGrupoAdicional[]);
    setNovoGrupoId("__none");
  };

  const desvincularGrupo = async (vinculoId: string) => {
    const { error } = await supabase.from("produto_grupos_adicionais").delete().eq("id", vinculoId);
    if (error) return toast.error(error.message);

    const next = gruposVinculados
      .filter((item) => item.id !== vinculoId)
      .map((item, idx) => ({ ...item, ordem: idx }));

    setGruposVinculados(next);
    await persistOrdemVinculos(next);
  };

  const handleDropGrupo = async (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;

    const sourceIndex = gruposVinculados.findIndex((item) => item.id === draggingId);
    const targetIndex = gruposVinculados.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const next = [...gruposVinculados];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    const normalized = next.map((item, idx) => ({ ...item, ordem: idx }));

    setGruposVinculados(normalized);
    await persistOrdemVinculos(normalized);
    setDraggingId(null);
  };

  const save = async () => {
    const parsed = schema.safeParse({
      nome,
      descricao,
      preco: Number(preco.replace(",", ".")) || 0,
      categoria_id: categoriaId,
      imagem_url: imagemUrl,
      disponivel,
      promocao,
      preco_promocional: promocao && precoPromo ? Number(precoPromo.replace(",", ".")) : null,
    });
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);

    const payload = {
      nome: parsed.data.nome,
      preco: parsed.data.preco,
      categoria_id: parsed.data.categoria_id,
      disponivel: parsed.data.disponivel,
      descricao: parsed.data.descricao || null,
      imagem_url: parsed.data.imagem_url || null,
      promocao: parsed.data.promocao,
      preco_promocional: parsed.data.preco_promocional,
    };

    setBusy(true);
    const { error } = produto
      ? await supabase.from("produtos").update(payload).eq("id", produto.id)
      : await supabase.from("produtos").insert([payload]);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(produto ? "Produto atualizado" : "Produto criado");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {produto ? "Editar produto" : "Novo produto"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="p-nome">Nome *</Label>
            <Input id="p-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoFocus />
          </div>

          <div className="space-y-2">
            <Label htmlFor="p-desc">Descrição</Label>
            <Textarea id="p-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={300} rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="p-preco">Preço (R$) *</Label>
              <Input id="p-preco" type="number" min={0} step="0.10" value={preco} onChange={(e) => setPreco(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={categoriaId ?? "__none"} onValueChange={(v) => setCategoriaId(v === "__none" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sem categoria</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Imagem</Label>
            <div className="flex gap-2">
              <Input
                id="p-img"
                value={imagemUrl}
                onChange={(e) => setImagemUrl(e.target.value)}
                maxLength={500}
                placeholder="https://... ou envie um arquivo"
                className="flex-1"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                title="Enviar imagem do computador"
              >
                <Upload className="w-4 h-4" />
              </Button>
            </div>
            {uploading && <p className="text-xs text-muted-foreground">Enviando imagem...</p>}
            {imagemUrl && (
              <div className="relative w-fit">
                <img
                  src={imagemUrl}
                  alt="Pré-visualização"
                  className="mt-2 h-24 w-24 object-cover rounded-md border"
                  onError={(e) => ((e.currentTarget.style.display = "none"))}
                />
                <button
                  type="button"
                  onClick={() => setImagemUrl("")}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="p-disp" className="cursor-pointer">Disponível</Label>
              <p className="text-xs text-muted-foreground">Itens indisponíveis ficam ocultos no cardápio</p>
            </div>
            <Switch id="p-disp" checked={disponivel} onCheckedChange={setDisponivel} />
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="p-promo" className="cursor-pointer">Em promoção</Label>
                <p className="text-xs text-muted-foreground">Aparece no carrossel de promoções</p>
              </div>
              <Switch id="p-promo" checked={promocao} onCheckedChange={setPromocao} />
            </div>
            {promocao && (
              <div className="space-y-2">
                <Label htmlFor="p-pp">Preço promocional (R$)</Label>
                <Input id="p-pp" type="number" min={0} step="0.10" value={precoPromo} onChange={(e) => setPrecoPromo(e.target.value)} />
              </div>
            )}
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div>
              <Label className="cursor-default">Grupos de adicionais</Label>
              <p className="text-xs text-muted-foreground">Arraste para reordenar a ordem das etapas do modal</p>
            </div>

            {!produto ? (
              <p className="text-xs text-muted-foreground">Salve o produto para vincular grupos de adicionais.</p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Select value={novoGrupoId} onValueChange={setNovoGrupoId}>
                    <SelectTrigger><SelectValue placeholder="Vincular grupo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Selecionar grupo</SelectItem>
                      {grupos
                        .filter((g) => !gruposVinculados.some((v) => v.grupo_id === g.id))
                        .map((g) => (
                          <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={vincularGrupo}>Vincular</Button>
                </div>

                <div className="space-y-2">
                  {gruposVinculados.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum grupo vinculado.</p>
                  ) : (
                    gruposVinculados.map((vinculo) => {
                      const grupo = grupos.find((g) => g.id === vinculo.grupo_id);
                      return (
                        <div
                          key={vinculo.id}
                          draggable
                          onDragStart={() => setDraggingId(vinculo.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleDropGrupo(vinculo.id)}
                          className="rounded-md border p-2 flex items-center justify-between gap-2 cursor-move"
                        >
                          <div>
                            <div className="text-sm font-medium">{grupo?.nome || "Grupo removido"}</div>
                            <div className="text-xs text-muted-foreground">Ordem {vinculo.ordem + 1}</div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="hover:text-destructive"
                            onClick={() => desvincularGrupo(vinculo.id)}
                          >
                            Desvincular
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
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
