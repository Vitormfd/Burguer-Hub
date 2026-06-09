import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { playPreset, tryUnlockAudio } from "@/lib/sound";
import {
  Settings,
  Plus,
  Trash2,
  ExternalLink,
  Upload,
  X,
  Eye,
  EyeOff,
  MessageSquare,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Send,
  List,
  Printer,
} from "lucide-react";
import { type PrintConfig, readPrintConfig, savePrintConfig, printCashSummary } from "@/lib/print";
import type { BairroTaxa, Configuracao, HorarioFuncionamentoDia, WhatsappLog, TipoMensagemWhatsapp } from "@/types/db";
import { brl } from "@/lib/format";
import { configureWhatsappWebhook } from "@/lib/whatsapp";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

// --- helpers -----------------------------------------------------------------

const VAR_CHIPS: { label: string; value: string }[] = [
  { label: "{{nome}}", value: "{{nome}}" },
  { label: "{{pedido_id}}", value: "{{pedido_id}}" },
  { label: "{{itens}}", value: "{{itens}}" },
  { label: "{{resumo}}", value: "{{resumo}}" },
  { label: "{{total}}", value: "{{total}}" },
  { label: "{{tempo_estimado}}", value: "{{tempo_estimado}}" },
];

const buildCardapioUrl = (cfg: Configuracao): string => {
  const base = (cfg.site_url || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const ref = (cfg.referencia || "").trim().replace(/^\/+|\/+$/g, "");
  return ref ? `${base}/${ref}/cardapio` : `${base}/cardapio`;
};

const MENSAGENS_CONFIG: {
  campo: keyof Configuracao;
  campoAtivo: keyof Configuracao;
  label: string;
  tipo: TipoMensagemWhatsapp;
}[] = [
  { campo: "whatsapp_msg_confirmado", campoAtivo: "whatsapp_msg_confirmado_ativo", label: "Pedido confirmado", tipo: "confirmado" },
  { campo: "whatsapp_msg_em_preparo", campoAtivo: "whatsapp_msg_em_preparo_ativo", label: "Em preparo", tipo: "em_preparo" },
  { campo: "whatsapp_msg_saiu_entrega", campoAtivo: "whatsapp_msg_saiu_entrega_ativo", label: "Saiu para entrega", tipo: "saiu_entrega" },
  { campo: "whatsapp_msg_entregue", campoAtivo: "whatsapp_msg_entregue_ativo", label: "Pedido entregue", tipo: "entregue" },
  { campo: "whatsapp_msg_retirada_pronto", campoAtivo: "whatsapp_msg_retirada_pronto_ativo", label: "Pronto para retirada", tipo: "retirada_pronto" },
];

const LOG_TIPO_LABEL: Record<TipoMensagemWhatsapp, string> = {
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  saiu_entrega: "Saiu p/ entrega",
  entregue: "Entregue",
  retirada_pronto: "Pronto p/ retirada",
};

const DIAS_SEMANA_LABEL = ["Domingo", "Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado"];

const normalizeTimeHHMMSS = (value?: string | null) => {
  if (!value) return "00:00:00";
  const base = value.slice(0, 5);
  return `${base}:00`;
};

const normalizeWeeklySchedule = (cfg: Configuracao): HorarioFuncionamentoDia[] => {
  const fallbackAbertura = normalizeTimeHHMMSS(cfg.hora_abertura);
  const fallbackFechamento = normalizeTimeHHMMSS(cfg.hora_fechamento);
  const byDay = new Map<number, HorarioFuncionamentoDia>();

  if (Array.isArray(cfg.horario_funcionamento)) {
    for (const raw of cfg.horario_funcionamento) {
      if (!raw || typeof raw !== "object") continue;
      const dia = Number((raw as { dia?: unknown }).dia);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6) continue;
      byDay.set(dia, {
        dia,
        ativo: Boolean((raw as { ativo?: unknown }).ativo),
        abertura: normalizeTimeHHMMSS((raw as { abertura?: string }).abertura) || fallbackAbertura,
        fechamento: normalizeTimeHHMMSS((raw as { fechamento?: string }).fechamento) || fallbackFechamento,
      });
    }
  }

  return [0, 1, 2, 3, 4, 5, 6].map((dia) => {
    return byDay.get(dia) ?? {
      dia,
      ativo: true,
      abertura: fallbackAbertura,
      fechamento: fallbackFechamento,
    };
  });
};

// --- PasswordInput -----------------------------------------------------------

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// --- TestMsgModal ------------------------------------------------------------

