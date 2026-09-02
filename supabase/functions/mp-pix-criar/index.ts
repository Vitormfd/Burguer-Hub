import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface CriarPagamentoPayload {
  owner_id?: string;
  valor?: number;
  cliente_nome?: string;
  cliente_telefone?: string;
  order_payload?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Variaveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const payload = (await req.json().catch(() => null)) as CriarPagamentoPayload | null;
    const ownerId = payload?.owner_id;
    const valor = Number(payload?.valor || 0);
    const orderPayload = payload?.order_payload;

    if (!ownerId) return json({ error: "Loja inválida" }, 400);
    if (!orderPayload || typeof orderPayload !== "object") return json({ error: "Pedido inválido" }, 400);
    if (!(valor > 0)) return json({ error: "Valor do pedido inválido" }, 400);

    const { data: integracao, error: integracaoError } = await supabase
      .from("integracoes_pagamento")
      .select("mercadopago_access_token, ativo")
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (integracaoError) return json({ error: integracaoError.message }, 500);

    if (!integracao || !integracao.ativo || !integracao.mercadopago_access_token) {
      // Loja não configurou Pix online: o frontend cai de volta pro fluxo tradicional
      // (pedido criado na hora, sem cobrança).
      return json({ fallback: true });
    }

    const accessToken = integracao.mercadopago_access_token as string;
    const telefoneDigits = (payload?.cliente_telefone || "").replace(/\D/g, "");
    const payerEmail = telefoneDigits
      ? `cliente-${telefoneDigits}@pix.easyfoodhub.com.br`
      : "cliente@pix.easyfoodhub.com.br";

    const notificationUrl = `${supabaseUrl}/functions/v1/mp-pix-webhook`;

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: Number(valor.toFixed(2)),
        description: "Pedido Easy Food Hub",
        payment_method_id: "pix",
        payer: {
          email: payerEmail,
          first_name: (payload?.cliente_nome || "Cliente").slice(0, 60),
        },
        notification_url: notificationUrl,
      }),
    });

    const mpData = await mpResponse.json().catch(() => null);

    if (!mpResponse.ok || !mpData?.id) {
      const message = mpData?.message || mpData?.cause?.[0]?.description || "Falha ao gerar cobrança Pix no Mercado Pago";
      return json({ error: message }, 502);
    }

    const qrCode: string | undefined = mpData?.point_of_interaction?.transaction_data?.qr_code;
    const qrCodeBase64: string | undefined = mpData?.point_of_interaction?.transaction_data?.qr_code_base64;
    const expiraEm: string | null = mpData?.date_of_expiration ?? null;

    if (!qrCode) {
      return json({ error: "Mercado Pago não retornou o QR Code do Pix" }, 502);
    }

    const { data: pagamento, error: insertError } = await supabase
      .from("pagamentos_pix")
      .insert({
        owner_id: ownerId,
        mp_payment_id: String(mpData.id),
        status: "pending",
        payload: orderPayload,
        qr_code: qrCode,
        qr_code_base64: qrCodeBase64 ?? null,
        valor,
        expira_em: expiraEm,
      })
      .select("id")
      .single();

    if (insertError) return json({ error: insertError.message }, 500);

    return json({
      pagamento_id: pagamento.id,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64 ?? null,
      expira_em: expiraEm,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
