import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Instagram, Phone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type Mensagem,
  type Prospect,
  type StatusProspect,
  MOTIVO_LABEL,
  SISTEMA_LABEL,
  STATUS_LABEL,
  dataHora,
  formatarTelefone,
  instagramUrl,
  sb,
  statusVariant,
  whatsappDe,
} from "@/lib/prospeccao";

const PONTOS_LABEL: Record<string, string> = {
  perfil: "Perfil",
  ativo: "Ativo",
  delivery_retirada: "Delivery/retirada",
  atividade: "Atividade",
  sistema: "Sistema",
  contato: "Contato",
  beneficio: "Benefício",
};

// Status que o operador pode marcar à mão (os demais o agente define sozinho).
const STATUS_MANUAIS: StatusProspect[] = ["qualificado", "contatado", "respondeu", "interessado", "demonstracao", "cliente", "sem_interesse", "nao_contatar", "desqualificado"];

export function ProspectDetalhe({ prospectId, onClose, onChange }: { prospectId: string | null; onClose: () => void; onChange: () => void }) {
  const [p, setP] = useState<Prospect | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [obs, setObs] = useState("");

  const load = useCallback(async () => {
    if (!prospectId) return;
    const [{ data: prospect }, { data: msgs }] = await Promise.all([
      sb.from("prospects").select("*").eq("id", prospectId).single(),
      sb.from("prospect_mensagens").select("*").eq("prospect_id", prospectId).order("criado_em"),
    ]);
    setP(prospect);
    setObs(prospect?.observacoes || "");
    setMensagens(msgs || []);
  }, [prospectId]);

  useEffect(() => {
    setP(null);
    void load();
  }, [load]);

  const atualizar = async (campos: Partial<Prospect>, aviso: string) => {
    if (!p) return;
    const { error } = await sb.from("prospects").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(aviso);
    await load();
    onChange();
  };

  const mudarStatus = (status: StatusProspect) => {
    const campos: Partial<Prospect> = { status };
    if (status === "cliente") campos.convertido_em = new Date().toISOString();
    if (status === "sem_interesse" || status === "nao_contatar") {
      campos.bloqueado = true;
      campos.motivo_desqualificacao = status;
    }
    if (status === "desqualificado") campos.motivo_desqualificacao = p?.motivo_desqualificacao || "manual";
    return atualizar(campos, `Status: ${STATUS_LABEL[status]}`);
  };

  const wa = whatsappDe(p?.telefone);

  return (
    <Sheet open={Boolean(prospectId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {!p ? (
          <p className="text-sm text-muted-foreground mt-8">Carregando...</p>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle className="font-display text-2xl">{p.nome}</SheetTitle>
              <SheetDescription>
                {[p.categoria, p.bairro, p.cidade && `${p.cidade} - ${p.uf ?? ""}`].filter(Boolean).join(" · ")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap gap-2">
              <Badge variant={statusVariant(p.status)}>{STATUS_LABEL[p.status]}</Badge>
              <Badge variant="outline">{SISTEMA_LABEL[p.sistema] ?? p.sistema} · confiança {p.sistema_confianca}</Badge>
              <Badge variant="outline">{p.pontuacao} pts · prioridade {p.prioridade}</Badge>
              {p.bloqueado && <Badge variant="destructive">Bloqueado</Badge>}
              {p.atendimento_humano && <Badge className="bg-amber-500 hover:bg-amber-500">Atendimento humano</Badge>}
            </div>

            {p.resumo_conversa && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <b>Resumo da conversa:</b> {p.resumo_conversa}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-sm">
              {p.telefone && (
                <a className="flex items-center gap-1 text-primary hover:underline" href={wa ? `https://wa.me/${wa}` : `tel:${p.telefone}`} target="_blank" rel="noreferrer">
                  <Phone className="h-3.5 w-3.5" /> {formatarTelefone(p.telefone)}
                </a>
              )}
              {p.instagram && (
                <a className="flex items-center gap-1 text-primary hover:underline" href={instagramUrl(p.instagram)!} target="_blank" rel="noreferrer">
                  <Instagram className="h-3.5 w-3.5" /> @{p.instagram}
                </a>
              )}
              {[
                ["Site", p.site],
                ["Facebook", p.facebook],
                ["Cardápio", p.link_cardapio],
              ].map(([rotulo, url]) =>
                url ? (
                  <a key={rotulo} className="flex items-center gap-1 text-primary hover:underline truncate" href={url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" /> {rotulo}
                  </a>
                ) : null,
              )}
              {p.email && <span className="truncate">{p.email}</span>}
            </div>

            <div>
              <Label className="text-xs uppercase text-muted-foreground">Evidências</Label>
              <ul className="mt-1 space-y-2 text-sm">
                {(p.evidencias || []).map((e, i) => (
                  <li key={i} className="rounded border p-2">
                    <span className="text-xs text-muted-foreground">{e.tipo}</span>{" "}
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">
                        {e.url}
                      </a>
                    ) : null}
                    {e.trecho && <p className="mt-1 italic">"{e.trecho}"</p>}
                  </li>
                ))}
                {!p.evidencias?.length && <li className="text-muted-foreground">Nenhuma evidência registrada.</li>}
              </ul>
            </div>

            <div>
              <Label className="text-xs uppercase text-muted-foreground">Pontuação</Label>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {Object.entries(p.pontuacao_detalhes || {}).map(([k, v]) => (
                  <span key={k} className="rounded bg-muted px-2 py-1">
                    {PONTOS_LABEL[k] ?? k}: <b>{v}</b>
                  </span>
                ))}
              </div>
              {p.motivo_desqualificacao && (
                <p className="mt-2 text-sm text-destructive">Motivo: {MOTIVO_LABEL[p.motivo_desqualificacao] ?? p.motivo_desqualificacao}</p>
              )}
            </div>

            <div>
              <Label className="text-xs uppercase text-muted-foreground">Conversa</Label>
              <div className="mt-2 space-y-2">
                {mensagens.map((m) => (
                  <div key={m.id} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", m.direcao === "saida" ? "ml-auto bg-primary/10" : "bg-muted")}>
                    <p className="whitespace-pre-wrap">{m.texto}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {dataHora(m.criado_em)} · {m.autor}
                      {m.canal !== "whatsapp" ? ` · ${m.canal}` : ""}
                      {m.intencao ? ` · ${m.intencao}` : ""}
                      {m.erro ? <span className="text-destructive"> · erro: {m.erro}</span> : null}
                    </p>
                  </div>
                ))}
                {!mensagens.length && <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Status</Label>
                <Select value={p.status} onValueChange={(v) => mudarStatus(v as StatusProspect)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_MANUAIS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                {p.atendimento_humano ? (
                  <Button variant="outline" className="w-full" onClick={() => atualizar({ atendimento_humano: false }, "IA volta a responder esta conversa")}>
                    Devolver para a IA
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => atualizar({ atendimento_humano: true }, "Conversa assumida por você")}>
                    Assumir conversa
                  </Button>
                )}
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea className="mt-1" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => atualizar({ observacoes: obs }, "Observações salvas")}>
                Salvar observações
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Descoberto em {dataHora(p.descoberto_em)} · verificado em {dataHora(p.verificado_em)}
              {p.consulta_origem ? ` · busca: "${p.consulta_origem}"` : ""}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