function TestMsgModal({
  open,
  tipo,
  configuracaoId,
  onClose,
}: {
  open: boolean;
  tipo: TipoMensagemWhatsapp | null;
  configuracaoId: string | null;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const digits = phone.replace(/\D/g, "");
    if (!configuracaoId) return toast.error("Configuração inválida para envio de teste");
    if (digits.length !== 11 && !(digits.startsWith("55") && digits.length === 13)) {
      return toast.error("Informe um telefone com DDD e 9 dígitos");
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: {
          configuracao_id: configuracaoId,
          pedido_id: "00000000-0000-0000-0000-000000000000",
          tipo_mensagem: tipo,
          telefone: digits,
          dados_pedido: {
            nome: "Cliente Teste",
            itens: "1x Hamburguer Artesanal",
            total: "R$ 45,00",
            tempo_estimado: "30-45 min",
          },
        },
      });
      if (error) {
        toast.error(error.message || "Erro ao enviar");
      } else if (data?.skipped) {
        const reasonMap: Record<string, string> = {
          zapi_inactive: "WhatsApp está desativado. Ative e salve antes do teste.",
          credentials_missing: "Credenciais Z-API ausentes na configuração.",
          invalid_phone: "Telefone inválido para envio.",
          config_not_found: "Nenhuma configuração ativa com credenciais foi encontrada.",
          message_inactive: "Esta mensagem está desativada. Ative o envio automático para testar no fluxo real.",
        };
        toast.error(reasonMap[data.reason] || "Envio não realizado");
      } else if (data?.status === "erro") {
        toast.error(data?.error || "Falha no envio via Z-API");
      } else {
        toast.success("Mensagem de teste enviada!");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setBusy(false);
      onClose();
      setPhone("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar mensagem de teste</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Numero de destino</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
            />
            <p className="text-xs text-muted-foreground">
              Sera formatado automaticamente com codigo do pais 55.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={send} disabled={busy}>
              <Send className="w-4 h-4 mr-1" />
              {busy ? "Enviando..." : "Enviar teste"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Component ----------------------------------------------------------

export default function Configuracoes() {
  const [cfg, setCfg] = useState<Configuracao | null>(null);
  const [bairros, setBairros] = useState<BairroTaxa[]>([]);
  const [novoBairro, setNovoBairro] = useState("");
  const [novaTaxa, setNovaTaxa] = useState("");
  const [novaImagemCarrossel, setNovaImagemCarrossel] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyWpp, setBusyWpp] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "banner" | "carrossel" | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const carrosselRef = useRef<HTMLInputElement>(null);

  // WhatsApp state
  const [zapiStatus, setZapiStatus] = useState<"idle" | "ok" | "error">("idle");
  const [zapiErrMsg, setZapiErrMsg] = useState("");
  const [zapiPhone, setZapiPhone] = useState("");
  const [configuringWebhook, setConfiguringWebhook] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [testingConn, setTestingConn] = useState(false);
  const [testMsgTipo, setTestMsgTipo] = useState<TipoMensagemWhatsapp | null>(null);

  // Logs state
  const [logs, setLogs] = useState<WhatsappLog[]>([]);
  const [logsFiltro, setLogsFiltro] = useState<"todos" | "enviado" | "erro">("todos");
  const [logsLoading, setLogsLoading] = useState(false);
  const [reenvBusy, setReenvBusy] = useState<string | null>(null);

  // Print config state
  const [printCfg, setPrintCfg] = useState<PrintConfig>(readPrintConfig);
  const [printSaved, setPrintSaved] = useState(false);
  const [autoPrintCash, setAutoPrintCash] = useState<boolean>(true);

  // Sound settings (localStorage)
  const [soundPreset, setSoundPreset] = useState<"bell" | "beep" | "chime" | "gong" | "tritone" | "alarm" | "dingdong" | "metallic">("bell");
  const [soundVolume, setSoundVolume] = useState<number>(1);

  useEffect(() => {
    try {
      const p = localStorage.getItem("bh_sound_preset") || "bell";
      const v = Number(localStorage.getItem("bh_sound_volume") ?? "1");
      const allowed = ["bell", "beep", "chime", "gong", "tritone", "alarm", "dingdong", "metallic"];
      setSoundPreset((allowed.includes(p) ? (p as any) : "bell"));
      setSoundVolume(Number.isFinite(v) ? Math.max(0.05, Math.min(3, v)) : 1);
    } catch {}
    try {
      const v = localStorage.getItem("bh_auto_print_cash_on_close");
      setAutoPrintCash(v === null ? true : v === "1");
    } catch {}
  }, []);

  const saveSoundSettings = (preset: "bell" | "beep" | "chime", volume: number) => {
    try {
      localStorage.setItem("bh_sound_preset", preset);
      localStorage.setItem("bh_sound_volume", String(volume));
      setSoundPreset(preset);
      setSoundVolume(volume);
      toast.success("Preferência de som salva");
    } catch {
      toast.error("Não foi possível salvar a preferência de som");
    }
  };

  const savePrint = () => {
    savePrintConfig(printCfg);
    setPrintSaved(true);
    setTimeout(() => setPrintSaved(false), 2000);
  };

  const saveAutoPrintSetting = (val: boolean) => {
    try {
      localStorage.setItem("bh_auto_print_cash_on_close", val ? "1" : "0");
      setAutoPrintCash(val);
      toast.success("Preferência de impressão salva");
    } catch {
      toast.error("Não foi possível salvar a preferência");
    }
  };

  const updateScheduleDay = (day: number, patch: Partial<HorarioFuncionamentoDia>) => {
    if (!cfg) return;
    const base = normalizeWeeklySchedule(cfg);
    const next = base.map((item) => (item.dia === day ? { ...item, ...patch } : item));
    setCfg({ ...cfg, horario_funcionamento: next });
  };

  // loaders

  const load = async () => {
    const [{ data: c }, { data: b }] = await Promise.all([
      supabase.from("configuracoes").select("*").limit(1).maybeSingle(),
      supabase.from("bairros_taxas").select("*").order("nome"),
    ]);
    if (c) {
      const cfgData = c as unknown as Configuracao;
      setCfg({
        ...cfgData,
        carrossel_imagens: cfgData.carrossel_imagens || [],
        horario_funcionamento: normalizeWeeklySchedule(cfgData),
      });
    }
    setBairros((b || []) as BairroTaxa[]);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    let q = supabase
      .from("whatsapp_logs" as any)
      .select("*")
      .order("enviado_em", { ascending: false })
      .limit(200);
    if (logsFiltro !== "todos") {
      q = (q as any).eq("status", logsFiltro);
    }
    const { data, error } = await q;
    setLogsLoading(false);
    if (error) return toast.error(error.message);
    setLogs((data || []) as unknown as WhatsappLog[]);
  };

  useEffect(() => { load(); }, []);

  // Reload logs whenever filter changes (only if the tab has been opened at least once)
  const [logsOpened, setLogsOpened] = useState(false);
  useEffect(() => { if (logsOpened) loadLogs(); }, [logsFiltro]); // eslint-disable-line react-hooks/exhaustive-deps

  // file uploads

  const uploadFile = async (kind: "logo" | "banner", file: File) => {
    if (!cfg) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Arquivo deve ter ate 5MB");
    setUploading(kind);
    const ext = file.name.split(".").pop() || "png";
    const path = `${kind}-${cfg.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("loja").upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { setUploading(null); return toast.error(upErr.message); }
    const { data } = supabase.storage.from("loja").getPublicUrl(path);
    const url = data.publicUrl;
    const { error: saveErr } = await supabase
      .from("configuracoes")
      .update({ [kind === "logo" ? "logo_url" : "banner_url"]: url } as any)
      .eq("id", cfg.id);
    if (saveErr) { setUploading(null); return toast.error(saveErr.message); }
    setCfg({ ...cfg, [kind === "logo" ? "logo_url" : "banner_url"]: url });
    setUploading(null);
    toast.success(`${kind === "logo" ? "Logo" : "Banner"} salvo`);
  };

  const uploadCarouselImage = async (file: File) => {
    if (!cfg) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Arquivo deve ter ate 5MB");
    setUploading("carrossel");
    const ext = file.name.split(".").pop() || "png";
    const path = `carrossel-${cfg.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("loja").upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { setUploading(null); return toast.error(upErr.message); }
    const { data } = supabase.storage.from("loja").getPublicUrl(path);
    const url = data.publicUrl;
    setCfg({ ...cfg, carrossel_imagens: [...(cfg.carrossel_imagens || []), url] });
    setUploading(null);
    toast.success("Imagem adicionada ao carrossel");
  };

  const addCarouselByUrl = () => {
    if (!cfg) return;
    const url = novaImagemCarrossel.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return toast.error("Informe uma URL valida iniciando com http:// ou https://");
    const atuais = cfg.carrossel_imagens || [];
    if (atuais.includes(url)) return toast.error("Essa imagem ja esta no carrossel");
    setCfg({ ...cfg, carrossel_imagens: [...atuais, url] });
    setNovaImagemCarrossel("");
  };

  const removeCarouselImage = (url: string) => {
    if (!cfg) return;
    setCfg({ ...cfg, carrossel_imagens: (cfg.carrossel_imagens || []).filter((item) => item !== url) });
  };

  // save geral

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    const { error } = await supabase
      .from("configuracoes")
      .update({
        nome_loja: cfg.nome_loja,
        referencia: cfg.referencia,
        logo_url: cfg.logo_url,
        banner_url: cfg.banner_url,
        cor_primaria: cfg.cor_primaria,
        ativo: cfg.ativo,
        hora_abertura: cfg.hora_abertura,
        hora_fechamento: cfg.hora_fechamento,
        seo_titulo: cfg.seo_titulo,
        seo_descricao: cfg.seo_descricao,
        tempo_entrega_min: cfg.tempo_entrega_min ?? "30-45 min",
        retirada_ativa: cfg.retirada_ativa ?? false,
        tempo_estimado_retirada: Number(cfg.tempo_estimado_retirada ?? 25),
        endereco_estabelecimento: cfg.endereco_estabelecimento ?? null,
        carrossel_imagens: cfg.carrossel_imagens || [],
        horario_funcionamento: normalizeWeeklySchedule(cfg) as any,
      })
      .eq("id", cfg.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Configuracoes salvas");
  };

  // save whatsapp

  const saveWhatsapp = async () => {
    if (!cfg) return;
    setBusyWpp(true);
    const { error } = await supabase
      .from("configuracoes")
      .update({
        zapi_instance_id: cfg.zapi_instance_id ?? null,
        zapi_token: cfg.zapi_token ?? null,
        zapi_client_token: cfg.zapi_client_token ?? null,
        zapi_ativo: cfg.zapi_ativo ?? false,
        whatsapp_pedido_ativo: cfg.whatsapp_pedido_ativo ?? false,
        site_url: cfg.site_url?.trim() || window.location.origin || null,
        whatsapp_msg_boas_vindas: cfg.whatsapp_msg_boas_vindas,
        whatsapp_msg_confirmado: cfg.whatsapp_msg_confirmado,
        whatsapp_msg_em_preparo: cfg.whatsapp_msg_em_preparo,
        whatsapp_msg_saiu_entrega: cfg.whatsapp_msg_saiu_entrega,
        whatsapp_msg_entregue: cfg.whatsapp_msg_entregue,
        whatsapp_msg_retirada_pronto: cfg.whatsapp_msg_retirada_pronto,
        whatsapp_msg_confirmado_ativo: cfg.whatsapp_msg_confirmado_ativo ?? true,
        whatsapp_msg_em_preparo_ativo: cfg.whatsapp_msg_em_preparo_ativo ?? true,
        whatsapp_msg_saiu_entrega_ativo: cfg.whatsapp_msg_saiu_entrega_ativo ?? true,
        whatsapp_msg_entregue_ativo: cfg.whatsapp_msg_entregue_ativo ?? true,
        whatsapp_msg_retirada_pronto_ativo: cfg.whatsapp_msg_retirada_pronto_ativo ?? true,
      } as any)
      .eq("id", cfg.id);
    setBusyWpp(false);
    if (error) toast.error(error.message);
    else toast.success("Configuracoes WhatsApp salvas");
  };

  const webhookEndpoint = import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-webhook`
    : "";

  const configureWebhook = async () => {
    if (!cfg || !hasCredentials) {
      return toast.error("Preencha e salve as credenciais Z-API primeiro");
    }
    setConfiguringWebhook(true);
    try {
      const { error: saveErr } = await supabase
        .from("configuracoes")
        .update({
          zapi_instance_id: cfg.zapi_instance_id ?? null,
          zapi_token: cfg.zapi_token ?? null,
          zapi_client_token: cfg.zapi_client_token ?? null,
          zapi_ativo: cfg.zapi_ativo ?? false,
          whatsapp_pedido_ativo: cfg.whatsapp_pedido_ativo ?? false,
        } as any)
        .eq("id", cfg.id);

      if (saveErr) {
        toast.error(saveErr.message);
        return;
      }

      const result = await configureWhatsappWebhook(cfg.id);
      if (result.ok) {
        setWebhookUrl(result.webhook_url || webhookEndpoint);
        toast.success("Webhook configurado na Z-API com sucesso!");
      } else {
        toast.error(result.error || "Falha ao configurar webhook");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao configurar webhook");
    } finally {
      setConfiguringWebhook(false);
    }
  };

  // test Z-API connection

  const testConnection = async () => {
    if (!cfg || !hasCredentials) {
      return toast.error("Preencha Instance ID, Token e Client Token primeiro");
    }
    setTestingConn(true);
    setZapiStatus("idle");
    setZapiErrMsg("");
    setZapiPhone("");
    try {
      // Persist the latest credentials before invoking the backend test.
      const { error: saveErr } = await supabase
        .from("configuracoes")
        .update({
          zapi_instance_id: cfg.zapi_instance_id ?? null,
          zapi_token: cfg.zapi_token ?? null,
          zapi_client_token: cfg.zapi_client_token ?? null,
          zapi_ativo: cfg.zapi_ativo ?? false,
        } as any)
        .eq("id", cfg.id);

      if (saveErr) {
        setZapiStatus("error");
        setZapiErrMsg(saveErr.message || "Falha ao salvar credenciais antes do teste");
        return;
      }

      const { data, error } = await supabase.functions.invoke("send-whatsapp", {
        body: { action: "test_connection", configuracao_id: cfg.id },
      });

      if (error) {
        setZapiStatus("error");
        setZapiErrMsg(error.message || "Falha ao testar conexão");
      } else if (data?.ok) {
        setZapiStatus("ok");
        setZapiPhone(data.phone || "");
      } else {
        const reasonMap: Record<string, string> = {
          zapi_inactive: "WhatsApp desativado nas configurações salvas",
          credentials_missing: "Credenciais Z-API ausentes nas configurações salvas",
          invalid_phone: "Telefone inválido",
        };
        setZapiStatus("error");
        setZapiErrMsg(data?.error || reasonMap[data?.reason] || "Falha ao testar conexão");
      }
    } catch (err) {
      setZapiStatus("error");
      setZapiErrMsg(err instanceof Error ? err.message : "Erro de conexao");
    } finally {
      setTestingConn(false);
    }
  };

  // bairros

  const addBairro = async () => {
    const taxa = Number(novaTaxa.replace(",", ".")) || 0;
    if (!novoBairro.trim()) return;
    const { error } = await supabase.from("bairros_taxas").insert({ nome: novoBairro.trim(), taxa });
    if (error) return toast.error(error.message);
    setNovoBairro(""); setNovaTaxa("");
    load();
  };

  const removeBairro = async (id: string) => {
    const { error } = await supabase.from("bairros_taxas").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  };

  // reenviar log

  const reenviarLog = async (log: WhatsappLog) => {
    setReenvBusy(log.id);
    try {
      const { error } = await supabase.functions.invoke("send-whatsapp", {
        body: {
          configuracao_id: cfg.id,
          pedido_id: log.pedido_id ?? "00000000-0000-0000-0000-000000000000",
          tipo_mensagem: log.tipo_mensagem,
          telefone: log.telefone,
          dados_pedido: {},
        },
      });
      if (error) toast.error(error.message || "Erro ao reenviar");
      else { toast.success("Mensagem reenviada!"); loadLogs(); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reenviar");
    } finally {
      setReenvBusy(null);
    }
  };

  const hasCredentials = !!(cfg?.zapi_instance_id && cfg?.zapi_token && cfg?.zapi_client_token);

  if (!cfg) return <div className="text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-5xl flex items-center gap-3">
            <Settings className="w-8 h-8 text-primary" /> Configuracoes
          </h1>
          <p className="text-muted-foreground mt-1">Identidade, horario, bairros e integracoes</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/cardapio" target="_blank"><ExternalLink className="w-4 h-4 mr-1" /> Ver pagina publica</Link>
        </Button>
      </div>

      <Tabs defaultValue="geral">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="geral"><Settings className="w-4 h-4 mr-1.5" />Geral</TabsTrigger>
          <TabsTrigger value="impressao"><Printer className="w-4 h-4 mr-1.5" />Impressão</TabsTrigger>
          <TabsTrigger value="whatsapp"><MessageSquare className="w-4 h-4 mr-1.5" />WhatsApp</TabsTrigger>
          <TabsTrigger value="logs" onClick={() => { setLogsOpened(true); loadLogs(); }}><List className="w-4 h-4 mr-1.5" />Logs WhatsApp</TabsTrigger>
        </TabsList>

        {/* TAB: GERAL */}
        <TabsContent value="geral" className="space-y-6">
          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl">Notificações sonoras</h2>
            <div className="grid md:grid-cols-3 gap-4 items-end">
              <div className="space-y-2 md:col-span-2">
                <Label>Timbre</Label>
                <select value={soundPreset} onChange={(e) => { const v = e.target.value as any; saveSoundSettings(v, soundVolume); }} className="w-full rounded-md border p-2">
                  <option value="bell">Sino (balcão)</option>
                  <option value="chime">Sinos curtos (melódico)</option>
                  <option value="beep">Bip curto</option>
                  <option value="gong">Gongo (grave longo)</option>
                  <option value="tritone">Trítono (3-notas)</option>
                  <option value="alarm">Alarme curto</option>
                  <option value="dingdong">Ding-dong</option>
                  <option value="metallic">Ping metálico</option>
                  <option value="marimba">Marimba (percussivo)</option>
                  <option value="glass">Sino de vidro (agudo)</option>
                  <option value="cash">Caixa registradora (ka-ching)</option>
                  <option value="cowbell">Cowbell</option>
                  <option value="retro">Pulse retrô</option>
                  <option value="siren">Sirene curta</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Volume</Label>
                <div className="flex items-center gap-2">
                  <input type="range" min={0.05} max={3} step={0.05} value={soundVolume} onChange={(e) => { const v = Number(e.target.value); setSoundVolume(v); }} />
                  <div className="w-16 text-right">{Math.round(soundVolume * 100)}%</div>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button variant="outline" onClick={() => { void tryUnlockAudio().then(() => playPreset(soundPreset, soundVolume)); }}>Testar som</Button>
                  <Button onClick={() => saveSoundSettings(soundPreset, soundVolume)}>Salvar preferência</Button>
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl">Identidade da loja</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome da loja</Label>
                <Input value={cfg.nome_loja} maxLength={80} onChange={(e) => setCfg({ ...cfg, nome_loja: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Slug/Referencia (URL publica)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">dominio.com/</span>
                  <Input
                    value={cfg.referencia || ""}
                    onChange={(e) => setCfg({ ...cfg, referencia: e.target.value.toLowerCase().replace(/[^a-z0-9\-]/g, "") || null })}
                    placeholder="seu-restaurante"
                    maxLength={50}
                  />
                  <span className="text-sm text-muted-foreground">/cardapio</span>
                </div>
                <p className="text-xs text-muted-foreground">Use apenas letras minusculas, numeros e hifen.</p>
              </div>
              <div className="space-y-2">
                <Label>Cor principal</Label>
                <div className="flex gap-2">
                  <Input type="color" value={cfg.cor_primaria} onChange={(e) => setCfg({ ...cfg, cor_primaria: e.target.value })} className="w-20 h-10 p-1" />
                  <Input value={cfg.cor_primaria} onChange={(e) => setCfg({ ...cfg, cor_primaria: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2 md:col-span-2 grid md:grid-cols-2 gap-4">
                {(["logo", "banner"] as const).map((kind) => {
                  const url = kind === "logo" ? cfg.logo_url : cfg.banner_url;
                  const ref = kind === "logo" ? logoRef : bannerRef;
                  const setUrl = (v: string | null) => setCfg({ ...cfg, [kind === "logo" ? "logo_url" : "banner_url"]: v });
                  return (
                    <div key={kind} className="space-y-2">
                      <Label>{kind === "logo" ? "Logo" : "Banner"}</Label>
                      {url && (
                        <div className="relative w-full rounded-md overflow-hidden border bg-muted" style={{ aspectRatio: kind === "logo" ? "1 / 1" : "16 / 6", maxHeight: kind === "logo" ? 120 : 160 }}>
                          <img src={url} alt={kind} className="w-full h-full object-cover" />
                          <Button type="button" size="icon" variant="destructive" className="absolute top-1 right-1 h-7 w-7" onClick={() => setUrl(null)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(kind, f); e.target.value = ""; }} />
                        <Button type="button" variant="outline" onClick={() => ref.current?.click()} disabled={uploading === kind}>
                          <Upload className="w-4 h-4 mr-1" /> {uploading === kind ? "Enviando..." : "Enviar arquivo"}
                        </Button>
                      </div>
                      <Input value={url ?? ""} onChange={(e) => setUrl(e.target.value || null)} placeholder="ou cole uma URL https://..." />
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 md:col-span-2">
                <Label>Imagens do carrossel do topo</Label>
                <p className="text-xs text-muted-foreground">Essas imagens sao exibidas no carrossel grande da pagina publica.</p>
                {(cfg.carrossel_imagens || []).length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma imagem adicionada no carrossel ainda.</div>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(cfg.carrossel_imagens || []).map((url, idx) => (
                      <div key={`${url}-${idx}`} className="relative rounded-md overflow-hidden border bg-muted" style={{ aspectRatio: "16 / 8.8" }}>
                        <img src={url} alt={`Carrossel ${idx + 1}`} className="w-full h-full object-cover" />
                        <Button type="button" size="icon" variant="destructive" className="absolute top-1 right-1 h-7 w-7" onClick={() => removeCarouselImage(url)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <input ref={carrosselRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCarouselImage(f); e.target.value = ""; }} />
                  <Button type="button" variant="outline" onClick={() => carrosselRef.current?.click()} disabled={uploading === "carrossel"}>
                    <Upload className="w-4 h-4 mr-1" /> {uploading === "carrossel" ? "Enviando..." : "Adicionar imagem"}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input value={novaImagemCarrossel} onChange={(e) => setNovaImagemCarrossel(e.target.value)} placeholder="ou cole uma URL da imagem https://..." />
                  <Button type="button" variant="secondary" onClick={addCarouselByUrl}>Adicionar URL</Button>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl">Funcionamento</h2>
            <div className="grid md:grid-cols-3 gap-4 items-end">
              <div className="space-y-2">
                <Label>Pagina publica ativa</Label>
                <div className="flex items-center gap-2 h-10">
                  <Switch checked={cfg.ativo} onCheckedChange={(v) => setCfg({ ...cfg, ativo: v })} />
                  <span className="text-sm text-muted-foreground">{cfg.ativo ? "Aceitando pedidos" : "Fechada"}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Abertura</Label>
                <Input type="time" value={cfg.hora_abertura.slice(0, 5)} onChange={(e) => setCfg({ ...cfg, hora_abertura: e.target.value + ":00" })} />
              </div>
              <div className="space-y-2">
                <Label>Fechamento</Label>
                <Input type="time" value={cfg.hora_fechamento.slice(0, 5)} onChange={(e) => setCfg({ ...cfg, hora_fechamento: e.target.value + ":00" })} />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Horario por dia da semana</Label>
              <div className="space-y-2">
                {normalizeWeeklySchedule(cfg).map((dia) => (
                  <div key={dia.dia} className="grid grid-cols-[110px_auto_1fr_1fr] items-center gap-2 rounded-md border p-2">
                    <span className="text-sm font-medium">{DIAS_SEMANA_LABEL[dia.dia]}</span>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={dia.ativo}
                        onCheckedChange={(v) => updateScheduleDay(dia.dia, { ativo: v })}
                      />
                      <span className="text-xs text-muted-foreground">{dia.ativo ? "Ativo" : "Fechado"}</span>
                    </div>
                    <Input
                      type="time"
                      value={dia.abertura.slice(0, 5)}
                      disabled={!dia.ativo}
                      onChange={(e) => updateScheduleDay(dia.dia, { abertura: e.target.value + ":00" })}
                    />
                    <Input
                      type="time"
                      value={dia.fechamento.slice(0, 5)}
                      disabled={!dia.ativo}
                      onChange={(e) => updateScheduleDay(dia.dia, { fechamento: e.target.value + ":00" })}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tempo estimado de entrega</Label>
              <Input value={cfg.tempo_entrega_min ?? ""} onChange={(e) => setCfg({ ...cfg, tempo_entrega_min: e.target.value })} maxLength={30} placeholder="Ex: 30-45 min" />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ativar opcao de retirada no cardapio</Label>
                <div className="flex items-center gap-2 h-10">
                  <Switch checked={!!cfg.retirada_ativa} onCheckedChange={(v) => setCfg({ ...cfg, retirada_ativa: v })} />
                  <span className="text-sm text-muted-foreground">{cfg.retirada_ativa ? "Retirada habilitada" : "Retirada desativada"}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tempo estimado de preparo para retirada (minutos)</Label>
                <Input type="number" min={1} step="1" value={Number(cfg.tempo_estimado_retirada ?? 25)} onChange={(e) => setCfg({ ...cfg, tempo_estimado_retirada: Math.max(Number(e.target.value || 25), 1) })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Endereco do estabelecimento (exibido na opcao de retirada)</Label>
              <Input value={cfg.endereco_estabelecimento ?? ""} onChange={(e) => setCfg({ ...cfg, endereco_estabelecimento: e.target.value || null })} placeholder="Ex: Rua das Flores, 123 - Centro" maxLength={200} />
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl">SEO</h2>
            <div className="space-y-2">
              <Label>Titulo da pagina</Label>
              <Input value={cfg.seo_titulo} maxLength={60} onChange={(e) => setCfg({ ...cfg, seo_titulo: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Meta description</Label>
              <Textarea rows={2} value={cfg.seo_descricao} maxLength={160} onChange={(e) => setCfg({ ...cfg, seo_descricao: e.target.value })} />
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl">Bairros e taxas de entrega</h2>
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-2">
                <Label>Bairro</Label>
                <Input value={novoBairro} onChange={(e) => setNovoBairro(e.target.value)} placeholder="Ex: Centro" />
              </div>
              <div className="w-32 space-y-2">
                <Label>Taxa (R$)</Label>
                <Input type="number" min={0} step="0.50" value={novaTaxa} onChange={(e) => setNovaTaxa(e.target.value)} />
              </div>
              <Button onClick={addBairro}><Plus className="w-4 h-4 mr-1" /> Adicionar</Button>
            </div>
            <div className="divide-y border rounded-lg">
              {bairros.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">Nenhum bairro cadastrado</div>
              ) : bairros.map((b) => (
                <div key={b.id} className="flex items-center justify-between px-4 py-2">
                  <span className="font-medium">{b.nome}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-primary font-semibold">{brl(Number(b.taxa))}</span>
                    <Button variant="ghost" size="icon" onClick={() => removeBairro(b.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="flex justify-end">
            <Button size="lg" onClick={save} disabled={busy}>{busy ? "Salvando..." : "Salvar configuracoes"}</Button>
          </div>
        </TabsContent>

        {/* TAB: IMPRESSÃO */}
        <TabsContent value="impressao" className="space-y-6">
          {/* Papel e Fonte */}
          <Card className="p-6 space-y-6">
            <h2 className="font-display text-2xl">Papel e fonte</h2>

            <div className="space-y-2">
              <Label>Largura do papel</Label>
              <div className="flex gap-2">
                {(["58mm", "80mm"] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setPrintCfg((p) => ({ ...p, largura: w }))}
                    className={cn(
                      "flex-1 rounded-md border py-2 px-4 text-sm font-medium transition-colors",
                      printCfg.largura === w
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent"
                    )}
                  >
                    {w}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Bobina 58mm ou 80mm. Confirme a largura configurada na impressora.</p>
            </div>

            <div className="space-y-2">
              <Label>Tamanho da fonte</Label>
              <div className="flex gap-2">
                {([["pequena", "Pequena"], ["normal", "Normal"], ["grande", "Grande"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setPrintCfg((p) => ({ ...p, fonte: v }))}
                    className={cn(
                      "flex-1 rounded-md border py-2 px-4 text-sm font-medium transition-colors",
                      printCfg.fonte === v
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Rodapé */}
          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl">Rodapé</h2>

            <div className="flex items-center gap-3">
              <Switch
                checked={printCfg.mostrar_rodape}
                onCheckedChange={(v) => setPrintCfg((p) => ({ ...p, mostrar_rodape: v }))}
                id="mostrar-rodape"
              />
              <Label htmlFor="mostrar-rodape">Exibir mensagem no rodapé</Label>
            </div>

            {printCfg.mostrar_rodape && (
              <div className="space-y-2">
                <Label>Texto do rodapé</Label>
                <Textarea
                  value={printCfg.rodape_texto}
                  onChange={(e) => setPrintCfg((p) => ({ ...p, rodape_texto: e.target.value }))}
                  placeholder="Ex: Obrigado pela preferência!"
                  rows={2}
                  maxLength={120}
                />
                <p className="text-xs text-muted-foreground">{printCfg.rodape_texto.length}/120 caracteres</p>
              </div>
            )}
          </Card>

          {/* Preview */}
          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl">Pré-visualização</h2>
            <p className="text-sm text-muted-foreground">Aproximação visual — as fontes reais da impressora térmica podem variar.</p>
            <div className="flex justify-center">
              <div
                className="bg-white text-black border border-gray-200 shadow-md rounded"
                style={{
                  fontFamily: "'Courier New', Courier, monospace",
                  fontSize: printCfg.fonte === "pequena" ? 10 : printCfg.fonte === "grande" ? 14 : 12,
                  width: printCfg.largura === "58mm" ? 192 : 272,
                  padding: "10px 8px",
                  lineHeight: 1.4,
                  userSelect: "none",
                }}
              >
                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: 6 }}>
                  <div style={{ fontWeight: "bold", textTransform: "uppercase", letterSpacing: 2, fontSize: "1.2em" }}>{cfg?.nome_loja || "MINHA LOJA"}</div>
                  <div style={{ fontSize: "0.85em", color: "#555", marginTop: 2 }}>19/05/2026 às 14:30</div>
                </div>
                <div style={{ borderTop: "2px solid #000", margin: "5px 0" }} />

                {/* Section title */}
                <div style={{ textAlign: "center", fontWeight: "bold", textTransform: "uppercase", letterSpacing: 2, margin: "4px 0" }}>DELIVERY</div>
                <div style={{ fontSize: "0.92em" }}>João da Silva</div>
                <div style={{ fontSize: "0.92em", color: "#555" }}>(11) 99999-9999</div>
                <div style={{ fontSize: "0.92em", color: "#555" }}>Rua das Flores, 123 — Centro</div>

                <div style={{ borderTop: "1px dashed #aaa", margin: "4px 0" }} />

                {/* Items */}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, margin: "3px 0" }}>
                  <span>2x X-Burguer</span><span>R$ 40,00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 10, fontSize: "0.9em", color: "#555" }}>
                  <span>+1x Bacon extra</span><span>R$ 5,00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, margin: "3px 0" }}>
                  <span>1x Refrigerante</span><span>R$ 7,00</span>
                </div>

                <div style={{ borderTop: "2px solid #000", margin: "5px 0" }} />

                {/* Totals */}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9em" }}>
                  <span>Subtotal</span><span>R$ 52,00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9em" }}>
                  <span>Taxa de entrega</span><span>R$ 5,00</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "1.2em", margin: "4px 0" }}>
                  <span>TOTAL</span><span>R$ 57,00</span>
                </div>

                {/* Footer */}
                {printCfg.mostrar_rodape && printCfg.rodape_texto && (
                  <>
                    <div style={{ borderTop: "1px dashed #ccc", margin: "6px 0" }} />
                    <div style={{ textAlign: "center", fontSize: "0.85em", color: "#888" }}>{printCfg.rodape_texto}</div>
                  </>
                )}
              </div>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button size="lg" onClick={savePrint} disabled={printSaved}>
              <Printer className="w-4 h-4 mr-2" />
              {printSaved ? "Salvo!" : "Salvar configurações de impressão"}
            </Button>
          </div>

          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl">Resumo do caixa</h2>
            <div className="flex items-center gap-3">
              <Switch checked={autoPrintCash} onCheckedChange={(v) => saveAutoPrintSetting(!!v)} />
              <Label>Imprimir resumo do caixa automaticamente ao fechar</Label>
            </div>
            <p className="text-xs text-muted-foreground">Ao fechar o caixa, o sistema tentará abrir a janela de impressão com o resumo do dia.</p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => {
                // montar um resumo de teste
                const mock = {
                  caixa: { id: "test", valor_inicial: 100, valor_final: 257.5, aberto_em: new Date().toISOString(), fechado_em: new Date().toISOString(), observacoes: null },
                  vendas_mesas: { total: 180, quantidade: 8 },
                  vendas_delivery: { total: 120, quantidade: 4 },
                  total_vendas: 300,
                  contas_count: 8,
                  delivery_count: 4,
                  pagamentos: [{ forma: "Dinheiro", valor: 120 }, { forma: "PIX", valor: 180 }],
                  movimentacoes: { retirada: 50, suprimento: 20 },
                  dinheiro_esperado: 190,
                  diferenca: 67.5,
                } as any;
                printCashSummary(mock);
              }}>Testar resumo</Button>
            </div>
          </Card>
        </TabsContent>

        {/* TAB: WHATSAPP */}
        <TabsContent value="whatsapp" className="space-y-6">
          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-green-500" /> Integracao WhatsApp (Z-API)
            </h2>
            <p className="text-sm text-muted-foreground">
              As credenciais sao usadas exclusivamente pela Edge Function no servidor - nunca expostas ao frontend.
            </p>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Instance ID</Label>
                <Input
                  value={cfg.zapi_instance_id ?? ""}
                  onChange={(e) => setCfg({ ...cfg, zapi_instance_id: e.target.value || null })}
                  placeholder="Ex: 3D1234ABCD..."
                />
              </div>
              <div className="space-y-2">
                <Label>Token</Label>
                <PasswordInput
                  value={cfg.zapi_token ?? ""}
                  onChange={(v) => setCfg({ ...cfg, zapi_token: v || null })}
                  placeholder="Token da instancia"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Client Token</Label>
                <PasswordInput
                  value={cfg.zapi_client_token ?? ""}
                  onChange={(v) => setCfg({ ...cfg, zapi_client_token: v || null })}
                  placeholder="Client-Token do seu plano Z-API"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button variant="outline" onClick={testConnection} disabled={testingConn || !hasCredentials}>
                {testingConn
                  ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Testando...</>
                  : "Testar conexao"}
              </Button>
              {zapiStatus === "ok" && (
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-100 text-green-700 border-green-300">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Conectado
                  </Badge>
                  {zapiPhone && <span className="text-sm text-muted-foreground">Numero: {zapiPhone}</span>}
                </div>
              )}
              {zapiStatus === "error" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-red-100 text-red-700 border-red-300">
                    <XCircle className="w-3 h-3 mr-1" /> Erro na conexao
                  </Badge>
                  {zapiErrMsg && <span className="text-xs text-muted-foreground">{zapiErrMsg}</span>}
                </div>
              )}
            </div>

            {hasCredentials && (
              <div className="flex items-center gap-3 pt-2 border-t">
                <Switch
                  checked={!!cfg.zapi_ativo}
                  onCheckedChange={(v) => setCfg({ ...cfg, zapi_ativo: v })}
                />
                <span className="text-sm font-medium">Ativar notificacoes WhatsApp</span>
                {cfg.zapi_ativo && (
                  <Badge className="bg-green-100 text-green-700 border-green-300 ml-auto">Ativo</Badge>
                )}
              </div>
            )}
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="font-display text-2xl flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-amber-500" /> Pedidos via WhatsApp
            </h2>
            <p className="text-sm text-muted-foreground">
              Chatbot automatizado para clientes fazerem pedidos pelo WhatsApp sem atendente humano.
              O cliente digita <strong>menu</strong> e segue o fluxo guiado até a confirmação.
            </p>

            {hasCredentials && (
              <div className="flex items-center gap-3">
                <Switch
                  checked={!!cfg.whatsapp_pedido_ativo}
                  onCheckedChange={(v) => setCfg({ ...cfg, whatsapp_pedido_ativo: v })}
                />
                <span className="text-sm font-medium">Ativar pedidos via WhatsApp</span>
                {cfg.whatsapp_pedido_ativo && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-300 ml-auto">Bot ativo</Badge>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>URL do site (cardápio online)</Label>
              <Input
                value={cfg.site_url ?? ""}
                onChange={(e) => setCfg({ ...cfg, site_url: e.target.value.trim() || null })}
                placeholder={typeof window !== "undefined" ? window.location.origin : "https://sualoja.com.br"}
              />
              <p className="text-xs text-muted-foreground">
                URL base do app, sem barra no final. Junto com o slug em Geral, gera o link do cardápio.
              </p>
              {buildCardapioUrl({ ...cfg, site_url: cfg.site_url || window.location.origin }) && (
                <p className="text-xs">
                  Link do cardápio:{" "}
                  <a
                    href={buildCardapioUrl({ ...cfg, site_url: cfg.site_url || window.location.origin })}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline break-all"
                  >
                    {buildCardapioUrl({ ...cfg, site_url: cfg.site_url || window.location.origin })}
                  </a>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Mensagem de boas-vindas</Label>
              <Textarea
                rows={8}
                value={cfg.whatsapp_msg_boas_vindas ?? ""}
                onChange={(e) => setCfg({ ...cfg, whatsapp_msg_boas_vindas: e.target.value })}
                placeholder="Mensagem enviada quando o cliente inicia uma conversa..."
              />
              <p className="text-xs text-muted-foreground">
                Variaveis: {"{{loja}}"} (nome da loja), {"{{cardapio}}"} (link do cardápio online)
              </p>
            </div>

            {webhookEndpoint && (
              <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
                <p className="text-sm font-medium">Webhook de recebimento (Z-API)</p>
                <code className="block text-xs break-all bg-background p-2 rounded border">
                  {webhookUrl || webhookEndpoint}
                </code>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl || webhookEndpoint);
                      toast.success("URL copiada");
                    }}
                  >
                    Copiar URL
                  </Button>
                  <Button
                    size="sm"
                    onClick={configureWebhook}
                    disabled={configuringWebhook || !hasCredentials}
                  >
                    {configuringWebhook
                      ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Configurando...</>
                      : "Configurar webhook automaticamente"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Configure o webhook &quot;Ao receber&quot; na Z-API apontando para esta URL,
                  ou use o botao acima para configurar automaticamente.
                </p>
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
                  <strong>Obrigatorio:</strong> na function <code>zapi-webhook</code> do Supabase
                  (Edge Functions → zapi-webhook → Details), desative <strong>Enforce JWT Verification</strong>.
                  Sem isso a Z-API recebe erro 401 e o bot nao responde.
                </div>
              </div>
            )}

            <div className="text-sm text-muted-foreground space-y-1 border-t pt-4">
              <p className="font-medium text-foreground">Comandos do cliente:</p>
              <p><code>menu</code> — Iniciar pedido automatico | <code>link</code> — Cardapio online | <code>carrinho</code> — Ver pedido | <code>cancelar</code> — Sair do bot | <code>ajuda</code> — Ajuda</p>
              <p className="text-xs text-muted-foreground mt-1">Mensagens fora desses comandos nao disparam o bot — a conversa fica livre para atendimento humano.</p>
            </div>
          </Card>

          <Card className="p-6 space-y-5">
            <h2 className="font-display text-2xl">Personalizar mensagens</h2>
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-muted-foreground mr-1 self-center">Variaveis disponiveis:</span>
              {VAR_CHIPS.map((chip) => (
                <Badge
                  key={chip.value}
                  variant="secondary"
                  className="cursor-pointer select-none hover:bg-primary hover:text-primary-foreground transition-colors"
                  onClick={() => navigator.clipboard.writeText(chip.value).then(() => toast.success(`${chip.label} copiado`))}
                >
                  {chip.label}
                </Badge>
              ))}
            </div>

            <div className="space-y-6">
              {MENSAGENS_CONFIG.map(({ campo, campoAtivo, label, tipo }) => {
                const ativo = cfg[campoAtivo] !== false;
                return (
                  <div key={campo} className="space-y-3 rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={ativo}
                          onCheckedChange={(checked) => setCfg({ ...cfg, [campoAtivo]: checked })}
                        />
                        <div>
                          <Label className={ativo ? "" : "text-muted-foreground"}>{label}</Label>
                          <p className="text-xs text-muted-foreground">
                            {ativo ? "Mensagem automatica ativa" : "Mensagem automatica desativada"}
                          </p>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setTestMsgTipo(tipo)}>
                        <Send className="w-3 h-3 mr-1" /> Enviar teste
                      </Button>
                    </div>
                    <Textarea
                      rows={3}
                      value={(cfg[campo] as string) ?? ""}
                      onChange={(e) => setCfg({ ...cfg, [campo]: e.target.value })}
                      placeholder={`Mensagem de ${label.toLowerCase()}...`}
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="flex justify-end">
            <Button size="lg" onClick={saveWhatsapp} disabled={busyWpp}>
              {busyWpp ? "Salvando..." : "Salvar configuracoes WhatsApp"}
            </Button>
          </div>
        </TabsContent>

        {/* TAB: LOGS */}
        <TabsContent value="logs" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl">Logs de envio WhatsApp</h2>
            <div className="flex gap-2 flex-wrap">
              {(["todos", "enviado", "erro"] as const).map((f) => (
                <Button
                  key={f}
                  variant={logsFiltro === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLogsFiltro(f)}
                >
                  {f === "todos" ? "Todos" : f === "enviado" ? "Enviados" : "Erros"}
                </Button>
              ))}
              <Button variant="outline" size="sm" onClick={loadLogs}>
                <RefreshCw className={cn("w-4 h-4", logsLoading && "animate-spin")} />
              </Button>
            </div>
          </div>

          {logsLoading ? (
            <div className="text-muted-foreground text-sm py-8 text-center">Carregando logs...</div>
          ) : logs.length === 0 ? (
            <div className="text-muted-foreground text-sm py-8 text-center border rounded-lg">
              Nenhum log encontrado para o filtro selecionado.
            </div>
          ) : (
            <div className="border rounded-lg divide-y overflow-hidden">
              {logs.map((log) => (
                <div key={log.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                  <div className="flex flex-col min-w-[140px]">
                    <span className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Data/hora</span>
                    <span>{new Date(log.enviado_em).toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="flex flex-col min-w-[110px]">
                    <span className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Pedido</span>
                    <span className="font-mono text-xs">
                      {log.pedido_id ? log.pedido_id.slice(0, 8).toUpperCase() : "-"}
                    </span>
                  </div>
                  <div className="flex flex-col min-w-[130px]">
                    <span className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Telefone</span>
                    <span>{log.telefone}</span>
                  </div>
                  <div className="flex flex-col min-w-[130px]">
                    <span className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Tipo</span>
                    <span>{LOG_TIPO_LABEL[log.tipo_mensagem] ?? log.tipo_mensagem}</span>
                  </div>
                  <div className="flex flex-col flex-1 min-w-[160px]">
                    <span className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Status</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={log.status === "enviado"
                        ? "bg-green-100 text-green-700 border-green-300"
                        : "bg-red-100 text-red-700 border-red-300"
                      }>
                        {log.status === "enviado"
                          ? <><CheckCircle2 className="w-3 h-3 mr-1" />Enviado</>
                          : <><XCircle className="w-3 h-3 mr-1" />Erro</>
                        }
                      </Badge>
                      {log.erro_detalhe && (
                        <span className="text-xs text-muted-foreground truncate max-w-[240px]" title={log.erro_detalhe}>
                          {log.erro_detalhe}
                        </span>
                      )}
                    </div>
                  </div>
                  {log.status === "erro" && (
                    <div className="flex items-center">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reenvBusy === log.id}
                        onClick={() => reenviarLog(log)}
                      >
                        <RefreshCw className={cn("w-3 h-3 mr-1", reenvBusy === log.id && "animate-spin")} />
                        Reenviar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <TestMsgModal
        open={testMsgTipo !== null}
        tipo={testMsgTipo}
        configuracaoId={cfg?.id ?? null}
        onClose={() => setTestMsgTipo(null)}
      />
    </div>
  );
}
