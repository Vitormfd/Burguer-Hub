import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Adicional, GrupoAdicional } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { brl } from "@/lib/format";

const emptyGrupo = {
  nome: "",
  descricao: "",
  obrigatorio: false,
  min_escolhas: 0,
  max_escolhas: 1,
  ordem: 0,
  disponivel: true,
};

const emptyAdicional = {
  nome: "",
  preco: "0",
  imagem_url: "",
  ordem: 0,
  disponivel: true,
};

export default function AdicionaisAdmin() {
  const [grupos, setGrupos] = useState<GrupoAdicional[]>([]);
  const [adicionais, setAdicionais] = useState<Adicional[]>([]);
  const [loading, setLoading] = useState(true);

  const [grupoDialogOpen, setGrupoDialogOpen] = useState(false);
  const [grupoEdit, setGrupoEdit] = useState<GrupoAdicional | null>(null);
  const [grupoForm, setGrupoForm] = useState(emptyGrupo);

  const [adicionalDialogOpen, setAdicionalDialogOpen] = useState(false);
  const [adicionalEdit, setAdicionalEdit] = useState<Adicional | null>(null);
  const [adicionalGrupoId, setAdicionalGrupoId] = useState<string>("");
  const [adicionalForm, setAdicionalForm] = useState(emptyAdicional);
  const [uploadingAdicionalImagem, setUploadingAdicionalImagem] = useState(false);
  const adicionalImagemRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: gs, error: eg }, { data: ads, error: ea }] = await Promise.all([
      supabase.from("grupos_adicionais").select("*").order("ordem").order("nome"),
      supabase.from("adicionais").select("*").order("ordem").order("nome"),
    ]);

    setLoading(false);
    if (eg) return toast.error(eg.message);
    if (ea) return toast.error(ea.message);

    setGrupos((gs || []) as GrupoAdicional[]);
    setAdicionais((ads || []) as Adicional[]);
  };

  useEffect(() => {
    load();
  }, []);

  const adicionaisPorGrupo = useMemo(() => {
    const map = new Map<string, Adicional[]>();
    adicionais.forEach((adicional) => {
      const list = map.get(adicional.grupo_id) || [];
      list.push(adicional);
      map.set(adicional.grupo_id, list);
    });
    return map;
  }, [adicionais]);

  const openNovoGrupo = () => {
    setGrupoEdit(null);
    setGrupoForm(emptyGrupo);
    setGrupoDialogOpen(true);
  };

  const openEditarGrupo = (grupo: GrupoAdicional) => {
    setGrupoEdit(grupo);
    setGrupoForm({
      nome: grupo.nome,
      descricao: grupo.descricao || "",
      obrigatorio: grupo.obrigatorio,
      min_escolhas: grupo.min_escolhas,
      max_escolhas: grupo.max_escolhas,
      ordem: grupo.ordem,
      disponivel: grupo.disponivel,
    });
    setGrupoDialogOpen(true);
  };

  const salvarGrupo = async () => {
    if (grupoForm.max_escolhas < 1) return toast.error("Maximo de escolhas deve ser ao menos 1");
    if (grupoForm.min_escolhas > grupoForm.max_escolhas) return toast.error("Minimo nao pode ser maior que maximo");

    const payload = {
      nome: grupoForm.nome.trim(),
      descricao: grupoForm.descricao.trim() || null,
      obrigatorio: grupoForm.obrigatorio,
      min_escolhas: grupoForm.min_escolhas,
      max_escolhas: grupoForm.max_escolhas,
      ordem: grupoForm.ordem,
      disponivel: grupoForm.disponivel,
    };

    if (!payload.nome) return toast.error("Informe o nome do grupo");

    const { error } = grupoEdit
      ? await supabase.from("grupos_adicionais").update(payload).eq("id", grupoEdit.id)
      : await supabase.from("grupos_adicionais").insert(payload);

    if (error) return toast.error(error.message);

    toast.success(grupoEdit ? "Grupo atualizado" : "Grupo criado");
    setGrupoDialogOpen(false);
    load();
  };

  const excluirGrupo = async (id: string) => {
    const { error } = await supabase.from("grupos_adicionais").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Grupo removido");
    load();
  };

  const openNovoAdicional = (grupoId: string) => {
    setAdicionalEdit(null);
    setAdicionalGrupoId(grupoId);
    setAdicionalForm(emptyAdicional);
    setAdicionalDialogOpen(true);
  };

  const openEditarAdicional = (adicional: Adicional) => {
    setAdicionalEdit(adicional);
    setAdicionalGrupoId(adicional.grupo_id);
    setAdicionalForm({
      nome: adicional.nome,
      preco: String(adicional.preco),
      imagem_url: adicional.imagem_url || "",
      ordem: adicional.ordem,
      disponivel: adicional.disponivel,
    });
    setAdicionalDialogOpen(true);
  };

  const salvarAdicional = async () => {
    const payload = {
      grupo_id: adicionalGrupoId,
      nome: adicionalForm.nome.trim(),
      preco: Number(adicionalForm.preco.replace(",", ".")) || 0,
      imagem_url: adicionalForm.imagem_url.trim() || null,
      ordem: adicionalForm.ordem,
      disponivel: adicionalForm.disponivel,
    };

    if (!payload.grupo_id) return toast.error("Grupo invalido");
    if (!payload.nome) return toast.error("Informe o nome do adicional");

    const { error } = adicionalEdit
      ? await supabase.from("adicionais").update(payload).eq("id", adicionalEdit.id)
      : await supabase.from("adicionais").insert(payload);

    if (error) return toast.error(error.message);

    toast.success(adicionalEdit ? "Adicional atualizado" : "Adicional criado");
    setAdicionalDialogOpen(false);
    load();
  };

  const uploadImagemAdicional = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Selecione uma imagem valida");
    if (file.size > 2 * 1024 * 1024) return toast.error("Imagem deve ter no maximo 2MB");

    setUploadingAdicionalImagem(true);
    const ext = file.name.split(".").pop() || "png";
    const path = `adicionais/${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from("loja").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });

    setUploadingAdicionalImagem(false);
    if (error) return toast.error("Erro ao enviar imagem: " + error.message);

    const { data } = supabase.storage.from("loja").getPublicUrl(path);
    setAdicionalForm((prev) => ({ ...prev, imagem_url: data.publicUrl }));
    toast.success("Imagem enviada!");
  };

  const excluirAdicional = async (id: string) => {
    const { error } = await supabase.from("adicionais").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Adicional removido");
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-5xl">Adicionais</h1>
          <p className="text-muted-foreground mt-1">Gerencie grupos e itens de adicionais</p>
        </div>
        <Button onClick={openNovoGrupo}><Plus className="h-4 w-4 mr-1" /> Novo grupo</Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : grupos.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Nenhum grupo cadastrado.</Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {grupos.map((grupo) => {
            const itens = adicionaisPorGrupo.get(grupo.id) || [];
            return (
              <Card key={grupo.id} className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-lg">{grupo.nome}</h3>
                    <p className="text-xs text-muted-foreground">
                      {grupo.obrigatorio ? "Obrigatorio" : "Opcional"} · min {grupo.min_escolhas} / max {grupo.max_escolhas} · ordem {grupo.ordem}
                    </p>
                    {grupo.descricao && <p className="text-xs text-muted-foreground mt-1">{grupo.descricao}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditarGrupo(grupo)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="hover:text-destructive" onClick={() => excluirGrupo(grupo.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Disponivel</span>
                  <Switch
                    checked={grupo.disponivel}
                    onCheckedChange={async (checked) => {
                      const { error } = await supabase.from("grupos_adicionais").update({ disponivel: checked }).eq("id", grupo.id);
                      if (error) return toast.error(error.message);
                      setGrupos((prev) => prev.map((g) => (g.id === grupo.id ? { ...g, disponivel: checked } : g)));
                    }}
                  />
                </div>

                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Itens do grupo</span>
                    <Button variant="outline" size="sm" onClick={() => openNovoAdicional(grupo.id)}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Adicional
                    </Button>
                  </div>

                  {itens.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum adicional neste grupo.</p>
                  ) : (
                    <div className="space-y-2">
                      {itens.map((item) => (
                        <div key={item.id} className="rounded-md border p-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{item.nome}</div>
                            <div className="text-xs text-muted-foreground">{item.preco > 0 ? `+ ${brl(Number(item.preco))}` : "Gratis"} · ordem {item.ordem}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Switch
                              checked={item.disponivel}
                              onCheckedChange={async (checked) => {
                                const { error } = await supabase.from("adicionais").update({ disponivel: checked }).eq("id", item.id);
                                if (error) return toast.error(error.message);
                                setAdicionais((prev) => prev.map((a) => (a.id === item.id ? { ...a, disponivel: checked } : a)));
                              }}
                            />
                            <Button variant="ghost" size="icon" onClick={() => openEditarAdicional(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="hover:text-destructive" onClick={() => excluirAdicional(item.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={grupoDialogOpen} onOpenChange={setGrupoDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{grupoEdit ? "Editar grupo" : "Novo grupo"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={grupoForm.nome} onChange={(e) => setGrupoForm((prev) => ({ ...prev, nome: e.target.value }))} maxLength={80} />
            </div>
            <div className="space-y-1">
              <Label>Descricao</Label>
              <Input value={grupoForm.descricao} onChange={(e) => setGrupoForm((prev) => ({ ...prev, descricao: e.target.value }))} maxLength={200} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>Min</Label>
                <Input type="number" min={0} value={grupoForm.min_escolhas} onChange={(e) => setGrupoForm((prev) => ({ ...prev, min_escolhas: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label>Max</Label>
                <Input type="number" min={1} value={grupoForm.max_escolhas} onChange={(e) => setGrupoForm((prev) => ({ ...prev, max_escolhas: Number(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-1">
                <Label>Ordem</Label>
                <Input type="number" min={0} value={grupoForm.ordem} onChange={(e) => setGrupoForm((prev) => ({ ...prev, ordem: Number(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Obrigatorio</Label>
              <Switch checked={grupoForm.obrigatorio} onCheckedChange={(checked) => setGrupoForm((prev) => ({ ...prev, obrigatorio: checked }))} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Disponivel</Label>
              <Switch checked={grupoForm.disponivel} onCheckedChange={(checked) => setGrupoForm((prev) => ({ ...prev, disponivel: checked }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrupoDialogOpen(false)}>Cancelar</Button>
            <Button onClick={salvarGrupo}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adicionalDialogOpen} onOpenChange={setAdicionalDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{adicionalEdit ? "Editar adicional" : "Novo adicional"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={adicionalForm.nome} onChange={(e) => setAdicionalForm((prev) => ({ ...prev, nome: e.target.value }))} maxLength={80} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Preco</Label>
                <Input type="number" min={0} step="0.10" value={adicionalForm.preco} onChange={(e) => setAdicionalForm((prev) => ({ ...prev, preco: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Ordem</Label>
                <Input type="number" min={0} value={adicionalForm.ordem} onChange={(e) => setAdicionalForm((prev) => ({ ...prev, ordem: Number(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Imagem URL</Label>
              <Input value={adicionalForm.imagem_url} onChange={(e) => setAdicionalForm((prev) => ({ ...prev, imagem_url: e.target.value }))} maxLength={500} />
              <div className="flex items-center gap-2 pt-1">
                <input
                  ref={adicionalImagemRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadImagemAdicional(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => adicionalImagemRef.current?.click()}
                  disabled={uploadingAdicionalImagem}
                >
                  <Upload className="h-4 w-4 mr-1" /> {uploadingAdicionalImagem ? "Enviando..." : "Upload local"}
                </Button>
                {adicionalForm.imagem_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setAdicionalForm((prev) => ({ ...prev, imagem_url: "" }))}
                  >
                    <X className="h-4 w-4 mr-1" /> Remover
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label>Disponivel</Label>
              <Switch checked={adicionalForm.disponivel} onCheckedChange={(checked) => setAdicionalForm((prev) => ({ ...prev, disponivel: checked }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdicionalDialogOpen(false)}>Cancelar</Button>
            <Button onClick={salvarAdicional}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
