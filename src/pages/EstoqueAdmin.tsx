import { useCallback, useEffect, useMemo, useState } from "react";
import { endOfDay, startOfDay, startOfMonth, subDays } from "date-fns";
import { AlertTriangle, ArrowDownToLine, PackagePlus, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

// Tabelas novas ainda não estão nos tipos gerados do Supabase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const UNIDADES = [
  { id: "un", label: "Unidade (un)" },
  { id: "fatia", label: "Fatia" },
  { id: "g", label: "Grama (g)" },
  { id: "kg", label: "Quilo (kg)" },
  { id: "ml", label: "Mililitro (ml)" },
  { id: "l", label: "Litro (l)" },
  { id: "pct", label: "Pacote (pct)" },
] as const;

interface Insumo {
  id: string;
  nome: string;
  unidade: string;
  custo_unitario: number;
  estoque_atual: number;
  estoque_minimo: number;
  ativo: boolean;
}

interface ItemCardapio {
  id: string;
  nome: string;
  preco: number;
}

interface FichaLinha {
  id: string;
  insumo_id: string;
  quantidade: number;
}

interface Movimentacao {
  id: string;
  insumo_id: string;
  tipo: "entrada" | "venda" | "ajuste" | "perda";
  quantidade: number;
  custo_unitario: number;
  observacao: string | null;
  criado_em: string;
}

interface LucroProduto {
  produto_id: string | null;
  produto_nome: string;
  quantidade: number;
  receita: number;
  custo: number;
  tem_ficha: boolean;
}

type Periodo = "hoje" | "7d" | "30d" | "mes";

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "mes", label: "Este mês" },
];

const periodoRange = (p: Periodo): [Date, Date] => {
  const now = new Date();
  if (p === "hoje") return [startOfDay(now), endOfDay(now)];
  if (p === "7d") return [startOfDay(subDays(now, 6)), endOfDay(now)];
  if (p === "30d") return [startOfDay(subDays(now, 29)), endOfDay(now)];
  return [startOfMonth(now), endOfDay(now)];
};

const fmtQtd = (v: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(v) || 0);

const parseNum = (v: string) => Number(String(v).replace(",", "."));

const margemPct = (preco: number, custo: number) => (preco > 0 ? ((preco - custo) / preco) * 100 : 0);

const margemClasse = (pct: number) =>
  pct < 30 ? "text-destructive" : pct < 55 ? "text-amber-600" : "text-emerald-600";

const TIPO_MOV_LABEL: Record<Movimentacao["tipo"], string> = {
  entrada: "Entrada",
  venda: "Venda",
  ajuste: "Ajuste",
  perda: "Perda",
};

