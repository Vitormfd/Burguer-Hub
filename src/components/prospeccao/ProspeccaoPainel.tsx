import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pause, Play, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ESTADO_AGENTE_LABEL, MOTIVO_LABEL, SISTEMA_LABEL, chamarAgente, dataHora, sb } from "@/lib/prospeccao";

interface Metricas {
  total: number;
  qualificados: number;
  anota_ai: number;
  sem_sistema: number;
  aguardando_contato: number;
  contatados: number;
  responderam: number;
  interessados: number;
  demonstracoes: number;
  clientes: number;
  precisam_humano: number;
  taxa_resposta: number | null;
  taxa_conversao: number | null;
  custo_total_usd: number;
  custo_por_prospect_usd: number | null;
  custo_por_cliente_usd: number | null;
  custo_hoje_usd: number;
  por_segmento: Record<string, number>;
  por_estado: Record<string, number>;
  por_cidade: Record<string, number>;
  por_sistema: Record<string, number>;
  motivos_rejeicao: Record<string, number>;
}

interface EstadoAgente {
  ativo: boolean;
  estado: string;
  ultima_execucao_em: string | null;
  proxima_execucao_em: string | null;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
  cotacao_dolar: number;
}

const usd = (v: number | null | undefined, cotacao: number) =>
  v === null || v === undefined ? "—" : `US$ ${Number(v).toFixed(2)} (≈ R$ ${(Number(v) * cotacao).toFixed(2)})`;

export function ProspeccaoPainel({ versao, onMudou }: { versao: number; onMudou: () => void }) {
  const [m, setM] = useState<Metricas | null>(null);
  const [agente, setAgente] = useState<EstadoAgente | null>(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [met, cfg] = await Promise.all([
      sb.rpc("prospeccao_metricas"),
      sb.from("prospeccao_config").select("ativo, estado, ultima_execucao_em, proxima_execucao_em, ultimo_erro, ultimo_erro_em, cotacao_dolar").eq("id", 1).maybeSingle(),
    ]);
    if (met.error) return setErro(met.error.message.includes("não autorizado") ? "Seu usuário não é administrador da prospecção." : "Módulo de prospecção não instalado no banco (rode o script de deploy).");
    setM(met.data);
    setAgente(cfg.data);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load, versao]);

  const alternar = async () => {
    if (!agente) return;
    const { error } = await sb.from("prospeccao_config").update({ ativo: !agente.ativo, estado: agente.ativo ? "pausado" : "ativo" }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success(agente.ativo ? "Agente pausado" : "Agente retomado: trabalha na próxima janela da agenda");
    await load();
    onMudou();
  };

  const executarAgora = async () => {
    setBusy(true);
    const r = await chamarAgente({ acao: "executar_agora" });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Erro");
    toast.success("Pesquisa iniciada. Leva 1 a 2 minutos; os resultados aparecem sozinhos.");
    setTimeout(() => void load(), 5000);
  };

  if (erro) return <Card className="p-6 text-sm text-destructive">{erro}</Card>;
  if (!m || !agente) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  const cot = Number(agente.cotacao_dolar) || 5.5;

  return (
    <div className="space-y-6">
      <Card className="p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", agente.estado === "erro" ? "bg-destructive" : agente.ativo ? "bg-emerald-500" : "bg-muted-foreground")} />
            <span className="font-semibold">Agente: {ESTADO_AGENTE_LABEL[agente.estado] ?? agente.estado}</span>
            {!agente.ativo && <Badge variant="outline">pausado</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Última execução: {dataHora(agente.ultima_execucao_em)} · Próxima: {agente.ativo ? dataHora(agente.proxima_execucao_em) : "pausado"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={agente.ativo ? "outline" : "default"} onClick={alternar}>
            {agente.ativo ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            {agente.ativo ? "Pausar" : "Retomar"}
          </Button>
          <Button variant="secondary" onClick={executarAgora} disabled={busy || agente.estado === "executando"}>
            <Zap className="h-4 w-4 mr-1" /> Executar agora
          </Button>
        </div>
        {agente.ultimo_erro && (
          <div className="w-full flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <span>
              <b>Último problema ({dataHora(agente.ultimo_erro_em)}):</b> {agente.ultimo_erro}
            </span>
          </div>
        )}
      </Card>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
        <Kpi rotulo="Encontrados" valor={m.total} />
        <Kpi rotulo="Qualificados" valor={m.qualificados} />
        <Kpi rotulo="Usam Anota AI" valor={m.anota_ai} />
        <Kpi rotulo="Sem sistema" valor={m.sem_sistema} />
        <Kpi rotulo="Aguardando contato" valor={m.aguardando_contato} destaque />
        <Kpi rotulo="Precisam de você" valor={m.precisam_humano} destaque={m.precisam_humano > 0} />
        <Kpi rotulo="Contatados" valor={m.contatados} />
        <Kpi rotulo="Responderam" valor={m.responderam} />
        <Kpi rotulo="Com interesse" valor={m.interessados} />
        <Kpi rotulo="Demonstrações" valor={m.demonstracoes} />
        <Kpi rotulo="Clientes" valor={m.clientes} />
        <Kpi rotulo="Resposta / conversão" valor={`${m.taxa_resposta ?? 0}% / ${m.taxa_conversao ?? 0}%`} />
      </div>

      <Card className="p-4 text-sm grid gap-2 md:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Gasto hoje</p>
          <p className="font-semibold">{usd(m.custo_hoje_usd, cot)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Gasto total</p>
          <p className="font-semibold">{usd(m.custo_total_usd, cot)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Custo por prospect</p>
          <p className="font-semibold">{usd(m.custo_por_prospect_usd, cot)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Custo por cliente</p>
          <p className="font-semibold">{m.custo_por_cliente_usd === null ? "sem clientes ainda" : usd(m.custo_por_cliente_usd, cot)}</p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Distribuicao titulo="Por segmento" dados={m.por_segmento} />
        <Distribuicao titulo="Por sistema atual" dados={m.por_sistema} rotulos={SISTEMA_LABEL} />
        <Distribuicao titulo="Por estado" dados={m.por_estado} />
        <Distribuicao titulo="Principais cidades" dados={m.por_cidade} />
        <Distribuicao titulo="Motivos de rejeição" dados={m.motivos_rejeicao} rotulos={MOTIVO_LABEL} />
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, destaque }: { rotulo: string; valor: number | string; destaque?: boolean }) {
  return (
    <Card className={cn("p-3", destaque && "border-primary/50")}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="font-display text-3xl leading-tight tabular-nums">{valor}</p>
    </Card>
  );
}

/** Barras horizontais de uma série só: a cor marca a grandeza, o rótulo e o número ficam em texto. */
function Distribuicao({ titulo, dados, rotulos }: { titulo: string; dados: Record<string, number>; rotulos?: Record<string, string> }) {
  const linhas = Object.entries(dados || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const max = Math.max(1, ...linhas.map(([, v]) => v));
  const total = linhas.reduce((s, [, v]) => s + v, 0);
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">{titulo}</h3>
      {!linhas.length ? (
        <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
      ) : (
        <ul className="space-y-2">
          {linhas.map(([k, v]) => (
            <li key={k} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-2 text-sm" title={`${rotulos?.[k] ?? k}: ${v} (${Math.round((v / total) * 100)}%)`}>
              <span className="truncate text-muted-foreground">{rotulos?.[k] ?? k}</span>
              <span className="h-2.5 rounded-sm bg-muted/60">
                <span className="block h-full rounded-r-[4px] bg-primary" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
              </span>
              <span className="text-right tabular-nums">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
