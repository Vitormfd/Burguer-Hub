import { useCallback, useEffect, useMemo, useState } from "react";
import { endOfDay, startOfDay, startOfMonth, subDays } from "date-fns";
import { Bot, Eye, Heart, Link2, Play, RotateCcw, Send, Star, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { brl } from "@/lib/format";
import { cn } from "@/lib/utils";

// Tabelas novas ainda não estão nos tipos gerados do Supabase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Tipo = "reativacao" | "segunda_compra";

interface Automacao {
  id?: string;
  tipo: Tipo;
  ativo: boolean;
  dias: number;
  mensagem: string;
  cupom_id: string | null;
  janela_conversao_dias: number;
  max_envios_dia: number;
  ultima_execucao_em?: string | null;
}

interface Cupom {
  id: string;
  codigo: string;
}

const AUTOMACOES: Record<Tipo, { titulo: string; descricao: string; diasLabel: string; icon: typeof RotateCcw; padrao: Omit<Automacao, "tipo"> }> = {
  reativacao: {
    titulo: "Sentimos sua falta",
    descricao: "Manda uma mensagem para quem não pede há algum tempo, com um cupom para voltar.",
    diasLabel: "Dias sem pedir",
    icon: RotateCcw,
    padrao: {
      ativo: false,
      dias: 30,
      mensagem:
        "Oi {nome}! 😊 Faz um tempinho que você não pede no {loja} e a gente sentiu sua falta.\nUse o cupom *{cupom}* no seu próximo pedido 🍔\n{link}",
      cupom_id: null,
      janela_conversao_dias: 7,
      max_envios_dia: 30,
    },
  },
  segunda_compra: {
    titulo: "Segunda compra",
    descricao: "Alguns dias depois do primeiro pedido, convida o cliente novo a pedir de novo.",
    diasLabel: "Dias após o 1º pedido",
    icon: UserPlus,
    padrao: {
      ativo: false,
      dias: 5,
      mensagem:
        "Oi {nome}! Obrigado pelo seu primeiro pedido no {loja} 🧡\nQue tal repetir? Seu cupom *{cupom}* já está liberado.\n{link}",
      cupom_id: null,
      janela_conversao_dias: 7,
      max_envios_dia: 30,
    },
  },
};

const TIPO_LABEL: Record<Tipo, string> = { reativacao: "Sentimos sua falta", segunda_compra: "Segunda compra" };

type Periodo = "7d" | "30d" | "mes" | "90d";
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "90d", label: "90 dias" },
];
const periodoRange = (p: Periodo): [Date, Date] => {
  const now = new Date();
  if (p === "7d") return [startOfDay(subDays(now, 6)), endOfDay(now)];
  if (p === "30d") return [startOfDay(subDays(now, 29)), endOfDay(now)];
  if (p === "90d") return [startOfDay(subDays(now, 89)), endOfDay(now)];
  return [startOfMonth(now), endOfDay(now)];
};

async function invocarMarketing(body: { dry_run?: boolean; tipo?: Tipo }) {
  const { data, error } = await supabase.functions.invoke("marketing-automacoes", { body });
  if (error) return { ok: false as const, error: error.message };
  return data as {
    ok: boolean;
    error?: string;
    max_por_execucao?: number;
    resultados?: { tipo: Tipo; enviados: number; erros: number; pulado?: string; candidatos?: { nome: string | null; telefone: string; ultimo_pedido: string }[] }[];
  };
}

export default function MarketingAdmin() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl text-foreground">Marketing automático</h1>
        <p className="text-muted-foreground mt-1">
          Traga clientes de volta pelo WhatsApp no piloto automático e veja quanto cada campanha faturou.
        </p>
      </div>

      <Tabs defaultValue="automacoes">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="automacoes">Automações</TabsTrigger>
          <TabsTrigger value="resultados">Resultados</TabsTrigger>
          <TabsTrigger value="avaliacoes">Avaliações</TabsTrigger>
          <TabsTrigger value="recursos">Recursos</TabsTrigger>
        </TabsList>
        <TabsContent value="automacoes" className="mt-4"><AutomacoesTab /></TabsContent>
        <TabsContent value="resultados" className="mt-4"><ResultadosTab /></TabsContent>
        <TabsContent value="avaliacoes" className="mt-4"><AvaliacoesTab /></TabsContent>
        <TabsContent value="recursos" className="mt-4"><RecursosTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Automações
// ---------------------------------------------------------------------------------

