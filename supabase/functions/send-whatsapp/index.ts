import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  evolutionConnect,
  evolutionCreateInstance,
  evolutionInstanceInfo,
  evolutionInstanceName,
  evolutionLogout,
  evolutionSendText,
  evolutionSetWebhook,
} from "../_shared/evolution.ts";
import { publicBaseUrl } from "../_shared/whatsappText.ts";

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
  action?:
    | "send"
    | "test_connection"
    | "configure_webhook"
    | "evolution_connect"
    | "evolution_status"
    | "evolution_disconnect";
  configuracao_id?: string;
  pedido_id: string;
  tipo_mensagem: TipoMensagem;
  telefone: string;
  dados_pedido?: {
    nome?: string;
    itens?: string;
    resumo?: string;
    total?: string;
    tempo_estimado?: string;
  };
}

const normalizePhone = (value: string): string =>
  value.replace(/\D/g, "").trim();

/** Normaliza celular BR para 11 dígitos locais (DDD + 9 + número). */
const normalizeBrazilMobile = (
  value: string,
): { local: string; formatted: string } | null => {
  let digits = normalizePhone(value);
  if (!digits) return null;

  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }

  // DDD (2) + 8 dígitos — celular sem o 9 extra (comum em APIs/WhatsApp)
  if (digits.length === 10) {
    digits = digits.slice(0, 2) + "9" + digits.slice(2);
  }

  if (digits.length !== 11 || digits[2] !== "9") {
    return null;
  }

  return { local: digits, formatted: `55${digits}` };
};

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

  const { action, configuracao_id, pedido_id, tipo_mensagem, telefone, dados_pedido } = payload ?? {};

  let ownerIdFromPedido: string | null = null;
  if (!configuracao_id && pedido_id) {
    const { data: pedidoData } = await supabase
      .from("pedidos")
      .select("owner_id")
      .eq("id", pedido_id)
      .maybeSingle();

    ownerIdFromPedido = (pedidoData?.owner_id as string | null) ?? null;
  }

  // Fetch Z-API credentials from configuracoes.
  // If configuracao_id is not provided (automatic flow), prioritize active rows with credentials.
  let cfgQuery = supabase
    .from("configuracoes")
    .select(
      "id, owner_id, zapi_instance_id, zapi_token, zapi_client_token, zapi_ativo, " +
      "whatsapp_provider, evolution_instance, " +
      "whatsapp_msg_confirmado, whatsapp_msg_em_preparo, whatsapp_msg_saiu_entrega, " +
      "whatsapp_msg_entregue, whatsapp_msg_retirada_pronto, " +
      "whatsapp_msg_confirmado_ativo, whatsapp_msg_em_preparo_ativo, whatsapp_msg_saiu_entrega_ativo, " +
      "whatsapp_msg_entregue_ativo, whatsapp_msg_retirada_pronto_ativo, tempo_entrega_min"
    );

  if (configuracao_id) {
    cfgQuery = cfgQuery.eq("id", configuracao_id);
  } else {
    cfgQuery = cfgQuery
      .eq("owner_id", ownerIdFromPedido)
      .eq("zapi_ativo", true)
      .or(
        "and(whatsapp_provider.eq.zapi,zapi_instance_id.not.is.null,zapi_token.not.is.null,zapi_client_token.not.is.null)," +
        "and(whatsapp_provider.eq.evolution,evolution_instance.not.is.null)",
      );
  }

  const { data: cfg, error: cfgErr } = await cfgQuery.limit(1).maybeSingle();

  if (cfgErr) {
    return json({ error: "Não foi possível carregar configurações" }, 500);
  }

  if (!cfg) {
    if (action === "test_connection") {
      return json({ ok: false, error: "Nenhuma configuração ativa com credenciais foi encontrada" }, 200);
    }

    if (pedido_id && tipo_mensagem && telefone) {
      await supabase.from("whatsapp_logs").insert({
        owner_id: ownerIdFromPedido,
        pedido_id,
        telefone: normalizePhone(telefone) || telefone,
        tipo_mensagem,
        mensagem_enviada: "",
        status: "erro",
        erro_detalhe: "Nenhuma configuração ativa com credenciais foi encontrada",
      });
    }

    return json({ skipped: true, reason: "config_not_found" });
  }

  const { zapi_instance_id, zapi_token, zapi_client_token } = cfg as Record<string, string | null | boolean>;
  const provider = cfg as unknown as { id: string; whatsapp_provider?: string; evolution_instance?: string | null };
  const isEvolution = provider.whatsapp_provider === "evolution";
  const evolutionInstance = provider.evolution_instance ?? null;

  // Ações da Evolution (conectar via QR, status, desconectar) — só o dono da loja.
  if (action === "evolution_connect" || action === "evolution_status" || action === "evolution_disconnect") {
    const ownerId = (cfg as { owner_id?: string | null }).owner_id;
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData } = await supabase.auth.getUser(jwt);
    if (!userData?.user || userData.user.id !== ownerId) {
      return json({ ok: false, error: "Não autorizado" }, 403);
    }

    try {
      if (action === "evolution_status") {
        if (!evolutionInstance) return json({ ok: true, state: "close", phone: "" });
        const info = await evolutionInstanceInfo(evolutionInstance);
        return json({ ok: true, state: info?.state ?? "close", phone: info?.phone ?? "" });
      }

      if (action === "evolution_disconnect") {
        if (evolutionInstance) await evolutionLogout(evolutionInstance);
        return json({ ok: true, state: "close" });
      }

      // evolution_connect: cria a instância se preciso, garante o webhook e devolve o QR Code.
      const instance = evolutionInstance || evolutionInstanceName(provider.id);
      let info = await evolutionInstanceInfo(instance);
      if (!info) {
        await evolutionCreateInstance(instance);
        info = await evolutionInstanceInfo(instance);
      } else {
        await evolutionSetWebhook(instance);
      }

      const { error: updErr } = await supabase
        .from("configuracoes")
        .update({ whatsapp_provider: "evolution", evolution_instance: instance })
        .eq("id", provider.id);
      if (updErr) return json({ ok: false, error: updErr.message }, 200);

      if (info?.state === "open") {
        return json({ ok: true, instance, state: "open", phone: info.phone });
      }
      const qr = await evolutionConnect(instance);
      return json({ ok: true, instance, state: qr ? "connecting" : info?.state ?? "close", qr });
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
    }
  }

  // Configure Z-API received webhook for WhatsApp orders bot
  if (action === "configure_webhook" && isEvolution) {
    if (!evolutionInstance) {
      return json({ ok: false, error: "Conecte o WhatsApp (Evolution) primeiro" }, 200);
    }
    try {
      await evolutionSetWebhook(evolutionInstance);
      return json({ ok: true }, 200);
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
    }
  }

  if (action === "configure_webhook") {
    if (!zapi_instance_id || !zapi_token || !zapi_client_token) {
      return json({ ok: false, error: "Credenciais Z-API ausentes em configuracoes" }, 200);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      return json({ ok: false, error: "SUPABASE_URL ausente" }, 500);
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/zapi-webhook`;

    try {
      const receivedUrl = `https://api.z-api.io/instances/${zapi_instance_id}/token/${zapi_token}/update-webhook-received`;
      const res = await fetch(receivedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Client-Token": zapi_client_token as string,
        },
        body: JSON.stringify({ value: webhookUrl }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return json({ ok: false, error: `HTTP ${res.status}: ${errBody}` }, 200);
      }

      await fetch(
        `https://api.z-api.io/instances/${zapi_instance_id}/token/${zapi_token}/update-notify-sent-by-me`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Client-Token": zapi_client_token as string,
          },
          body: JSON.stringify({ notifySentByMe: false }),
        },
      );

      return json({ ok: true, webhook_url: webhookUrl }, 200);
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
    }
  }

  // Connection test always runs through backend to avoid exposing credentials in frontend
  if (action === "test_connection" && isEvolution) {
    if (!evolutionInstance) {
      return json({ ok: false, error: "Nenhuma instância Evolution conectada" }, 200);
    }
    try {
      const info = await evolutionInstanceInfo(evolutionInstance);
      if (info?.state !== "open") {
        return json({ ok: false, error: "WhatsApp desconectado. Leia o QR Code novamente." }, 200);
      }
      return json({ ok: true, phone: info.phone }, 200);
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 200);
    }
  }

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

  if (isEvolution ? !evolutionInstance : !zapi_instance_id || !zapi_token || !zapi_client_token) {
    return json({ skipped: true, reason: "credentials_missing" });
  }

  if (!pedido_id || !tipo_mensagem || !telefone) {
    return json({ error: "pedido_id, tipo_mensagem e telefone são obrigatórios" }, 400);
  }

  const phone = normalizeBrazilMobile(telefone);
  if (!phone) {
    const cleaned = normalizePhone(telefone);
    await supabase.from("whatsapp_logs").insert({
      owner_id: (cfg as { owner_id?: string | null }).owner_id ?? ownerIdFromPedido,
      pedido_id,
      telefone: cleaned || telefone,
      tipo_mensagem,
      mensagem_enviada: "",
      status: "erro",
      erro_detalhe: `Telefone inválido: ${telefone} (${cleaned.length} dígitos após limpeza)`,
    });
    return json({ skipped: true, reason: "invalid_phone" });
  }

  const formattedPhone = phone.formatted;

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

  const ativoMap: Record<TipoMensagem, boolean> = {
    confirmado: (cfg as Record<string, boolean>).whatsapp_msg_confirmado_ativo !== false,
    em_preparo: (cfg as Record<string, boolean>).whatsapp_msg_em_preparo_ativo !== false,
    saiu_entrega: (cfg as Record<string, boolean>).whatsapp_msg_saiu_entrega_ativo !== false,
    entregue: (cfg as Record<string, boolean>).whatsapp_msg_entregue_ativo !== false,
    retirada_pronto: (cfg as Record<string, boolean>).whatsapp_msg_retirada_pronto_ativo !== false,
  };

  const isTestPedido = pedido_id === "00000000-0000-0000-0000-000000000000";
  if (!isTestPedido && !ativoMap[tipo_mensagem as TipoMensagem]) {
    return json({ skipped: true, reason: "message_inactive" });
  }

  const shortId = pedido_id.slice(0, 8).toUpperCase();
  const itensLista = dados_pedido?.itens ?? "";
  const resumoDetalhado = dados_pedido?.resumo?.trim() || itensLista;

  const varsMap: Record<string, string> = {
    nome: dados_pedido?.nome ?? "Cliente",
    pedido_id: shortId,
    itens: itensLista,
    resumo: resumoDetalhado,
    total: dados_pedido?.total ?? "",
    tempo_estimado: dados_pedido?.tempo_estimado ?? (cfg as Record<string, string>).tempo_entrega_min ?? "30-45 min",
  };

  // Links da página pública do pedido (acompanhamento + avaliação).
  // Consulta separada e tolerante a erro: se as colunas novas não existirem, segue sem link.
  let linksCfg: { acompanhamento_link_ativo?: boolean; avaliacao_ativa?: boolean; site_url?: string | null } = {};
  if (!isTestPedido && (tipo_mensagem === "confirmado" || tipo_mensagem === "entregue")) {
    const { data: extra, error: extraErr } = await supabase
      .from("configuracoes")
      .select("acompanhamento_link_ativo, avaliacao_ativa, site_url")
      .eq("id", provider.id)
      .maybeSingle();
    if (!extraErr && extra) linksCfg = extra as typeof linksCfg;
  }
  const pedidoUrl = `${publicBaseUrl(linksCfg.site_url)}/pedido/${pedido_id}`;
  varsMap.link_acompanhamento = pedidoUrl;
  varsMap.link_avaliacao = pedidoUrl;

  let mensagem = formatMessage(template, varsMap);

  if (tipo_mensagem === "confirmado" && linksCfg.acompanhamento_link_ativo === true && !template.includes("{{link_acompanhamento}}")) {
    mensagem += `\n\n📍 Acompanhe seu pedido em tempo real:\n${pedidoUrl}`;
  }
  if (tipo_mensagem === "entregue" && linksCfg.avaliacao_ativa === true && !template.includes("{{link_avaliacao}}")) {
    mensagem += `\n\n⭐ Como foi seu pedido? Avalie em 10 segundos:\n${pedidoUrl}`;
  }

  let zapiStatus: "enviado" | "erro" = "enviado";
  let erroDetalhe: string | null = null;

  if (isEvolution) {
    try {
      await evolutionSendText(evolutionInstance as string, formattedPhone, mensagem);
    } catch (err) {
      zapiStatus = "erro";
      erroDetalhe = err instanceof Error ? err.message : String(err);
    }
  } else {
    try {
      // Call Z-API
      const zapiUrl = `https://api.z-api.io/instances/${zapi_instance_id}/token/${zapi_token}/send-text`;
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
  }

  // Log result — always, regardless of outcome
  await supabase.from("whatsapp_logs").insert({
    owner_id: (cfg as { owner_id?: string | null }).owner_id ?? ownerIdFromPedido,
    pedido_id,
    telefone: formattedPhone,
    tipo_mensagem,
    mensagem_enviada: mensagem,
    status: zapiStatus,
    erro_detalhe: erroDetalhe,
  });

  // Always return success — errors never block the order flow
  return json({ ok: true, status: zapiStatus, error: erroDetalhe });
});
