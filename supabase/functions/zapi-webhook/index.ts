import {
  parseEvolutionFromMe,
  parseEvolutionWebhook,
  type EvolutionWebhookPayload,
} from "../_shared/evolution.ts";
import {
  createServiceClient,
  findLojaByEvolutionInstance,
  findLojaByInstance,
  marcarConversaDaLoja,
} from "./db.ts";
import { handleIncomingMessage } from "./flow.ts";
import type { ZapiIncomingMessage } from "./format.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function extractMessage(payload: ZapiIncomingMessage): {
  text: string;
  selectedId: string | null;
} {
  if (payload.listResponseMessage?.selectedRowId) {
    return {
      text: payload.listResponseMessage.title || payload.listResponseMessage.message || "",
      selectedId: payload.listResponseMessage.selectedRowId,
    };
  }

  if (payload.buttonsResponseMessage?.buttonId) {
    return {
      text: payload.buttonsResponseMessage.message || "",
      selectedId: payload.buttonsResponseMessage.buttonId,
    };
  }

  const textObj = payload.text as { message?: string } | string | undefined;
  const text = typeof textObj === "string"
    ? textObj
    : textObj?.message || "";

  return { text, selectedId: null };
}

async function handleEvolution(req: Request, url: URL): Promise<Response> {
  const expected = Deno.env.get("EVOLUTION_WEBHOOK_SECRET");
  if (!expected || url.searchParams.get("secret") !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: EvolutionWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Loja mandou mensagem (dono pelo celular ou o próprio robô): lembra que a conversa está ativa.
  const enviada = parseEvolutionFromMe(payload);
  if (enviada) {
    const supabase = createServiceClient();
    const loja = await findLojaByEvolutionInstance(supabase, enviada.instance);
    if (loja) await marcarConversaDaLoja(supabase, loja.owner_id, enviada.phone);
    return json({ ok: true, skipped: "from_me" });
  }

  const parsed = parseEvolutionWebhook(payload);
  if (typeof parsed === "string") {
    if (parsed === "no_phone_jid" || parsed === "no_content") {
      console.warn("evolution-webhook skipped:", parsed, JSON.stringify(payload).slice(0, 500));
    }
    return json({ ok: true, skipped: parsed });
  }

  const supabase = createServiceClient();
  const loja = await findLojaByEvolutionInstance(supabase, parsed.instance);
  if (!loja) {
    return json({ ok: true, skipped: "loja_not_found_or_inactive" });
  }

  try {
    await handleIncomingMessage(
      supabase,
      loja,
      parsed.phone,
      parsed.text,
      parsed.selectedId,
      parsed.messageId,
      parsed.senderName,
    );
  } catch (err) {
    console.error("evolution-webhook error:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }

  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return json({ ok: true, service: "zapi-webhook", hint: "POST only from Z-API" });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  if (url.searchParams.get("provider") === "evolution") {
    return handleEvolution(req, url);
  }

  let payload: ZapiIncomingMessage;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  console.log("zapi-webhook received:", {
    instanceId: payload.instanceId,
    phone: payload.phone,
    fromMe: payload.fromMe,
    isGroup: payload.isGroup,
    type: (payload as Record<string, unknown>).type,
  });

  // Ignora mensagens enviadas por nós, grupos e callbacks sem conteúdo
  if (payload.fromMe || payload.isGroup) {
    return json({ ok: true, skipped: "ignored" });
  }

  const instanceId = payload.instanceId;
  const phone = payload.phone;
  if (!instanceId || !phone) {
    return json({ ok: true, skipped: "no_instance_or_phone" });
  }

  const { text, selectedId } = extractMessage(payload);
  if (!text && !selectedId) {
    console.warn("zapi-webhook: payload sem texto", JSON.stringify(payload).slice(0, 500));
    return json({ ok: true, skipped: "no_content" });
  }

  const supabase = createServiceClient();
  const loja = await findLojaByInstance(supabase, instanceId);

  if (!loja) {
    console.warn("zapi-webhook: loja nao encontrada para", instanceId);
    return json({ ok: true, skipped: "loja_not_found_or_inactive" });
  }

  try {
    await handleIncomingMessage(
      supabase,
      loja,
      phone,
      text,
      selectedId,
      payload.messageId,
      payload.senderName,
    );
  } catch (err) {
    console.error("zapi-webhook error:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }

  return json({ ok: true });
});
