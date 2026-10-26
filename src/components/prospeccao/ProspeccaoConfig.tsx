import { useCallback, useEffect, useState } from "react";
import { QrCode, Save, Smartphone, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { chamarAgente, sb } from "@/lib/prospeccao";

interface Config {
  ativo: boolean;
  dias_semana: number[];
  hora_inicio: string;
  hora_fim: string;
  fuso: string;
  minutos_diarios: number;
  meta_qualificados_dia: number;
  meta_contatos_dia: number;
  especialidades: string[];
  estados: string[];
  cidades: string[];
  peso_anota_ai: number;
  peso_sem_sistema: number;
  pontuacao_minima: number;
  limite_gasto_diario_usd: number;
  limite_gasto_mensal_usd: number;
  limite_buscas_web_dia: number;
  limite_places_dia: number;
  limite_respostas_ia_dia: number;
  cotacao_dolar: number;
  preco_mensal: number;
  teste_gratis_dias: number;
  bot_whatsapp: "incluso" | "nao_incluso" | "consultar";
  link_site: string;
  link_demo: string;
  nome_remetente: string;
  evolution_instance: string;
  responder_automatico: boolean;
  telefone_alertas: string;
}

const ESTADO_WHATSAPP: Record<string, string> = {
  inexistente: "Não configurado",
  connecting: "Aguardando conexão",
  close: "Desconectado",
};

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const FUSOS = ["America/Sao_Paulo", "America/Bahia", "America/Fortaleza", "America/Recife", "America/Belem", "America/Manaus", "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha"];

const lista = (s: string) =>
  s
    .split(/[\n;,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

// Só os campos editáveis: estado, erros e horários de execução são do agente.
const CAMPOS_EDITAVEIS: (keyof Config)[] = [
  "ativo", "dias_semana", "hora_inicio", "hora_fim", "fuso", "minutos_diarios", "meta_qualificados_dia", "meta_contatos_dia",
  "peso_anota_ai", "peso_sem_sistema", "pontuacao_minima", "limite_gasto_diario_usd", "limite_gasto_mensal_usd",
  "limite_buscas_web_dia", "limite_places_dia", "limite_respostas_ia_dia", "cotacao_dolar", "preco_mensal", "teste_gratis_dias",
  "bot_whatsapp", "link_site", "link_demo", "nome_remetente", "evolution_instance", "responder_automatico", "telefone_alertas",
];

export function ProspeccaoConfig({ onSalvo }: { onSalvo: () => void }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [textos, setTextos] = useState({ especialidades: "", estados: "", cidades: "" });
  const [salvando, setSalvando] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await sb.from("prospeccao_config").select("*").eq("id", 1).maybeSingle();
    if (error || !data) return toast.error("Configuração da prospecção não encontrada (rode o deploy).");
    const c = { ...data, hora_inicio: String(data.hora_inicio).slice(0, 5), hora_fim: String(data.hora_fim).slice(0, 5) } as Config;
    setCfg(c);
    setTextos({ especialidades: c.especialidades.join(", "), estados: c.estados.join(", "), cidades: c.cidades.join("\n") });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!cfg) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg({ ...cfg, [k]: v });
  const num = (k: keyof Config) => ({
    type: "number",
    value: String(cfg[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never),
  });

  const salvar = async () => {
    if (cfg.hora_fim <= cfg.hora_inicio) return toast.error("O horário de encerramento precisa ser depois do início.");
    if (!cfg.dias_semana.length) return toast.error("Escolha pelo menos um dia da semana.");
    if (!(cfg.preco_mensal > 0)) return toast.error("Informe o preço mensal.");
    const estados = lista(textos.estados).map((e) => e.toUpperCase()).filter((e) => /^[A-Z]{2}$/.test(e));
    const cidades = textos.cidades.split("\n").map((c) => c.trim()).filter(Boolean);
    const invalidas = cidades.filter((c) => !/^.+\s*[-/,]\s*[A-Za-z]{2}$/.test(c));
    if (invalidas.length) return toast.error(`Use "Cidade - UF": ${invalidas.slice(0, 3).join(", ")}`);

    setSalvando(true);
    const { error } = await sb
      .from("prospeccao_config")
      .update({
        ...Object.fromEntries(CAMPOS_EDITAVEIS.map((k) => [k, cfg[k]])),
        estado: cfg.ativo ? "ativo" : "pausado",
        especialidades: lista(textos.especialidades).map((e) => e.toLowerCase()),
        estados,
        cidades,
        minutos_diarios: Math.min(Math.max(Math.round(cfg.minutos_diarios), 5), 1440),
        teste_gratis_dias: Math.min(Math.max(Math.round(cfg.teste_gratis_dias), 0), 90),
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", 1);
    setSalvando(false);
    if (error) return toast.error(error.message);
    toast.success("Configuração salva");
    onSalvo();
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4 space-y-4">
          <h3 className="font-semibold">Rotina</h3>
          <div className="flex items-center justify-between">
            <Label>Agente ligado</Label>
            <Switch checked={cfg.ativo} onCheckedChange={(v) => set("ativo", v)} />
          </div>
          <div>
            <Label>Dias da semana</Label>
            <div className="mt-2 flex flex-wrap gap-1">
              {DIAS.map((d, i) => {
                const on = cfg.dias_semana.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set("dias_semana", on ? cfg.dias_semana.filter((x) => x !== i) : [...cfg.dias_semana, i].sort())}
                    className={cn("rounded-md border px-3 py-1 text-sm", on ? "bg-primary text-primary-foreground border-primary" : "bg-background")}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Início">
              <Input type="time" value={cfg.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} />
            </Campo>
            <Campo rotulo="Encerramento">
              <Input type="time" value={cfg.hora_fim} onChange={(e) => set("hora_fim", e.target.value)} />
            </Campo>
            <Campo rotulo="Fuso horário">
              <Select value={cfg.fuso} onValueChange={(v) => set("fuso", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUSOS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f.replace("America/", "").replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Tempo de pesquisa por dia (min)">
              <Input {...num("minutos_diarios")} />
            </Campo>
            <Campo rotulo="Meta de qualificados por dia">
              <Input {...num("meta_qualificados_dia")} />
            </Campo>
            <Campo rotulo="Máximo de primeiros contatos por dia">
              <Input {...num("meta_contatos_dia")} />
            </Campo>
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="font-semibold">Alvo</h3>
          <Campo rotulo="Especialidades prioritárias (separadas por vírgula)">
            <Textarea rows={2} value={textos.especialidades} onChange={(e) => setTextos({ ...textos, especialidades: e.target.value })} />
          </Campo>
          <Campo rotulo="Estados (UF, vírgula). Vazio = Brasil inteiro">
            <Input value={textos.estados} placeholder="BA, PE, MG" onChange={(e) => setTextos({ ...textos, estados: e.target.value })} />
          </Campo>
          <Campo rotulo="Cidades específicas (uma por linha, “Cidade - UF”). Vazio = automático">
            <Textarea rows={3} value={textos.cidades} placeholder={"Feira de Santana - BA\nCaruaru - PE"} onChange={(e) => setTextos({ ...textos, cidades: e.target.value })} />
          </Campo>
          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="Prioridade Anota AI (0-100)">
              <Input {...num("peso_anota_ai")} />
            </Campo>
            <Campo rotulo="Prioridade sem sistema (0-100)">
              <Input {...num("peso_sem_sistema")} />
            </Campo>
            <Campo rotulo="Pontuação mínima p/ fila">
              <Input {...num("pontuacao_minima")} />
            </Campo>
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="font-semibold">Limites de gasto e de uso</h3>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Gasto máximo por dia (US$)">
              <Input step="0.5" {...num("limite_gasto_diario_usd")} />
            </Campo>
            <Campo rotulo="Gasto máximo por mês (US$)">
              <Input step="1" {...num("limite_gasto_mensal_usd")} />
            </Campo>
            <Campo rotulo="Buscas na web por dia">
              <Input {...num("limite_buscas_web_dia")} />
            </Campo>
            <Campo rotulo="Consultas Google Places por dia">
              <Input {...num("limite_places_dia")} />
            </Campo>
            <Campo rotulo="Respostas da IA por dia">
              <Input {...num("limite_respostas_ia_dia")} />
            </Campo>
            <Campo rotulo="Cotação do dólar (para exibir em R$)">
              <Input step="0.01" {...num("cotacao_dolar")} />
            </Campo>
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <h3 className="font-semibold">Oferta comercial (a IA só fala o que estiver aqui)</h3>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Preço mensal (R$)">
              <Input step="0.01" {...num("preco_mensal")} />
            </Campo>
            <Campo rotulo="Dias de teste grátis (0 = não oferece)">
              <Input {...num("teste_gratis_dias")} />
            </Campo>
            <Campo rotulo="Robô de WhatsApp com IA">
              <Select value={cfg.bot_whatsapp} onValueChange={(v) => set("bot_whatsapp", v as Config["bot_whatsapp"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incluso">Incluso no preço</SelectItem>
                  <SelectItem value="nao_incluso">Não incluso (humano negocia)</SelectItem>
                  <SelectItem value="consultar">A confirmar (humano responde)</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Seu nome nas mensagens (opcional)">
              <Input value={cfg.nome_remetente} onChange={(e) => set("nome_remetente", e.target.value)} />
            </Campo>
          </div>
          <Campo rotulo="Link do site enviado nas conversas (nunca o de cadastro)">
            <Input value={cfg.link_site} onChange={(e) => set("link_site", e.target.value)} />
          </Campo>
          <Campo rotulo="Link de cardápio de demonstração (opcional)">
            <Input value={cfg.link_demo} placeholder="https://easyfoodhub.com.br/sua-loja-demo/cardapio" onChange={(e) => set("link_demo", e.target.value)} />
          </Campo>
        </Card>
      </div>

      <WhatsappComercial cfg={cfg} set={set} />

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={salvando}>
          <Save className="h-4 w-4 mr-1" /> {salvando ? "Salvando..." : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      {children}
    </div>
  );
}

function WhatsappComercial({ cfg, set }: { cfg: Config; set: <K extends keyof Config>(k: K, v: Config[K]) => void }) {
  const [status, setStatus] = useState<{ estado: string; telefone: string | null } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [busy, setBusy] = useState(false);

  const verificar = useCallback(async () => {
    const r = await chamarAgente<{ estado?: string; telefone?: string | null }>({ acao: "whatsapp_status" });
    if (!r.ok) return setStatus({ estado: `erro: ${r.error}`, telefone: null });
    setStatus({ estado: r.estado || "?", telefone: r.telefone ?? null });
    if (r.estado === "open") {
      setQr(null);
      setCodigo(null);
    }
  }, []);

  useEffect(() => {
    void verificar();
  }, [verificar]);

  useEffect(() => {
    if (!qr && !codigo) return;
    const t = setInterval(() => void verificar(), 5000);
    return () => clearInterval(t);
  }, [qr, codigo, verificar]);

  const conectar = async () => {
    setBusy(true);
    const r = await chamarAgente<{ qr?: string | null; conectado?: boolean }>({ acao: "whatsapp_conectar" });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Erro ao conectar");
    if (r.conectado) toast.success("WhatsApp comercial conectado");
    setCodigo(null);
    setQr(r.qr || null);
    void verificar();
  };

  const conectarPorNumero = async () => {
    if (numero.replace(/\D/g, "").length < 10) return toast.error("Digite o número comercial com DDD.");
    setBusy(true);
    const r = await chamarAgente<{ codigo?: string; conectado?: boolean }>({ acao: "whatsapp_conectar_numero", numero });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Erro ao gerar o código");
    if (r.conectado) {
      toast.success("WhatsApp comercial já está conectado");
      return void verificar();
    }
    setQr(null);
    setCodigo(r.codigo || null);
  };

  const desconectar = async () => {
    setBusy(true);
    const r = await chamarAgente({ acao: "whatsapp_desconectar" });
    setBusy(false);
    if (!r.ok) return toast.error(r.error || "Erro");
    toast.success("Desconectado");
    void verificar();
  };

  const conectado = status?.estado === "open";

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">WhatsApp comercial (prospecção)</h3>
          <p className="text-sm text-muted-foreground">
            Use um número só para a prospecção, separado do WhatsApp das lojas. É por ele que saem os contatos e que a IA responde.
          </p>
        </div>
        <span className={cn("text-sm font-medium", conectado ? "text-emerald-600" : "text-muted-foreground")}>
          {status ? (conectado ? `Conectado${status.telefone ? ` (${status.telefone})` : ""}` : ESTADO_WHATSAPP[status.estado] ?? status.estado) : "Verificando..."}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Campo rotulo="Nome da instância na Evolution">
          <Input value={cfg.evolution_instance} onChange={(e) => set("evolution_instance", e.target.value)} />
        </Campo>
        <Campo rotulo="Seu celular para alertas (opcional)">
          <Input value={cfg.telefone_alertas} placeholder="(75) 99999-9999" onChange={(e) => set("telefone_alertas", e.target.value)} />
        </Campo>
        <div className="flex items-center justify-between gap-2 pt-5">
          <Label>IA responde as conversas</Label>
          <Switch checked={cfg.responder_automatico} onCheckedChange={(v) => set("responder_automatico", v)} />
        </div>
      </div>

      {!conectado && (
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Conectar pelo número (sem QR Code)">
            <Input value={numero} placeholder="Número comercial, ex.: (75) 99999-9999" onChange={(e) => setNumero(e.target.value)} className="w-72" />
          </Campo>
          <Button variant="secondary" onClick={conectarPorNumero} disabled={busy}>
            <Smartphone className="h-4 w-4 mr-1" /> Gerar código
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={conectar} disabled={busy}>
          <QrCode className="h-4 w-4 mr-1" /> {conectado ? "Reconfigurar webhook" : "Conectar (QR Code)"}
        </Button>
        {conectado && (
          <Button variant="outline" onClick={desconectar} disabled={busy}>
            <Unplug className="h-4 w-4 mr-1" /> Desconectar
          </Button>
        )}
      </div>
      {codigo && (
        <div className="flex flex-col items-center gap-2 rounded-md border p-4">
          <p className="font-mono text-3xl font-bold tracking-[0.3em]">{codigo.length === 8 ? `${codigo.slice(0, 4)}-${codigo.slice(4)}` : codigo}</p>
          <p className="max-w-md text-center text-sm text-muted-foreground">
            No celular, abra o <b>WhatsApp Business</b> do número comercial → ⋮ → <b>Aparelhos conectados</b> → <b>Conectar aparelho</b> →{" "}
            <b>Conectar com número de telefone</b> e digite este código. Ele vale por poucos minutos; se expirar, gere outro.
          </p>
        </div>
      )}
      {qr && (
        <div className="flex flex-col items-center gap-2">
          <img src={qr} alt="QR Code do WhatsApp" className="h-56 w-56 rounded border bg-white p-2" />
          <p className="text-sm text-muted-foreground">No celular do número comercial: WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Salve a configuração antes de conectar se trocou o nome da instância.</p>
    </Card>
  );
}