function AutomacoesTab() {
  const [automacoes, setAutomacoes] = useState<Record<Tipo, Automacao> | null>(null);
  const [cupons, setCupons] = useState<Cupom[]>([]);
  const [erro, setErro] = useState("");

  const load = useCallback(async () => {
    const [auto, cup] = await Promise.all([
      sb.from("marketing_automacoes").select("*"),
      sb.from("cupons").select("id, codigo").eq("ativo", true).order("codigo"),
    ]);
    if (auto.error) {
      setErro("Módulo de marketing ainda não foi instalado no banco (rode as migrations).");
      return;
    }
    const map = {} as Record<Tipo, Automacao>;
    for (const tipo of Object.keys(AUTOMACOES) as Tipo[]) {
      const row = (auto.data || []).find((r: Automacao) => r.tipo === tipo);
      map[tipo] = row ? { ...row } : { tipo, ...AUTOMACOES[tipo].padrao };
    }
    setAutomacoes(map);
    setCupons(cup.data || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (erro) return <Card className="p-6 text-muted-foreground">{erro}</Card>;
  if (!automacoes) return <div className="text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-4">
      <Card className="p-4 text-sm text-muted-foreground">
        As mensagens saem pelo WhatsApp conectado em <b>Configurações → WhatsApp</b>, de hora em hora entre 10h e 20h, com
        intervalo entre elas. Cada cliente recebe no máximo uma mensagem de marketing a cada 7 dias. Variáveis:{" "}
        <code>{"{nome}"}</code> <code>{"{loja}"}</code> <code>{"{cupom}"}</code> <code>{"{link}"}</code> (cardápio).
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        {(Object.keys(AUTOMACOES) as Tipo[]).map((tipo) => (
          <AutomacaoCard key={tipo} inicial={automacoes[tipo]} cupons={cupons} onSaved={load} />
        ))}
      </div>
    </div>
  );
}

function AutomacaoCard({ inicial, cupons, onSaved }: { inicial: Automacao; cupons: Cupom[]; onSaved: () => void }) {
  const meta = AUTOMACOES[inicial.tipo];
  const Icon = meta.icon;
  const [form, setForm] = useState<Automacao>(inicial);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ nome: string | null; telefone: string; ultimo_pedido: string }[] | null>(null);

  useEffect(() => setForm(inicial), [inicial]);

  const salvar = async (patch?: Partial<Automacao>) => {
    const dados = { ...form, ...patch };
    if (dados.ativo && !dados.mensagem.trim()) return toast.error("Escreva a mensagem antes de ativar.");
    if (dados.ativo && dados.mensagem.includes("{cupom}") && !dados.cupom_id) {
      toast.warning("A mensagem usa {cupom} mas nenhum cupom foi escolhido — a linha do cupom não será enviada.");
    }
    setBusy(true);
    const payload = {
      tipo: dados.tipo,
      ativo: dados.ativo,
      dias: Math.min(Math.max(Math.round(Number(dados.dias) || 1), 1), 365),
      mensagem: dados.mensagem,
      cupom_id: dados.cupom_id,
      janela_conversao_dias: Math.min(Math.max(Math.round(Number(dados.janela_conversao_dias) || 7), 1), 30),
      max_envios_dia: Math.min(Math.max(Math.round(Number(dados.max_envios_dia) || 30), 1), 200),
      atualizado_em: new Date().toISOString(),
    };
    const { error } = await sb.from("marketing_automacoes").upsert(payload, { onConflict: "owner_id,tipo" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(patch?.ativo === true ? "Automação ativada" : patch?.ativo === false ? "Automação pausada" : "Automação salva");
    onSaved();
  };

  const verPublico = async () => {
    setBusy(true);
    const res = await invocarMarketing({ dry_run: true, tipo: form.tipo });
    setBusy(false);
    if (!res.ok) return toast.error(res.error || "Não foi possível consultar. Salve a automação primeiro.");
    const r = res.resultados?.find((x) => x.tipo === form.tipo);
    if (!r) return toast.error("Salve a automação antes de ver o público.");
    setPreview(r.candidatos || []);
  };

  const executarAgora = async () => {
    setBusy(true);
    const res = await invocarMarketing({ tipo: form.tipo });
    setBusy(false);
    if (!res.ok) return toast.error(res.error || "Falha ao executar");
    const r = res.resultados?.find((x) => x.tipo === form.tipo);
    if (!r) return toast.error("Salve e ative a automação antes de executar.");
    if (r.pulado) return toast.warning(r.pulado);
    if (r.enviados === 0 && r.erros === 0) return toast.info("Nenhum cliente elegível agora.");
    toast.success(`${r.enviados} mensagem(ns) enviada(s)${r.erros ? `, ${r.erros} com erro` : ""}. O restante segue nas próximas horas.`);
  };

  const exemplo = form.mensagem
    .replace(/\{nome\}/g, "Maria")
    .replace(/\{loja\}/g, "sua loja")
    .replace(/\{cupom\}/g, cupons.find((c) => c.id === form.cupom_id)?.codigo || "CUPOM")
    .replace(/\{link\}/g, "https://easyfoodhub.com.br/sua-loja/cardapio");

  return (
    <Card className={cn("p-5 space-y-4", form.ativo && inicial.id && "border-emerald-400/60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary h-fit"><Icon className="w-5 h-5" /></div>
          <div>
            <div className="font-semibold text-lg flex items-center gap-2">
              {meta.titulo}
              {inicial.ativo && inicial.id ? <Badge className="bg-emerald-600">Ativa</Badge> : <Badge variant="secondary">Pausada</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{meta.descricao}</p>
          </div>
        </div>
        <Switch
          checked={form.ativo}
          disabled={busy}
          onCheckedChange={(v) => {
            setForm({ ...form, ativo: v });
            void salvar({ ativo: v });
          }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>{meta.diasLabel}</Label>
          <Input type="number" min={1} max={365} value={form.dias} onChange={(e) => setForm({ ...form, dias: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label>Máx. envios/dia</Label>
          <Input type="number" min={1} max={200} value={form.max_envios_dia} onChange={(e) => setForm({ ...form, max_envios_dia: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label>Contar retorno em</Label>
          <Select value={String(form.janela_conversao_dias)} onValueChange={(v) => setForm({ ...form, janela_conversao_dias: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[3, 7, 14, 30].map((d) => <SelectItem key={d} value={String(d)}>{d} dias</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label>Cupom enviado</Label>
        <Select value={form.cupom_id ?? "none"} onValueChange={(v) => setForm({ ...form, cupom_id: v === "none" ? null : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem cupom</SelectItem>
            {cupons.map((c) => <SelectItem key={c.id} value={c.id}>{c.codigo}</SelectItem>)}
          </SelectContent>
        </Select>
        {cupons.length === 0 && <p className="text-xs text-muted-foreground">Crie um cupom em <b>Cupons</b> para oferecer na mensagem.</p>}
      </div>

      <div className="space-y-1">
        <Label>Mensagem</Label>
        <Textarea rows={4} value={form.mensagem} onChange={(e) => setForm({ ...form, mensagem: e.target.value })} />
      </div>

      <div className="rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Prévia</div>
        {exemplo}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => salvar()} disabled={busy}>Salvar</Button>
        <Button variant="outline" onClick={verPublico} disabled={busy || !inicial.id}>
          <Eye className="w-4 h-4 mr-1" /> Quem vai receber
        </Button>
        <Button variant="outline" onClick={executarAgora} disabled={busy || !inicial.id || !inicial.ativo}>
          <Play className="w-4 h-4 mr-1" /> Executar agora
        </Button>
      </div>
      {inicial.ultima_execucao_em && (
        <p className="text-xs text-muted-foreground">Última execução: {new Date(inicial.ultima_execucao_em).toLocaleString("pt-BR")}</p>
      )}

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{meta.titulo}: quem receberia agora</DialogTitle>
            <DialogDescription>
              {preview?.length ? `${preview.length} cliente(s) elegível(is) (mostrando até 50).` : "Nenhum cliente elegível no momento."}
            </DialogDescription>
          </DialogHeader>
          {!!preview?.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Último pedido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((c) => (
                  <TableRow key={c.telefone}>
                    <TableCell>{c.nome || "—"}</TableCell>
                    <TableCell>{c.telefone}</TableCell>
                    <TableCell>{new Date(c.ultimo_pedido).toLocaleDateString("pt-BR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------------

interface ResultadoRow {
  automacao_tipo: Tipo;
  envios: number;
  erros: number;
  convertidos: number;
  pedidos: number;
  faturamento: number;
}

interface Envio {
  id: string;
  automacao_tipo: Tipo;
  cliente_nome: string | null;
  telefone: string;
  status: "enviado" | "erro";
  erro: string | null;
  enviado_em: string;
}

function ResultadosTab() {
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [rows, setRows] = useState<ResultadoRow[]>([]);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const [ini, fim] = periodoRange(periodo);
    (async () => {
      const [rel, env] = await Promise.all([
        sb.rpc("relatorio_marketing", { p_ini: ini.toISOString(), p_fim: fim.toISOString() }),
        sb.from("marketing_envios")
          .select("id, automacao_tipo, cliente_nome, telefone, status, erro, enviado_em")
          .gte("enviado_em", ini.toISOString())
          .order("enviado_em", { ascending: false })
          .limit(100),
      ]);
      if (!active) return;
      setLoading(false);
      if (rel.error) {
        toast.error(rel.error.message);
        return;
      }
      setRows(((rel.data || []) as ResultadoRow[]).map((r) => ({
        ...r,
        envios: Number(r.envios),
        erros: Number(r.erros),
        convertidos: Number(r.convertidos),
        pedidos: Number(r.pedidos),
        faturamento: Number(r.faturamento),
      })));
      setEnvios(env.data || []);
    })();
    return () => {
      active = false;
    };
  }, [periodo]);

  const total = rows.reduce(
    (acc, r) => ({
      envios: acc.envios + r.envios,
      convertidos: acc.convertidos + r.convertidos,
      pedidos: acc.pedidos + r.pedidos,
      faturamento: acc.faturamento + r.faturamento,
    }),
    { envios: 0, convertidos: 0, pedidos: 0, faturamento: 0 },
  );

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
        <Kpi label="Mensagens enviadas" value={String(total.envios)} />
        <Kpi
          label="Clientes que voltaram"
          value={String(total.convertidos)}
          hint={total.envios ? `${((total.convertidos / total.envios) * 100).toFixed(1)}% de retorno` : undefined}
        />
        <Kpi label="Pedidos gerados" value={String(total.pedidos)} />
        <Kpi label="Faturamento gerado" value={brl(total.faturamento)} highlight />
      </div>

      {rows.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.automacao_tipo} className="p-4">
              <div className="font-semibold">{TIPO_LABEL[r.automacao_tipo] ?? r.automacao_tipo}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {r.envios} enviadas · {r.convertidos} voltaram ({r.envios ? ((r.convertidos / r.envios) * 100).toFixed(1) : "0"}%) · {r.pedidos} pedidos
              </div>
              <div className="text-xl font-bold mt-2">{brl(r.faturamento)}</div>
              {r.erros > 0 && <div className="text-xs text-destructive mt-1">{r.erros} envio(s) com erro</div>}
            </Card>
          ))}
        </div>
      )}

      <Card className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Automação</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : envios.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum envio no período.</TableCell></TableRow>
            ) : (
              envios.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{new Date(e.enviado_em).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>{TIPO_LABEL[e.automacao_tipo] ?? e.automacao_tipo}</TableCell>
                  <TableCell>{e.cliente_nome || e.telefone}</TableCell>
                  <TableCell>
                    {e.status === "enviado" ? (
                      <Badge variant="secondary"><Send className="w-3 h-3 mr-1" />Enviado</Badge>
                    ) : (
                      <Badge variant="destructive" title={e.erro || ""}>Erro</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
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
// Avaliações
// ---------------------------------------------------------------------------------

interface Avaliacao {
  id: string;
  pedido_id: string;
  nota: number;
  comentario: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  criado_em: string;
}

function AvaliacoesTab() {
  const [rows, setRows] = useState<Avaliacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"todas" | "baixas">("todas");

  useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("avaliacoes")
        .select("*")
        .order("criado_em", { ascending: false })
        .limit(300);
      setLoading(false);
      if (error) {
        toast.error("Avaliações ainda não instaladas no banco (rode as migrations).");
        return;
      }
      setRows(data || []);
    })();
  }, []);

  const media = rows.length ? rows.reduce((s, r) => s + r.nota, 0) / rows.length : 0;
  const dist = useMemo(() => [5, 4, 3, 2, 1].map((n) => ({ n, qtd: rows.filter((r) => r.nota === n).length })), [rows]);
  const lista = filtro === "baixas" ? rows.filter((r) => r.nota <= 3) : rows;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <Card className="p-5 text-center">
          <div className="text-5xl font-bold">{rows.length ? media.toFixed(1) : "—"}</div>
          <div className="flex justify-center gap-0.5 my-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} className={cn("w-5 h-5", n <= Math.round(media) ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
            ))}
          </div>
          <div className="text-sm text-muted-foreground">{rows.length} avaliação(ões)</div>
        </Card>
        <Card className="p-5 space-y-2">
          {dist.map(({ n, qtd }) => (
            <div key={n} className="flex items-center gap-3 text-sm">
              <span className="w-8">{n} ★</span>
              <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: rows.length ? `${(qtd / rows.length) * 100}%` : 0 }} />
              </div>
              <span className="w-8 text-right text-muted-foreground">{qtd}</span>
            </div>
          ))}
        </Card>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={filtro === "todas" ? "default" : "outline"} onClick={() => setFiltro("todas")}>Todas</Button>
        <Button size="sm" variant={filtro === "baixas" ? "default" : "outline"} onClick={() => setFiltro("baixas")}>Notas até 3</Button>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-muted-foreground">Carregando...</div>
        ) : lista.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            Nenhuma avaliação ainda. Os clientes recebem o link para avaliar quando o pedido é marcado como entregue.
          </Card>
        ) : (
          lista.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} className={cn("w-4 h-4", n <= r.nota ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                    ))}
                  </div>
                  <span className="font-medium">{r.cliente_nome || "Cliente"}</span>
                  {r.cliente_telefone && <span className="text-xs text-muted-foreground">{r.cliente_telefone}</span>}
                </div>
                <span className="text-xs text-muted-foreground">
                  #{r.pedido_id.slice(0, 8).toUpperCase()} · {new Date(r.criado_em).toLocaleString("pt-BR")}
                </span>
              </div>
              {r.comentario && <p className="text-sm mt-2">{r.comentario}</p>}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Recursos (liga/desliga)
// ---------------------------------------------------------------------------------

type RecursoCol = "whatsapp_ia_ativa" | "acompanhamento_link_ativo" | "avaliacao_ativa";

const RECURSOS: { col: RecursoCol; titulo: string; descricao: string; icon: typeof Bot }[] = [
  {
    col: "whatsapp_ia_ativa",
    titulo: "Atendente com IA no WhatsApp",
    descricao:
      "O robô entende pedidos escritos do jeito do cliente (\"quero 2 x-bacon sem cebola e uma coca\") e monta o carrinho sozinho. O menu numerado continua funcionando.",
    icon: Bot,
  },
  {
    col: "acompanhamento_link_ativo",
    titulo: "Link de acompanhamento do pedido",
    descricao: "Envia na confirmação do WhatsApp um link onde o cliente acompanha o status do pedido em tempo real.",
    icon: Link2,
  },
  {
    col: "avaliacao_ativa",
    titulo: "Pedir avaliação após a entrega",
    descricao: "Quando o pedido é marcado como entregue, o cliente recebe o link para avaliar de 1 a 5 estrelas.",
    icon: Heart,
  },
];

function RecursosTab() {
  const [cfg, setCfg] = useState<{ id: string } & Partial<Record<RecursoCol, boolean>> | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("configuracoes")
        .select("id, whatsapp_ia_ativa, acompanhamento_link_ativo, avaliacao_ativa")
        .limit(1)
        .maybeSingle();
      if (error) {
        setErro("Recursos ainda não instalados no banco (rode as migrations).");
        return;
      }
      setCfg(data);
    })();
  }, []);

  const alternar = async (col: RecursoCol, valor: boolean) => {
    if (!cfg) return;
    setCfg({ ...cfg, [col]: valor });
    const { error } = await sb.from("configuracoes").update({ [col]: valor }).eq("id", cfg.id);
    if (error) {
      setCfg({ ...cfg, [col]: !valor });
      toast.error(error.message);
      return;
    }
    toast.success(valor ? "Ativado" : "Desativado");
  };

  if (erro) return <Card className="p-6 text-muted-foreground">{erro}</Card>;
  if (!cfg) return <div className="text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-3 max-w-3xl">
      {RECURSOS.map((r) => {
        const Icon = r.icon;
        return (
          <Card key={r.col} className="p-4 flex items-start gap-4">
            <div className="p-2 rounded-lg bg-primary/10 text-primary"><Icon className="w-5 h-5" /></div>
            <div className="flex-1">
              <div className="font-semibold">{r.titulo}</div>
              <p className="text-sm text-muted-foreground">{r.descricao}</p>
            </div>
            <Switch checked={Boolean(cfg[r.col])} onCheckedChange={(v) => alternar(r.col, v)} />
          </Card>
        );
      })}
    </div>
  );
}
