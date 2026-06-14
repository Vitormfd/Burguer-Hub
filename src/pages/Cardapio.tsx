import { useEffect, useMemo, useState } from "react";
import { BookOpen, Plus, Pencil, Trash2, Search, Folder, Power, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Categoria, Produto } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import CategoriaDialog from "@/components/cardapio/CategoriaDialog";
import ProdutoDialog from "@/components/cardapio/ProdutoDialog";

type DeleteTarget =
  | { kind: "categoria"; id: string; label: string }
  | { kind: "produto"; id: string; label: string }
  | null;

export default function Cardapio() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<string | "todas" | "sem">("todas");

  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [catEdit, setCatEdit] = useState<Categoria | null>(null);

  const [prodDialogOpen, setProdDialogOpen] = useState(false);
  const [prodEdit, setProdEdit] = useState<Produto | null>(null);

  const [delTarget, setDelTarget] = useState<DeleteTarget>(null);

  const sortByOrdem = (items: Produto[]) =>
    [...items].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));

  const load = async () => {
    const [{ data: cs }, { data: ps }] = await Promise.all([
      supabase.from("categorias").select("*").order("ordem").order("nome"),
      supabase.from("produtos").select("*").order("ordem"),
    ]);
    setCategorias((cs || []) as Categoria[]);
    setProdutos(sortByOrdem((ps || []) as Produto[]));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return sortByOrdem(produtos).filter((p) => {
      if (filtro === "sem" && p.categoria_id !== null) return false;
      if (filtro !== "todas" && filtro !== "sem" && p.categoria_id !== filtro) return false;
      if (termo && !p.nome.toLowerCase().includes(termo) && !(p.descricao ?? "").toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [produtos, busca, filtro]);


  const catMap = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  const toggleProd = async (p: Produto) => {
    const { error } = await supabase.from("produtos").update({ disponivel: !p.disponivel }).eq("id", p.id);
    if (error) return toast.error(error.message);
    setProdutos((prev) => prev.map((x) => x.id === p.id ? { ...x, disponivel: !x.disponivel } : x));
  };

  const toggleDestaqueProd = async (p: Produto) => {
    const { error } = await supabase.from("produtos").update({ destaque: !p.destaque }).eq("id", p.id);
    if (error) return toast.error(error.message);
    setProdutos((prev) => prev.map((x) => x.id === p.id ? { ...x, destaque: !x.destaque } : x));
  };

  const toggleCat = async (c: Categoria) => {
    const { error } = await supabase.from("categorias").update({ ativo: !c.ativo }).eq("id", c.id);
    if (error) return toast.error(error.message);
    setCategorias((prev) => prev.map((x) => x.id === c.id ? { ...x, ativo: !x.ativo } : x));
  };

  const confirmDelete = async () => {
    if (!delTarget) return;
    const { error } = delTarget.kind === "categoria"
      ? await supabase.from("categorias").delete().eq("id", delTarget.id)
      : await supabase.from("produtos").delete().eq("id", delTarget.id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    setDelTarget(null);
    load();
  };


  const countByCat = (id: string) => produtos.filter((p) => p.categoria_id === id).length;
  const semCat = produtos.filter((p) => p.categoria_id === null).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-foreground flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-primary" /> Cardápio
          </h1>
          <p className="text-muted-foreground mt-1">Gerencie categorias, produtos e preços</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setCatEdit(null); setCatDialogOpen(true); }}>
            <Folder className="h-4 w-4 mr-1" /> Nova categoria
          </Button>
          <Button onClick={() => { setProdEdit(null); setProdDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Novo produto
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar de categorias */}
        <Card className="p-3 h-fit">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-2 pb-2">
            Categorias
          </div>
          <ScrollArea className="max-h-[60vh]">
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => setFiltro("todas")}
                  className={cn(
                    "w-full flex justify-between items-center px-3 py-2 rounded-md text-sm transition-colors",
                    filtro === "todas" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  )}
                >
                  <span>Todos</span>
                  <span className="text-xs opacity-70">{produtos.length}</span>
                </button>
              </li>

              {categorias.map((c) => {
                const active = filtro === c.id;
                return (
                  <li key={c.id}>
                    <div
                      className={cn(
                        "min-w-0 rounded-md transition-colors",
                        active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      )}
                    >
                      <button
                        onClick={() => setFiltro(c.id)}
                        className="flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden px-3 py-2 text-left text-sm"
                      >
                        <span className={cn("min-w-0 flex-1 truncate", !c.ativo && "italic opacity-60")}>
                          {c.nome}
                          {c.exclui_frete_gratis && (
                            <span className="ml-1 text-[10px] font-normal opacity-70">· sem frete grátis</span>
                          )}
                        </span>
                        <span className="ml-2 shrink-0 text-xs opacity-70">{countByCat(c.id)}</span>
                      </button>
                      <div className={cn("flex items-center justify-end gap-0.5 px-2 pb-2", active ? "text-primary-foreground" : "text-foreground") }>
                        <button
                          title={c.ativo ? "Desativar" : "Ativar"}
                          onClick={(e) => { e.stopPropagation(); toggleCat(c); }}
                          className="p-1 rounded hover:bg-black/10"
                        >
                          <Power className={cn("h-3.5 w-3.5", c.ativo ? "text-status-livre" : "opacity-50")} />
                        </button>
                        <button
                          title="Editar"
                          onClick={(e) => { e.stopPropagation(); setCatEdit(c); setCatDialogOpen(true); }}
                          className="p-1 rounded hover:bg-black/10"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          title="Excluir"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDelTarget({ kind: "categoria", id: c.id, label: c.nome });
                          }}
                          className="p-1 rounded hover:bg-black/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}

              {semCat > 0 && (
                <li>
                  <button
                    onClick={() => setFiltro("sem")}
                    className={cn(
                      "w-full flex justify-between items-center px-3 py-2 rounded-md text-sm transition-colors",
                      filtro === "sem" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    )}
                  >
                    <span className="italic text-muted-foreground">Sem categoria</span>
                    <span className="text-xs opacity-70">{semCat}</span>
                  </button>
                </li>
              )}
            </ul>
          </ScrollArea>
        </Card>

        {/* Lista de produtos */}
        <div className="space-y-4">
          {/* <p className="text-xs text-muted-foreground">Use as setas nos cards para ordenar os lanches manualmente.</p> */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar produto..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
              maxLength={60}
            />
          </div>

          {loading ? (
            <div className="text-muted-foreground">Carregando...</div>
          ) : produtosFiltrados.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Nenhum produto encontrado.</p>
              <Button className="mt-4" onClick={() => { setProdEdit(null); setProdDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar produto
              </Button>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {produtosFiltrados.map((p) => {
                const cat = p.categoria_id ? catMap.get(p.categoria_id) : null;
                return (
                  <Card key={p.id} className={cn("overflow-hidden flex flex-col shadow-soft hover:shadow-card transition-shadow", !p.disponivel && "opacity-70")}> 
                    {p.imagem_url ? (
                      <div className="aspect-video bg-muted overflow-hidden">
                        <img
                          src={p.imagem_url}
                          alt={p.nome}
                          className="w-full h-full object-cover"
                          onError={(e) => ((e.currentTarget.style.display = "none"))}
                        />
                      </div>
                    ) : (
                      <div className="aspect-video bg-gradient-primary/10 flex items-center justify-center">
                        <BookOpen className="w-8 h-8 text-primary/30" />
                      </div>
                    )}
                    <div className="p-4 flex-1 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold leading-tight">{p.nome}</h3>
                        <span className="font-display text-xl text-primary whitespace-nowrap">
                          {brl(Number(p.preco))}
                        </span>
                      </div>
                      {p.descricao && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{p.descricao}</p>
                      )}
                      <div className="flex items-center gap-2 mt-auto pt-2">
                        <Badge variant="outline" className="text-xs">Ordem {p.ordem + 1}</Badge>
                        {cat ? (
                          <Badge variant="secondary" className="text-xs">{cat.nome}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs italic">Sem categoria</Badge>
                        )}
                        {p.destaque && <Badge className="text-xs bg-amber-500 text-black">⭐ Destaque</Badge>}
                        {!p.disponivel && <Badge variant="outline" className="text-xs">Indisponível</Badge>}
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t mt-2">
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                            <Switch checked={p.disponivel} onCheckedChange={() => toggleProd(p)} />
                            Disponível
                          </label>
                          <Button
                            size="sm"
                            variant={p.destaque ? "default" : "outline"}
                            className="h-7 text-xs"
                            onClick={() => toggleDestaqueProd(p)}
                          >
                            <Star className="h-3.5 w-3.5 mr-1" />
                            Destaque
                          </Button>
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setProdEdit(p); setProdDialogOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 hover:text-destructive"
                            onClick={() => setDelTarget({ kind: "produto", id: p.id, label: p.nome })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <CategoriaDialog
        open={catDialogOpen}
        categoria={catEdit}
        onClose={() => setCatDialogOpen(false)}
        onSaved={() => { setCatDialogOpen(false); load(); }}
      />

      <ProdutoDialog
        open={prodDialogOpen}
        produto={prodEdit}
        categorias={categorias}
        defaultCategoriaId={filtro !== "todas" && filtro !== "sem" ? filtro : null}
        onClose={() => setProdDialogOpen(false)}
        onSaved={() => { setProdDialogOpen(false); load(); }}
      />

      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              Excluir {delTarget?.kind === "categoria" ? "categoria" : "produto"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              "{delTarget?.label}" será removido permanentemente.
              {delTarget?.kind === "categoria" && " Os produtos vinculados ficarão sem categoria."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