export default function EstoqueAdmin() {
  const [loading, setLoading] = useState(true);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [produtos, setProdutos] = useState<ItemCardapio[]>([]);
  const [adicionais, setAdicionais] = useState<ItemCardapio[]>([]);
  const [fichaProdutos, setFichaProdutos] = useState<(FichaLinha & { produto_id: string })[]>([]);
  const [fichaAdicionais, setFichaAdicionais] = useState<(FichaLinha & { adicional_id: string })[]>([]);
  const [movs, setMovs] = useState<Movimentacao[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [ins, prods, ads, fp, fa, mv] = await Promise.all([
      sb.from("insumos").select("*").order("nome"),
      supabase.from("produtos").select("id, nome, preco").order("nome"),
      sb.from("adicionais").select("id, nome, preco").order("nome"),
      sb.from("produto_insumos").select("id, produto_id, insumo_id, quantidade"),
      sb.from("adicional_insumos").select("id, adicional_id, insumo_id, quantidade"),
      sb.from("estoque_movimentacoes").select("*").order("criado_em", { ascending: false }).limit(150),
    ]);
    setLoading(false);
    if (ins.error) {
      toast.error(
        ins.error.message?.includes("insumos")
          ? "Módulo de estoque ainda não foi instalado no banco (rode as migrations)."
          : ins.error.message,
      );
      return;
    }
    setInsumos((ins.data || []) as Insumo[]);
    setProdutos(((prods.data || []) as ItemCardapio[]).map((p) => ({ ...p, preco: Number(p.preco) })));
    setAdicionais(((ads.data || []) as ItemCardapio[]).map((a) => ({ ...a, preco: Number(a.preco) })));
    setFichaProdutos(fp.data || []);
    setFichaAdicionais(fa.data || []);
    setMovs(mv.data || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const insumoById = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);

  const custoFicha = useCallback(
    (linhas: FichaLinha[]) =>
      linhas.reduce((s, l) => s + Number(l.quantidade) * Number(insumoById.get(l.insumo_id)?.custo_unitario || 0), 0),
    [insumoById],
  );

  const abaixoMinimo = insumos.filter((i) => i.ativo && Number(i.estoque_minimo) > 0 && Number(i.estoque_atual) <= Number(i.estoque_minimo));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl text-foreground">Estoque & Lucro</h1>
        <p className="text-muted-foreground mt-1">
          Monte a ficha técnica dos produtos, controle o estoque (baixa automática a cada venda) e veja o lucro real de cada item.
        </p>
      </div>

      {abaixoMinimo.length > 0 && (
        <Card className="p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/30 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">Estoque baixo</div>
            <div className="text-muted-foreground">
              {abaixoMinimo.map((i) => `${i.nome} (${fmtQtd(i.estoque_atual)} ${i.unidade})`).join(" · ")}
            </div>
          </div>
        </Card>
      )}

      <Tabs defaultValue="lucro">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="lucro">Lucro por produto</TabsTrigger>
          <TabsTrigger value="ficha">Ficha técnica</TabsTrigger>
          <TabsTrigger value="insumos">Insumos & estoque</TabsTrigger>
          <TabsTrigger value="movs">Movimentações</TabsTrigger>
        </TabsList>

        <TabsContent value="lucro" className="mt-4">
          <LucroTab produtos={produtos} fichaProdutos={fichaProdutos} custoFicha={custoFicha} />
        </TabsContent>

        <TabsContent value="ficha" className="mt-4">
          <FichaTab
            loading={loading}
            insumos={insumos}
            produtos={produtos}
            adicionais={adicionais}
            fichaProdutos={fichaProdutos}
            fichaAdicionais={fichaAdicionais}
            custoFicha={custoFicha}
            onChange={load}
          />
        </TabsContent>

        <TabsContent value="insumos" className="mt-4">
          <InsumosTab loading={loading} insumos={insumos} onChange={load} />
        </TabsContent>

        <TabsContent value="movs" className="mt-4">
          <Card className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Insumo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Custo unit.</TableHead>
                  <TableHead>Obs.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhuma movimentação ainda.
                    </TableCell>
                  </TableRow>
                ) : (
                  movs.map((m) => {
                    const ins = insumoById.get(m.insumo_id);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap">{new Date(m.criado_em).toLocaleString("pt-BR")}</TableCell>
                        <TableCell>{ins?.nome ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={m.tipo === "entrada" ? "default" : "secondary"}>{TIPO_MOV_LABEL[m.tipo]}</Badge>
                        </TableCell>
                        <TableCell className={cn("text-right", Number(m.quantidade) < 0 ? "text-destructive" : "text-emerald-600")}>
                          {Number(m.quantidade) > 0 ? "+" : ""}
                          {fmtQtd(m.quantidade)} {ins?.unidade}
                        </TableCell>
                        <TableCell className="text-right">{brl(Number(m.custo_unitario))}</TableCell>
                        <TableCell className="text-muted-foreground">{m.observacao || ""}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Lucro por produto
// ---------------------------------------------------------------------------------

function LucroTab({
  produtos,
  fichaProdutos,
  custoFicha,
}: {
  produtos: ItemCardapio[];
  fichaProdutos: (FichaLinha & { produto_id: string })[];
  custoFicha: (l: FichaLinha[]) => number;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [rows, setRows] = useState<LucroProduto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const [ini, fim] = periodoRange(periodo);
    (async () => {
      const { data, error } = await sb.rpc("relatorio_lucro_produtos", {
        p_ini: ini.toISOString(),
        p_fim: fim.toISOString(),
      });
      if (!active) return;
      setLoading(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      setRows(
        ((data || []) as LucroProduto[]).map((r) => ({
          ...r,
          quantidade: Number(r.quantidade),
          receita: Number(r.receita),
          custo: Number(r.custo),
        })),
      );
    })();
    return () => {
      active = false;
    };
  }, [periodo]);

  const comFicha = rows.filter((r) => r.tem_ficha);
  const receitaFicha = comFicha.reduce((s, r) => s + r.receita, 0);
  const custoTotal = comFicha.reduce((s, r) => s + r.custo, 0);
  const lucro = receitaFicha - custoTotal;
  const semFicha = rows.filter((r) => !r.tem_ficha);

  // Visão de cardápio: margem de cada produto pela ficha atual, do pior para o melhor.
  const margensCardapio = useMemo(() => {
    const porProduto = new Map<string, FichaLinha[]>();
    for (const f of fichaProdutos) {
      const arr = porProduto.get(f.produto_id) || [];
      arr.push(f);
      porProduto.set(f.produto_id, arr);
    }
    return produtos
      .filter((p) => porProduto.has(p.id))
      .map((p) => {
        const custo = custoFicha(porProduto.get(p.id)!);
        return { ...p, custo, margem: margemPct(p.preco, custo) };
      })
      .sort((a, b) => a.margem - b.margem);
  }, [produtos, fichaProdutos, custoFicha]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <Button key={p.id} size="sm" variant={periodo === p.id ? "default" : "outline"} onClick={() => setPeriodo(p.id)}>
            {p.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Faturamento (itens c/ ficha)" value={brl(receitaFicha)} />
        <Kpi label="Custo dos insumos (CMV)" value={brl(custoTotal)} />
        <Kpi label="Lucro bruto" value={brl(lucro)} highlight />
        <Kpi
          label="CMV %"
          value={receitaFicha > 0 ? `${((custoTotal / receitaFicha) * 100).toFixed(1)}%` : "—"}
          hint="Ideal para hamburgueria: 25% a 35%"
        />
      </div>

      {semFicha.length > 0 && (
        <Card className="p-3 text-sm text-muted-foreground">
          {semFicha.length} produto(s) vendido(s) sem ficha técnica não entram no cálculo de lucro:{" "}
          <span className="text-foreground">{semFicha.slice(0, 6).map((r) => r.produto_nome).join(", ")}</span>
          {semFicha.length > 6 ? "…" : ""}. Monte a ficha na aba <b>Ficha técnica</b>.
        </Card>
      )}

      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Vendidos</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="text-right">Lucro</TableHead>
              <TableHead className="text-right">Margem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">Carregando...</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma venda no período.</TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const lucroItem = r.receita - r.custo;
                const pct = margemPct(r.receita, r.custo);
                return (
                  <TableRow key={r.produto_id ?? r.produto_nome}>
                    <TableCell className="font-medium">{r.produto_nome}</TableCell>
                    <TableCell className="text-right">{fmtQtd(r.quantidade)}</TableCell>
                    <TableCell className="text-right">{brl(r.receita)}</TableCell>
                    <TableCell className="text-right">{r.tem_ficha ? brl(r.custo) : "—"}</TableCell>
                    <TableCell className="text-right">{r.tem_ficha ? brl(lucroItem) : "—"}</TableCell>
                    <TableCell className={cn("text-right font-semibold", r.tem_ficha && margemClasse(pct))}>
                      {r.tem_ficha ? `${pct.toFixed(0)}%` : <span className="text-xs font-normal text-muted-foreground">sem ficha</span>}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {margensCardapio.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <TrendingUp className="w-4 h-4" /> Margem do cardápio (preço atual x custo da ficha)
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {margensCardapio.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.nome}</div>
                  <div className="text-xs text-muted-foreground">
                    Preço {brl(p.preco)} · Custo {brl(p.custo)}
                  </div>
                </div>
                <div className={cn("font-bold", margemClasse(p.margem))}>{p.margem.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <Card className={cn("p-4", highlight && "border-primary/40 bg-primary/5")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------------
// Ficha técnica
// ---------------------------------------------------------------------------------

function FichaTab({
  loading,
  insumos,
  produtos,
  adicionais,
  fichaProdutos,
  fichaAdicionais,
  custoFicha,
  onChange,
}: {
  loading: boolean;
  insumos: Insumo[];
  produtos: ItemCardapio[];
  adicionais: ItemCardapio[];
  fichaProdutos: (FichaLinha & { produto_id: string })[];
  fichaAdicionais: (FichaLinha & { adicional_id: string })[];
  custoFicha: (l: FichaLinha[]) => number;
  onChange: () => Promise<void> | void;
}) {
  const [alvo, setAlvo] = useState<"produto" | "adicional">("produto");
  const [itemId, setItemId] = useState<string>("");
  const [novoInsumo, setNovoInsumo] = useState<string>("");
  const [novaQtd, setNovaQtd] = useState("");
  const [busy, setBusy] = useState(false);

  const lista = alvo === "produto" ? produtos : adicionais;
  const item = lista.find((i) => i.id === itemId);
  const linhas: FichaLinha[] = alvo === "produto"
    ? fichaProdutos.filter((f) => f.produto_id === itemId)
    : fichaAdicionais.filter((f) => f.adicional_id === itemId);
  const custo = custoFicha(linhas);
  const tabela = alvo === "produto" ? "produto_insumos" : "adicional_insumos";
  const colunaAlvo = alvo === "produto" ? "produto_id" : "adicional_id";

  const comFicha = new Set((alvo === "produto" ? fichaProdutos.map((f) => f.produto_id) : fichaAdicionais.map((f) => f.adicional_id)));

  const adicionar = async () => {
    const qtd = parseNum(novaQtd);
    if (!itemId || !novoInsumo || !(qtd > 0)) {
      toast.error("Escolha o insumo e informe a quantidade.");
      return;
    }
    setBusy(true);
    const { error } = await sb
      .from(tabela)
      .upsert({ [colunaAlvo]: itemId, insumo_id: novoInsumo, quantidade: qtd }, { onConflict: `${colunaAlvo},insumo_id` });
    setBusy(false);
    if (error) return toast.error(error.message);
    setNovoInsumo("");
    setNovaQtd("");
    await onChange();
  };

  const remover = async (id: string) => {
    const { error } = await sb.from(tabela).delete().eq("id", id);
    if (error) return toast.error(error.message);
    await onChange();
  };

  if (!loading && insumos.length === 0) {
    return (
      <Card className="p-6 text-center text-muted-foreground">
        Cadastre primeiro os insumos (pão, carne, queijo, embalagem...) na aba <b>Insumos & estoque</b>.
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="p-4 space-y-3">
        <div className="flex gap-2">
          <Button size="sm" variant={alvo === "produto" ? "default" : "outline"} onClick={() => { setAlvo("produto"); setItemId(""); }}>
            Produtos
          </Button>
          <Button size="sm" variant={alvo === "adicional" ? "default" : "outline"} onClick={() => { setAlvo("adicional"); setItemId(""); }}>
            Adicionais
          </Button>
        </div>
        <div className="max-h-[480px] overflow-y-auto space-y-1">
          {lista.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setItemId(p.id)}
              className={cn(
                "w-full text-left rounded-md px-3 py-2 text-sm flex items-center justify-between gap-2 hover:bg-muted",
                itemId === p.id && "bg-muted font-medium",
              )}
            >
              <span className="truncate">{p.nome}</span>
              {comFicha.has(p.id) ? (
                <Badge variant="secondary" className="shrink-0">com ficha</Badge>
              ) : (
                <span className="text-[11px] text-muted-foreground shrink-0">sem ficha</span>
              )}
            </button>
          ))}
          {lista.length === 0 && <div className="text-sm text-muted-foreground">Nenhum item cadastrado.</div>}
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        {!item ? (
          <div className="text-muted-foreground text-sm">Selecione um {alvo === "produto" ? "produto" : "adicional"} para montar a ficha técnica.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-xl font-semibold">{item.nome}</div>
                <div className="text-sm text-muted-foreground">
                  {alvo === "adicional" ? "Quanto de insumo esse adicional consome (por unidade do item)." : "Quanto de cada insumo vai em 1 unidade."}
                </div>
              </div>
              <div className="flex gap-4 text-sm">
                <div><div className="text-muted-foreground text-xs">Preço</div><div className="font-semibold">{brl(item.preco)}</div></div>
                <div><div className="text-muted-foreground text-xs">Custo</div><div className="font-semibold">{brl(custo)}</div></div>
                <div>
                  <div className="text-muted-foreground text-xs">Margem</div>
                  <div className={cn("font-semibold", linhas.length && margemClasse(margemPct(item.preco, custo)))}>
                    {linhas.length && item.preco > 0 ? `${margemPct(item.preco, custo).toFixed(0)}%` : "—"}
                  </div>
                </div>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum insumo na ficha.</TableCell>
                  </TableRow>
                ) : (
                  linhas.map((l) => {
                    const ins = insumos.find((i) => i.id === l.insumo_id);
                    return (
                      <TableRow key={l.id}>
                        <TableCell>{ins?.nome ?? "—"}</TableCell>
                        <TableCell className="text-right">{fmtQtd(l.quantidade)} {ins?.unidade}</TableCell>
                        <TableCell className="text-right">{brl(Number(l.quantidade) * Number(ins?.custo_unitario || 0))}</TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" onClick={() => remover(l.id)} aria-label="Remover insumo">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[180px] space-y-1">
                <Label>Insumo</Label>
                <Select value={novoInsumo} onValueChange={setNovoInsumo}>
                  <SelectTrigger><SelectValue placeholder="Escolha o insumo" /></SelectTrigger>
                  <SelectContent>
                    {insumos.filter((i) => i.ativo).map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.nome} ({i.unidade})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32 space-y-1">
                <Label>Quantidade</Label>
                <Input
                  inputMode="decimal"
                  value={novaQtd}
                  onChange={(e) => setNovaQtd(e.target.value)}
                  placeholder={insumos.find((i) => i.id === novoInsumo)?.unidade === "kg" ? "ex: 0,150" : "ex: 1"}
                />
              </div>
              <Button onClick={adicionar} disabled={busy}>
                <Plus className="w-4 h-4 mr-1" /> Adicionar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A quantidade usa a unidade do insumo. Ex.: carne cadastrada em kg → 150 g = 0,150. Se o insumo já estiver na ficha, a quantidade é atualizada.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Insumos & estoque
// ---------------------------------------------------------------------------------

type MovDialog = { insumo: Insumo; tipo: "entrada" | "ajuste" | "perda" } | null;

function InsumosTab({ loading, insumos, onChange }: { loading: boolean; insumos: Insumo[]; onChange: () => Promise<void> | void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: "", unidade: "un", custo: "", minimo: "", estoqueInicial: "" });
  const [movDialog, setMovDialog] = useState<MovDialog>(null);
  const [movForm, setMovForm] = useState({ quantidade: "", custoTotal: "", observacao: "" });
  const [busy, setBusy] = useState(false);

  const abrirNovo = () => {
    setEditId(null);
    setForm({ nome: "", unidade: "un", custo: "", minimo: "", estoqueInicial: "" });
    setEditOpen(true);
  };

  const abrirEdicao = (i: Insumo) => {
    setEditId(i.id);
    setForm({
      nome: i.nome,
      unidade: i.unidade,
      custo: String(Number(i.custo_unitario)).replace(".", ","),
      minimo: String(Number(i.estoque_minimo)).replace(".", ","),
      estoqueInicial: "",
    });
    setEditOpen(true);
  };

  const salvar = async () => {
    const nome = form.nome.trim();
    const custo = parseNum(form.custo || "0");
    const minimo = parseNum(form.minimo || "0");
    if (!nome) return toast.error("Informe o nome do insumo.");
    if (!(custo >= 0) || !(minimo >= 0)) return toast.error("Valores inválidos.");
    setBusy(true);
    const payload = { nome, unidade: form.unidade, custo_unitario: custo, estoque_minimo: minimo };
    const res = editId
      ? await sb.from("insumos").update(payload).eq("id", editId).select("id").single()
      : await sb.from("insumos").insert(payload).select("id").single();
    if (res.error) {
      setBusy(false);
      return toast.error(res.error.message);
    }
    const inicial = parseNum(form.estoqueInicial || "0");
    if (!editId && inicial > 0) {
      const { error } = await sb.rpc("estoque_registrar_entrada", {
        p_insumo_id: res.data.id,
        p_quantidade: inicial,
        p_custo_total: inicial * custo,
        p_observacao: "Estoque inicial",
      });
      if (error) toast.error(error.message);
    }
    setBusy(false);
    setEditOpen(false);
    toast.success("Insumo salvo");
    await onChange();
  };

  const excluir = async (i: Insumo) => {
    if (!window.confirm(`Excluir "${i.nome}"? Ele sai de todas as fichas técnicas e o histórico de movimentações dele é apagado.`)) return;
    const { error } = await sb.from("insumos").delete().eq("id", i.id);
    if (error) return toast.error(error.message);
    await onChange();
  };

  const abrirMov = (insumo: Insumo, tipo: "entrada" | "ajuste" | "perda") => {
    setMovForm({ quantidade: "", custoTotal: "", observacao: "" });
    setMovDialog({ insumo, tipo });
  };

  const salvarMov = async () => {
    if (!movDialog) return;
    const qtd = parseNum(movForm.quantidade);
    const invalida = movDialog.tipo === "ajuste" ? qtd < 0 : qtd <= 0;
    if (!movForm.quantidade.trim() || !Number.isFinite(qtd) || invalida) {
      return toast.error("Informe uma quantidade válida.");
    }
    setBusy(true);
    let error: { message: string } | null = null;
    if (movDialog.tipo === "entrada") {
      ({ error } = await sb.rpc("estoque_registrar_entrada", {
        p_insumo_id: movDialog.insumo.id,
        p_quantidade: qtd,
        p_custo_total: parseNum(movForm.custoTotal || "0"),
        p_observacao: movForm.observacao || null,
      }));
    } else {
      // Ajuste: informa o estoque contado; lançamos a diferença. Perda: sai do estoque.
      const delta = movDialog.tipo === "perda" ? -Math.abs(qtd) : qtd - Number(movDialog.insumo.estoque_atual);
      if (delta === 0) {
        setBusy(false);
        setMovDialog(null);
        return;
      }
      ({ error } = await sb.from("estoque_movimentacoes").insert({
        insumo_id: movDialog.insumo.id,
        tipo: movDialog.tipo,
        quantidade: delta,
        custo_unitario: Number(movDialog.insumo.custo_unitario),
        observacao: movForm.observacao || null,
      }));
    }
    setBusy(false);
    if (error) return toast.error(error.message);
    setMovDialog(null);
    toast.success("Estoque atualizado");
    await onChange();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={abrirNovo}><Plus className="w-4 h-4 mr-1" /> Novo insumo</Button>
      </div>

      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Custo / unidade</TableHead>
              <TableHead className="text-right">Estoque atual</TableHead>
              <TableHead className="text-right">Mínimo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : insumos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum insumo. Comece cadastrando pão, carne, queijo, bacon, embalagens...
                </TableCell>
              </TableRow>
            ) : (
              insumos.map((i) => {
                const baixo = Number(i.estoque_minimo) > 0 && Number(i.estoque_atual) <= Number(i.estoque_minimo);
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.nome}</TableCell>
                    <TableCell className="text-right">{brl(Number(i.custo_unitario))} / {i.unidade}</TableCell>
                    <TableCell className={cn("text-right font-semibold", (baixo || Number(i.estoque_atual) < 0) && "text-destructive")}>
                      {fmtQtd(i.estoque_atual)} {i.unidade}
                      {baixo && <Badge variant="destructive" className="ml-2">baixo</Badge>}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtQtd(i.estoque_minimo)} {i.unidade}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="outline" onClick={() => abrirMov(i, "entrada")}>
                        <PackagePlus className="w-4 h-4 mr-1" /> Entrada
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => abrirMov(i, "ajuste")}>Ajustar</Button>
                      <Button size="sm" variant="ghost" onClick={() => abrirMov(i, "perda")}>
                        <ArrowDownToLine className="w-4 h-4 mr-1" /> Perda
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => abrirEdicao(i)} aria-label="Editar insumo">
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => excluir(i)} aria-label="Excluir insumo">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Editar insumo" : "Novo insumo"}</DialogTitle>
            <DialogDescription>O custo por unidade é usado na ficha técnica para calcular o lucro.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Carne bovina 150g" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Unidade</Label>
                <Select value={form.unidade} onValueChange={(v) => setForm({ ...form, unidade: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIDADES.map((u) => <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Custo por {form.unidade}</Label>
                <Input inputMode="decimal" value={form.custo} onChange={(e) => setForm({ ...form, custo: e.target.value })} placeholder="0,00" />
              </div>
              <div className="space-y-1">
                <Label>Estoque mínimo</Label>
                <Input inputMode="decimal" value={form.minimo} onChange={(e) => setForm({ ...form, minimo: e.target.value })} placeholder="0" />
              </div>
              {!editId && (
                <div className="space-y-1">
                  <Label>Estoque inicial</Label>
                  <Input inputMode="decimal" value={form.estoqueInicial} onChange={(e) => setForm({ ...form, estoqueInicial: e.target.value })} placeholder="0" />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={busy}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!movDialog} onOpenChange={(o) => !o && setMovDialog(null)}>
        <DialogContent>
          {movDialog && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {movDialog.tipo === "entrada" ? "Entrada de mercadoria" : movDialog.tipo === "ajuste" ? "Ajustar estoque (contagem)" : "Registrar perda"} — {movDialog.insumo.nome}
                </DialogTitle>
                <DialogDescription>
                  Estoque atual: {fmtQtd(movDialog.insumo.estoque_atual)} {movDialog.insumo.unidade}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>
                    {movDialog.tipo === "ajuste" ? `Quantidade contada (${movDialog.insumo.unidade})` : `Quantidade (${movDialog.insumo.unidade})`}
                  </Label>
                  <Input inputMode="decimal" value={movForm.quantidade} onChange={(e) => setMovForm({ ...movForm, quantidade: e.target.value })} />
                </div>
                {movDialog.tipo === "entrada" && (
                  <div className="space-y-1">
                    <Label>Valor total pago (R$)</Label>
                    <Input inputMode="decimal" value={movForm.custoTotal} onChange={(e) => setMovForm({ ...movForm, custoTotal: e.target.value })} placeholder="Deixe vazio para manter o custo atual" />
                    <p className="text-xs text-muted-foreground">O custo do insumo é atualizado pela média ponderada.</p>
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Observação</Label>
                  <Input value={movForm.observacao} onChange={(e) => setMovForm({ ...movForm, observacao: e.target.value })} placeholder="Opcional" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMovDialog(null)}>Cancelar</Button>
                <Button onClick={salvarMov} disabled={busy}>Confirmar</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
