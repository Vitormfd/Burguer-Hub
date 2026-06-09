import { createServiceClient, findLojaByInstance } from "./db.ts";
import { handleIncomingMessage } from "./flow.ts";
import type { ZapiIncomingMessage } from "./types.ts";

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

  return {
    text: payload.text?.message || "",
    selectedId: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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
    return json({ ok: true, skipped: "no_content" });
  }

  const supabase = createServiceClient();
  const loja = await findLojaByInstance(supabase, instanceId);

  if (!loja) {
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
