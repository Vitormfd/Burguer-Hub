import { useCallback, useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  type Prospect,
  SISTEMA_LABEL,
  STATUS_LABEL,
  baixarArquivo,
  dataHora,
  prospectsParaCsv,
  sb,
  statusVariant,
} from "@/lib/prospeccao";

const POR_PAGINA = 50;
const TODOS = "todos";

interface Filtros {
  texto: string;
  status: string;
  sistema: string;
  prioridade: string;
  uf: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aplicarFiltros(q: any, f: Filtros) {
  if (f.status !== TODOS) q = q.eq("status", f.status);
  if (f.sistema !== TODOS) q = q.eq("sistema", f.sistema);
  if (f.prioridade !== TODOS) q = q.eq("prioridade", f.prioridade);
  if (f.uf.trim()) q = q.eq("uf", f.uf.trim().toUpperCase());
  const t = f.texto.trim().replace(/[%,()]/g, " ");
  if (t) q = q.or(`nome.ilike.%${t}%,cidade.ilike.%${t}%,instagram.ilike.%${t}%,telefone.ilike.%${t}%,categoria.ilike.%${t}%`);
  return q;
}

export function ProspeccaoLista({ onAbrir, versao }: { onAbrir: (id: string) => void; versao: number }) {
  const [filtros, setFiltros] = useState<Filtros>({ texto: "", status: TODOS, sistema: TODOS, prioridade: TODOS, uf: "" });
  const [pagina, setPagina] = useState(0);
  const [linhas, setLinhas] = useState<Prospect[]>([]);
  const [total, setTotal] = useState(0);
  const [exportando, setExportando] = useState(false);

  const load = useCallback(async () => {
    const q = aplicarFiltros(sb.from("prospects").select("*", { count: "exact" }), filtros)
      .order("descoberto_em", { ascending: false })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    const { data, count, error } = await q;
    if (error) return toast.error(error.message);
    setLinhas(data || []);
    setTotal(count || 0);
  }, [filtros, pagina]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load, versao]);

  const set = (patch: Partial<Filtros>) => {
    setPagina(0);
    setFiltros((f) => ({ ...f, ...patch }));
  };

  const exportar = async () => {
    setExportando(true);
    const todos: Prospect[] = [];
    for (let de = 0; ; de += 1000) {
      const { data } = await aplicarFiltros(sb.from("prospects").select("*"), filtros).order("descoberto_em", { ascending: false }).range(de, de + 999);
      todos.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    baixarArquivo(`prospects-${new Date().toISOString().slice(0, 10)}.csv`, prospectsParaCsv(todos));
    setExportando(false);
  };

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Nome, cidade, @, telefone..." value={filtros.texto} onChange={(e) => set({ texto: e.target.value })} />
          </div>
          <FiltroSelect valor={filtros.status} onChange={(status) => set({ status })} opcoes={STATUS_LABEL} rotulo="Status" />
          <FiltroSelect valor={filtros.sistema} onChange={(sistema) => set({ sistema })} opcoes={SISTEMA_LABEL} rotulo="Sistema" />
          <FiltroSelect valor={filtros.prioridade} onChange={(prioridade) => set({ prioridade })} opcoes={{ alta: "Alta", media: "Média", baixa: "Baixa" }} rotulo="Prioridade" />
          <Input placeholder="UF" maxLength={2} value={filtros.uf} onChange={(e) => set({ uf: e.target.value })} />
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} estabelecimento(s)</span>
          <Button size="sm" variant="outline" onClick={exportar} disabled={exportando || total === 0}>
            <Download className="h-4 w-4 mr-1" /> {exportando ? "Exportando..." : "Exportar CSV"}
          </Button>
        </div>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Estabelecimento</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>Sistema</TableHead>
              <TableHead className="text-right">Pontos</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Próxima ação</TableHead>
              <TableHead>Descoberto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => onAbrir(p.id)}>
                <TableCell>
                  <div className="font-medium">{p.nome}</div>
                  <div className="text-xs text-muted-foreground">{p.categoria}</div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{[p.cidade, p.uf].filter(Boolean).join(" - ")}</TableCell>
                <TableCell>
                  {SISTEMA_LABEL[p.sistema] ?? p.sistema}
                  <div className="text-xs text-muted-foreground">{p.sistema_confianca}</div>
                </TableCell>
                <TableCell className="text-right">
                  {p.pontuacao}
                  <div className="text-xs text-muted-foreground">{p.prioridade}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(p.status)}>{STATUS_LABEL[p.status]}</Badge>
                </TableCell>
                <TableCell className="text-xs max-w-[220px] truncate">{p.proxima_acao ?? "—"}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{dataHora(p.descoberto_em)}</TableCell>
              </TableRow>
            ))}
            {!linhas.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Nenhum estabelecimento com esses filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {paginas > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="outline" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </Button>
          <span>
            {pagina + 1} de {paginas}
          </span>
          <Button size="sm" variant="outline" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}

function FiltroSelect({ valor, onChange, opcoes, rotulo }: { valor: string; onChange: (v: string) => void; opcoes: Record<string, string>; rotulo: string }) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={rotulo} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{rotulo}: todos</SelectItem>
        {Object.entries(opcoes).map(([k, v]) => (
          <SelectItem key={k} value={k}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
