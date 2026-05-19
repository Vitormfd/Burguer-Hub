import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TipoMensagem =
  | "confirmado"
  | "em_preparo"
  | "saiu_entrega"
  | "entregue"
  | "retirada_pronto";

interface SendPayload {
  action?: "send" | "test_connection";
  pedido_id: string;
  tipo_mensagem: TipoMensagem;
  telefone: string;
  dados_pedido?: {
    nome?: string;
    itens?: string;
    total?: string;
    tempo_estimado?: string;
  };
}

const normalizePhone = (value: string): string =>
  value.replace(/\D/g, "").trim();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const formatMessage = (
  template: string,
  vars: Record<string, string>
): string => {
  let msg = template;
  for (const [key, value] of Object.entries(vars)) {
    msg = msg.replaceAll(`{{${key}}}`, value);
  }
  return msg;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Configuração interna ausente" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let payload: SendPayload | null = null;
  try {
    payload = (await req.json()) as SendPayload;
  } catch {
    return json({ error: "Payload inválido" }, 400);
  }

  const { action, pedido_id, tipo_mensagem, telefone, dados_pedido } = payload ?? {};

  // Fetch Z-API credentials from configuracoes
  const { data: cfg, error: cfgErr } = await supabase
    .from("configuracoes")
    .select(
      "zapi_instance_id, zapi_token, zapi_client_token, zapi_ativo, " +
      "whatsapp_msg_confirmado, whatsapp_msg_em_preparo, whatsapp_msg_saiu_entrega, " +
      "whatsapp_msg_entregue, whatsapp_msg_retirada_pronto, tempo_entrega_min"
    )
    .limit(1)
    .maybeSingle();

  if (cfgErr || !cfg) {
    return json({ error: "Não foi possível carregar configurações" }, 500);
  }

  const { zapi_instance_id, zapi_token, zapi_client_token } = cfg as Record<string, string | null | boolean>;

  // Connection test always runs through backend to avoid exposing credentials in frontend
  if (action === "test_connection") {
    if (!zapi_instance_id || !zapi_token || !zapi_client_token) {
      return json({ ok: false, error: "Credenciais Z-API ausentes em configuracoes" }, 200);
    }

    try {
      const statusUrl = `https://api.z-api.io/instances/${zapi_instance_id}/token/${zapi_token}/status`;
      const res = await fetch(statusUrl, {
        headers: {
          "Client-Token": zapi_client_token as string,
        },
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        return json({ ok: false, error: `HTTP ${res.status}: ${body?.error ?? res.statusText}` }, 200);
      }

      const phone = body?.phone ?? body?.connectedPhone ?? body?.number ?? "";
      return json({ ok: true, phone: phone ? String(phone) : "" }, 200);
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
    }
  }

  // If WhatsApp integration is disabled, return silently for normal send flow
  if (!cfg.zapi_ativo) {
    return json({ skipped: true, reason: "zapi_inactive" });
  }

  if (!zapi_instance_id || !zapi_token || !zapi_client_token) {
    return json({ skipped: true, reason: "credentials_missing" });
  }

  if (!pedido_id || !tipo_mensagem || !telefone) {
    return json({ error: "pedido_id, tipo_mensagem e telefone são obrigatórios" }, 400);
  }

  // Validate phone: must be exactly 11 digits after cleaning (DDD + number)
  // Accept both formats with or without country code 55.
  const cleanedPhone = normalizePhone(telefone);
  const localPhone = cleanedPhone.startsWith("55") && cleanedPhone.length === 13
    ? cleanedPhone.slice(2)
    : cleanedPhone;

  if (localPhone.length !== 11) {
    await supabase.from("whatsapp_logs").insert({
      pedido_id,
      telefone: cleanedPhone || telefone,
      tipo_mensagem,
      mensagem_enviada: "",
      status: "erro",
      erro_detalhe: `Telefone inválido: ${telefone} (${localPhone.length} dígitos após limpeza)`,
    });
    return json({ skipped: true, reason: "invalid_phone" });
  }

  const formattedPhone = `55${localPhone}`;

  // Pick the right message template
  const templateMap: Record<TipoMensagem, string> = {
    confirmado: (cfg as Record<string, string>).whatsapp_msg_confirmado,
    em_preparo: (cfg as Record<string, string>).whatsapp_msg_em_preparo,
    saiu_entrega: (cfg as Record<string, string>).whatsapp_msg_saiu_entrega,
    entregue: (cfg as Record<string, string>).whatsapp_msg_entregue,
    retirada_pronto: (cfg as Record<string, string>).whatsapp_msg_retirada_pronto,
  };

  const template = templateMap[tipo_mensagem as TipoMensagem];
  if (!template) {
    return json({ error: "tipo_mensagem inválido" }, 400);
  }

  const shortId = pedido_id.slice(0, 8).toUpperCase();
  const varsMap: Record<string, string> = {
    nome: dados_pedido?.nome ?? "Cliente",
    pedido_id: shortId,
    itens: dados_pedido?.itens ?? "",
    total: dados_pedido?.total ?? "",
    tempo_estimado: dados_pedido?.tempo_estimado ?? (cfg as Record<string, string>).tempo_entrega_min ?? "30-45 min",
  };

  const mensagem = formatMessage(template, varsMap);

  // Call Z-API
  const zapiUrl = `https://api.z-api.io/instances/${zapi_instance_id}/token/${zapi_token}/send-text`;
  let zapiStatus: "enviado" | "erro" = "enviado";
  let erroDetalhe: string | null = null;

  try {
    const zapiRes = await fetch(zapiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": zapi_client_token as string,
      },
      body: JSON.stringify({
        phone: formattedPhone,
        message: mensagem,
      }),
    });

    if (!zapiRes.ok) {
      const errBody = await zapiRes.text().catch(() => zapiRes.statusText);
      zapiStatus = "erro";
      erroDetalhe = `HTTP ${zapiRes.status}: ${errBody}`;
    }
  } catch (err) {
    zapiStatus = "erro";
    erroDetalhe = err instanceof Error ? err.message : String(err);
  }

  // Log result — always, regardless of outcome
  await supabase.from("whatsapp_logs").insert({
    pedido_id,
    telefone: formattedPhone,
    tipo_mensagem,
    mensagem_enviada: mensagem,
    status: zapiStatus,
    erro_detalhe: erroDetalhe,
  });

  // Always return success — errors never block the order flow
  return json({ ok: true, status: zapiStatus });
});
