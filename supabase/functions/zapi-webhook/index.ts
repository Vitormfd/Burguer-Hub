import { createServiceClient, findLojaByInstance } from "./db.ts";
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

const WEBHOOK_VERSION = "2026-06-30b";

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

  const raw = payload as Record<string, unknown>;
  const textObj = payload.text as { message?: string } | string | undefined;
  const fromTextField = typeof textObj === "string"
    ? textObj
    : textObj?.message || "";

  const fromMessageField = typeof raw.message === "string" ? raw.message : "";
  const fromBody = typeof raw.body === "string" ? raw.body : "";

  return { text: fromTextField || fromMessageField || fromBody, selectedId: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return json({ ok: true, service: "zapi-webhook", version: WEBHOOK_VERSION, hint: "POST only from Z-API" });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
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

  const callbackType = (payload as Record<string, unknown>).type as string | undefined;
  if (callbackType && callbackType !== "ReceivedCallback") {
    console.log("zapi-webhook: ignorando callback", callbackType);
    return json({ ok: true, skipped: "not_received_callback", type: callbackType });
  }

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

  console.log("zapi-webhook: loja ok", {
    instanceId,
    modo: loja.whatsapp_bot_modo ?? "completo",
    phone,
    text: text.slice(0, 80),
  });

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
