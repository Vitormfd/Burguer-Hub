import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Instagram, MessageCircle, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type Prospect,
  SISTEMA_LABEL,
  chamarAgente,
  dataHora,
  formatarTelefone,
  sb,
  whatsappDe,
} from "@/lib/prospeccao";

type Secao = "humano" | "primeiro" | "followup";

const ORDEM_PRIORIDADE = { alta: 0, media: 1, baixa: 2 } as const;

export function ProspeccaoFila({ onAbrir, versao }: { onAbrir: (id: string) => void; versao: number }) {
  const [listas, setListas] = useState<Record<Secao, Prospect[]> | null>(null);

  const load = useCallback(async () => {
    const [humano, primeiro, followup] = await Promise.all([
      sb
        .from("prospects")
        .select("*")
        .eq("atendimento_humano", true)
        .not("status", "in", "(cliente,sem_interesse,nao_contatar,desqualificado)")
        .order("atualizado_em", { ascending: false })
        .limit(50),
      sb
        .from("prospects")
        .select("*")
        .eq("status", "qualificado")
        .eq("bloqueado", false)
        .is("contatado_em", null)
        .order("pontuacao", { ascending: false })
        .limit(60),
      sb.from("prospects").select("*").eq("proxima_acao", "Enviar follow-up").eq("bloqueado", false).eq("status", "contatado").limit(50),
    ]);
    const prim = (primeiro.data || []) as Prospect[];
    prim.sort((a, b) => ORDEM_PRIORIDADE[a.prioridade] - ORDEM_PRIORIDADE[b.prioridade] || b.pontuacao - a.pontuacao);
    setListas({ humano: humano.data || [], primeiro: prim, followup: followup.data || [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load, versao]);

  if (!listas) return <p className="text-sm text-muted-foreground">Carregando fila...</p>;

  return (
    <div className="space-y-6">
      <Card className="p-4 text-sm text-muted-foreground">
        O primeiro contato é sempre enviado por você: as políticas do WhatsApp e do Instagram não permitem mensagens
        automáticas para quem nunca falou com a empresa. Revise a mensagem e envie com um clique. Quando o
        estabelecimento responder no WhatsApp comercial, a IA continua a conversa sozinha, dentro das regras.
      </Card>

      {listas.humano.length > 0 && (
        <SecaoFila titulo="Precisam de você" descricao="Conversas em que a IA parou e pediu atendimento humano." itens={listas.humano} tipo="humano" onAbrir={onAbrir} onChange={load} />
      )}
      <SecaoFila
        titulo="Primeiro contato"
        descricao="Estabelecimentos qualificados, ordenados por prioridade e pontuação."
        itens={listas.primeiro}
        tipo="primeiro"
        onAbrir={onAbrir}
        onChange={load}
      />
      {listas.followup.length > 0 && (
        <SecaoFila
          titulo="Follow-up"
          descricao="Contatados há alguns dias sem resposta. Só um follow-up por estabelecimento."
          itens={listas.followup}
          tipo="followup"
          onAbrir={onAbrir}
          onChange={load}
        />
      )}
    </div>
  );
}

function SecaoFila(props: { titulo: string; descricao: string; itens: Prospect[]; tipo: Secao; onAbrir: (id: string) => void; onChange: () => void }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-2xl">
          {props.titulo} <span className="text-muted-foreground text-lg">({props.itens.length})</span>
        </h2>
        <p className="text-sm text-muted-foreground">{props.descricao}</p>
      </div>
      {props.itens.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nada por aqui agora.</Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {props.itens.map((p) => (
            <ItemFila key={p.id} p={p} tipo={props.tipo} onAbrir={props.onAbrir} onChange={props.onChange} />
          ))}
        </div>
      )}
    </section>
  );
}

function ItemFila({ p, tipo, onAbrir, onChange }: { p: Prospect; tipo: Secao; onAbrir: (id: string) => void; onChange: () => void }) {
  const [texto, setTexto] = useState(p.mensagem_sugerida || "");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setTexto(p.mensagem_sugerida || ""), [p.mensagem_sugerida]);

  const wa = whatsappDe(p.telefone);
  const tipoEnvio = tipo === "followup" ? "followup" : tipo === "humano" ? "resposta" : "primeiro_contato";

  const enviarApi = async () => {
    setBusy("enviar");
    const r = await chamarAgente({ acao: "enviar", prospect_id: p.id, texto, tipo: tipoEnvio });
    setBusy(null);
    if (!r.ok) return toast.error(r.error || "Não foi possível enviar");
    toast.success(`Mensagem enviada para ${p.nome}`);
    onChange();
  };

  const marcarEnviado = async (canal: string) => {
    setBusy("marcar");
    const r = await chamarAgente({ acao: "registrar_contato_manual", prospect_id: p.id, canal, texto });
    setBusy(null);
    if (!r.ok) return toast.error(r.error || "Erro");
    toast.success("Marcado como contatado");
    onChange();
  };

  const novaMensagem = async () => {
    setBusy("gerar");
    const r = await chamarAgente<{ mensagem?: string }>({ acao: "gerar_mensagem", prospect_id: p.id });
    setBusy(null);
    if (!r.ok) return toast.error(r.error || "Erro ao gerar");
    setTexto(r.mensagem || "");
    toast.success("Mensagem nova gerada");
  };

  const descartar = async () => {
    await sb.from("prospects").update({ status: "desqualificado", motivo_desqualificacao: "manual" }).eq("id", p.id);
    toast.success(`${p.nome} saiu da fila`);
    onChange();
  };

  const copiar = async () => {
    await navigator.clipboard.writeText(texto).catch(() => null);
    toast.success("Mensagem copiada");
  };

  const evidencia = p.evidencias?.[0];

  return (
    <Card className={cn("p-4 space-y-3", p.prioridade === "alta" && tipo === "primeiro" && "border-primary/50")}>
      <div className="flex items-start justify-between gap-2">
        <button className="text-left" onClick={() => onAbrir(p.id)}>
          <h3 className="font-semibold leading-tight hover:underline">{p.nome}</h3>
          <p className="text-xs text-muted-foreground">
            {[p.categoria, p.cidade && `${p.cidade} - ${p.uf ?? ""}`].filter(Boolean).join(" · ")}
          </p>
        </button>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant={p.sistema === "anota_ai" ? "default" : "secondary"}>{SISTEMA_LABEL[p.sistema] ?? p.sistema}</Badge>
          <span className="text-xs text-muted-foreground">
            {p.pontuacao} pts · {p.prioridade}
          </span>
        </div>
      </div>

      {tipo === "humano" && p.resumo_conversa && <p className="rounded bg-amber-500/10 p-2 text-sm">{p.resumo_conversa}</p>}
      {tipo === "humano" && p.proxima_acao && <p className="text-xs text-muted-foreground">{p.proxima_acao}</p>}

      {evidencia && tipo !== "humano" && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          Evidência: "{evidencia.trecho}"{" "}
          {evidencia.url && (
            <a href={evidencia.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              fonte
            </a>
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-xs">
        {p.telefone && <span>{formatarTelefone(p.telefone)}{wa ? " (WhatsApp)" : " (fixo)"}</span>}
        {p.instagram && <span>@{p.instagram}</span>}
        {p.contatado_em && <span className="text-muted-foreground">contatado {dataHora(p.contatado_em)}</span>}
      </div>

      {tipo !== "humano" && <Textarea rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} className="text-sm" />}

      <div className="flex flex-wrap gap-2">
        {tipo === "humano" ? (
          <>
            {wa && (
              <Button size="sm" asChild>
                <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4 mr-1" /> Abrir conversa
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onAbrir(p.id)}>
              Ver histórico
            </Button>
          </>
        ) : (
          <>
            {wa && (
              <>
                <Button size="sm" onClick={enviarApi} disabled={!texto.trim() || busy !== null}>
                  <Send className="h-4 w-4 mr-1" /> {busy === "enviar" ? "Enviando..." : "Enviar pelo WhatsApp comercial"}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`https://wa.me/${wa}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" /> Abrir no WhatsApp
                  </a>
                </Button>
              </>
            )}
            {!wa && p.instagram && (
              <>
                <Button size="sm" variant="outline" onClick={copiar}>
                  <Copy className="h-4 w-4 mr-1" /> Copiar
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`https://ig.me/m/${p.instagram}`} target="_blank" rel="noreferrer">
                    <Instagram className="h-4 w-4 mr-1" /> Abrir direct
                  </a>
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => marcarEnviado(wa ? "whatsapp" : "instagram")} disabled={busy !== null}>
              <Check className="h-4 w-4 mr-1" /> Já enviei
            </Button>
            {tipo === "primeiro" && (
              <>
                <Button size="sm" variant="ghost" onClick={novaMensagem} disabled={busy !== null}>
                  <RefreshCw className={cn("h-4 w-4 mr-1", busy === "gerar" && "animate-spin")} /> Outra mensagem
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={descartar} disabled={busy !== null}>
                  <X className="h-4 w-4 mr-1" /> Descartar
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
