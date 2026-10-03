// Cliente da Evolution API (v2) compartilhado entre send-whatsapp e zapi-webhook.
// Secrets necessários nas Edge Functions:
//   EVOLUTION_API_URL        ex: https://whatsapp-evolution-api.xxxx.easypanel.host
//   EVOLUTION_API_KEY        AUTHENTICATION_API_KEY do servidor Evolution
//   EVOLUTION_WEBHOOK_SECRET texto aleatório; protege o webhook de recebimento

export type EvolutionState = "open" | "close" | "connecting" | string;

const env = () => {
  const url = (Deno.env.get("EVOLUTION_API_URL") || "").trim().replace(/\/+$/, "");
  const apiKey = (Deno.env.get("EVOLUTION_API_KEY") || "").trim();
  if (!url || !apiKey) {
    throw new Error("Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)");
  }
  return { url, apiKey };
};

async function evoFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { url, apiKey } = env();
  const res = await fetch(`${url}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Evolution ${init.method ?? "GET"} ${path.split("/").slice(0, 3).join("/")} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Nome estável da instância a partir do id da configuração da loja. */
export const evolutionInstanceName = (configuracaoId: string): string =>
  `bh-${configuracaoId.replace(/-/g, "").slice(0, 16)}`;

/** URL do webhook de recebimento (zapi-webhook trata os dois provedores). */
export const evolutionWebhookUrl = (): string => {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const secret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") || "";
  if (!supabaseUrl || !secret) {
    throw new Error("SUPABASE_URL ou EVOLUTION_WEBHOOK_SECRET ausente");
  }
  return `${supabaseUrl}/functions/v1/zapi-webhook?provider=evolution&secret=${encodeURIComponent(secret)}`;
};

const webhookConfig = (url: string) => ({
  enabled: true,
  url,
  byEvents: false,
  base64: false,
  events: ["MESSAGES_UPSERT"],
});

export async function evolutionSendText(instance: string, number: string, text: string): Promise<void> {
  await evoFetch(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: { number: number.replace(/\D/g, ""), text },
  });
}

interface FetchedInstance {
  name?: string;
  instanceName?: string;
  connectionStatus?: string;
  ownerJid?: string | null;
  number?: string | null;
}

/** Estado da conexão e número conectado. Retorna null se a instância não existe. */
export async function evolutionInstanceInfo(
  instance: string,
): Promise<{ state: EvolutionState; phone: string } | null> {
  const list = await evoFetch<FetchedInstance[] | FetchedInstance>(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
  ).catch((err) => {
    if (String(err).includes("HTTP 404")) return [];
    throw err;
  });
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  const found = arr.find((i) => (i.name ?? i.instanceName) === instance);
  if (!found) return null;
  const phone = (found.ownerJid || found.number || "").split("@")[0].replace(/\D/g, "");
  return { state: found.connectionStatus || "close", phone };
}

/** Cria a instância (sem importar histórico, ignorando grupos) já com o webhook. */
export async function evolutionCreateInstance(instance: string): Promise<void> {
  await evoFetch("/instance/create", {
    method: "POST",
    body: {
      instanceName: instance,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      groupsIgnore: true,
      rejectCall: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook: webhookConfig(evolutionWebhookUrl()),
    },
  });
}

export async function evolutionSetWebhook(instance: string): Promise<string> {
  const url = evolutionWebhookUrl();
  await evoFetch(`/webhook/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: { webhook: webhookConfig(url) },
  });
  return url;
}

/** Pede um QR Code novo. Retorna data URL da imagem (ou null se já conectado). */
export async function evolutionConnect(instance: string): Promise<string | null> {
  const data = await evoFetch<{ base64?: string; instance?: { state?: string } }>(
    `/instance/connect/${encodeURIComponent(instance)}`,
  );
  if (!data?.base64) return null;
  return data.base64.startsWith("data:") ? data.base64 : `data:image/png;base64,${data.base64}`;
}

export async function evolutionLogout(instance: string): Promise<void> {
  await evoFetch(`/instance/logout/${encodeURIComponent(instance)}`, { method: "DELETE" });
}

// ---------- Webhook (mensagens recebidas) ----------

export interface EvolutionWebhookPayload {
  event?: string;
  instance?: string;
  data?: {
    key?: {
      remoteJid?: string;
      remoteJidAlt?: string;
      senderPn?: string;
      fromMe?: boolean;
      id?: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      listResponseMessage?: { title?: string; singleSelectReply?: { selectedRowId?: string } };
      buttonsResponseMessage?: { selectedButtonId?: string; selectedDisplayText?: string };
    };
  };
}

export interface ParsedEvolutionMessage {
  instance: string;
  phone: string;
  messageId?: string;
  senderName?: string;
  text: string;
  selectedId: string | null;
}

/**
 * Normaliza um messages.upsert da Evolution. Retorna string com o motivo quando a mensagem
 * deve ser ignorada (enviada por nós, grupo, status, sem texto...).
 */
export function parseEvolutionWebhook(payload: EvolutionWebhookPayload): ParsedEvolutionMessage | string {
  const event = (payload.event || "").toLowerCase().replace(/_/g, ".");
  if (event !== "messages.upsert") return "event_ignored";

  const instance = payload.instance;
  const key = payload.data?.key;
  if (!instance || !key) return "no_instance_or_key";
  if (key.fromMe) return "from_me";

  const remote = key.remoteJid || "";
  if (remote.endsWith("@g.us") || remote === "status@broadcast" || remote.endsWith("@newsletter")) {
    return "group_or_broadcast";
  }

  // Contatos com endereçamento LID trazem o número real em remoteJidAlt/senderPn.
  const jid = [remote, key.remoteJidAlt, key.senderPn].find((j) => j?.endsWith("@s.whatsapp.net"));
  if (!jid) return "no_phone_jid";
  const phone = jid.split("@")[0].replace(/\D/g, "");

  const msg = payload.data?.message ?? {};
  let selectedId: string | null = null;
  let text = msg.conversation || msg.extendedTextMessage?.text || "";
  if (msg.listResponseMessage?.singleSelectReply?.selectedRowId) {
    selectedId = msg.listResponseMessage.singleSelectReply.selectedRowId;
    text = msg.listResponseMessage.title || text;
  } else if (msg.buttonsResponseMessage?.selectedButtonId) {
    selectedId = msg.buttonsResponseMessage.selectedButtonId;
    text = msg.buttonsResponseMessage.selectedDisplayText || text;
  }
  if (!text && !selectedId) return "no_content";

  return {
    instance,
    phone,
    messageId: key.id,
    senderName: payload.data?.pushName,
    text,
    selectedId,
  };
}
