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

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

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

    const url = new URL(req.url);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const data = body?.data as Record<string, unknown> | undefined;

    // Mercado Pago manda tanto o formato novo ({type:"payment", data:{id}}) quanto o IPN
    // antigo (topic/id via query string). Aceita os dois.
    const mpPaymentId =
      (data?.id as string | number | undefined) ??
      url.searchParams.get("data.id") ??
      (url.searchParams.get("topic") === "payment" ? url.searchParams.get("id") : null);

    const eventType = (body?.type as string | undefined) ?? url.searchParams.get("type") ?? url.searchParams.get("topic");

    if (eventType && eventType !== "payment") {
      return json({ ok: true, skipped: true });
    }

    if (!mpPaymentId) {
      return json({ ok: true, skipped: true });
    }

    const { data: pagamento, error: pagamentoError } = await supabase
      .from("pagamentos_pix")
      .select("id, owner_id, status, payload, pedido_id")
      .eq("mp_payment_id", String(mpPaymentId))
      .maybeSingle();

    if (pagamentoError) return json({ error: pagamentoError.message }, 500);

    if (!pagamento) {
      // Notificação de um pagamento que não é nosso — não é erro, só ignora.
      return json({ ok: true, skipped: true });
    }

    if (pagamento.status === "approved" && pagamento.pedido_id) {
      return json({ ok: true, already_processed: true });
    }

    const { data: integracao, error: integracaoError } = await supabase
      .from("integracoes_pagamento")
      .select("mercadopago_access_token")
      .eq("owner_id", pagamento.owner_id)
      .maybeSingle();

    if (integracaoError) return json({ error: integracaoError.message }, 500);
    if (!integracao?.mercadopago_access_token) {
      return json({ error: "Loja sem credenciais Mercado Pago configuradas" }, 500);
    }

    // Nunca confia no corpo do webhook: reconsulta o pagamento na API do Mercado Pago
    // com o token do próprio dono da loja antes de liberar qualquer pedido.
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${integracao.mercadopago_access_token}` },
    });
    const mpData = await mpResponse.json().catch(() => null);

    if (!mpResponse.ok || !mpData?.status) {
      return json({ error: "Falha ao confirmar pagamento no Mercado Pago" }, 502);
    }

    const statusMap: Record<string, "approved" | "rejected" | "cancelled"> = {
      approved: "approved",
      rejected: "rejected",
      cancelled: "cancelled",
      refunded: "cancelled",
      charged_back: "cancelled",
    };
    const novoStatus = statusMap[mpData.status as string] ?? null;

    if (novoStatus === null) {
      // in_process, pending, etc — ainda não é definitivo, não faz nada.
      return json({ ok: true, status: mpData.status });
    }

    if (novoStatus !== "approved") {
      await supabase
        .from("pagamentos_pix")
        .update({ status: novoStatus, atualizado_em: new Date().toISOString() })
        .eq("id", pagamento.id);
      return json({ ok: true, status: novoStatus });
    }

    // O Mercado Pago costuma mandar mais de uma notificação pro mesmo pagamento (retry,
    // ou eventos "created"/"updated" quase simultâneos). Reivindica o pagamento com um
    // UPDATE condicional antes de criar o pedido: só a invocação que efetivamente muda
    // status de 'pending' pra 'approved' segue em frente — as outras (concorrentes ou
    // reenviadas depois) encontram 0 linhas afetadas e param aqui, sem duplicar o pedido.
    const { data: claimed, error: claimError } = await supabase
      .from("pagamentos_pix")
      .update({ status: "approved", atualizado_em: new Date().toISOString() })
      .eq("id", pagamento.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimError) return json({ error: claimError.message }, 500);
    if (!claimed) {
      return json({ ok: true, already_processed: true });
    }

    // Aprovado: cria o pedido de verdade agora, reaproveitando a mesma RPC do checkout público.
    const p = (pagamento.payload || {}) as Record<string, unknown>;
    const { data: rpcResult, error: rpcError } = await supabase.rpc("create_public_delivery_order", {
      p_owner_id: pagamento.owner_id,
      p_tipo_entrega: p.p_tipo_entrega,
      p_cliente_nome: p.p_cliente_nome,
      p_cliente_telefone: p.p_cliente_telefone,
      p_endereco: p.p_endereco,
      p_numero: p.p_numero,
      p_complemento: p.p_complemento,
      p_bairro: p.p_bairro,
      p_taxa_entrega: p.p_taxa_entrega,
      p_forma_pagamento: p.p_forma_pagamento,
      p_troco_para: p.p_troco_para,
      p_subtotal: p.p_subtotal,
      p_desconto: p.p_desconto,
      p_total: p.p_total,
      p_cupom_id: p.p_cupom_id,
      p_valor_desconto: p.p_valor_desconto,
      p_cliente_id: p.p_cliente_id,
      p_selected_reward_id: p.p_selected_reward_id,
      p_items: p.p_items,
      p_promocao_id: p.p_promocao_id,
      p_valor_desconto_promocao: p.p_valor_desconto_promocao,
      p_pontos_extra_promocao: p.p_pontos_extra_promocao,
      p_promocao_meta: p.p_promocao_meta,
      p_promo_zera_frete: p.p_promo_zera_frete,
    });

    if (rpcError || !rpcResult?.pedido_id) {
      // Devolve pro estado "pending" pra uma proxima notificação do Mercado Pago
      // conseguir reivindicar e tentar criar o pedido de novo.
      await supabase
        .from("pagamentos_pix")
        .update({ status: "pending", atualizado_em: new Date().toISOString() })
        .eq("id", pagamento.id);
      return json({ error: rpcError?.message || "Falha ao criar pedido após pagamento aprovado" }, 500);
    }

    const pedidoId = String(rpcResult.pedido_id);

    await supabase
      .from("pagamentos_pix")
      .update({ pedido_id: pedidoId, atualizado_em: new Date().toISOString() })
      .eq("id", pagamento.id);

    // Confirmação por WhatsApp, no mesmo padrão do checkout tradicional (fire-and-forget).
    const telefone = String(p.p_cliente_telefone || "").trim();
    if (telefone) {
      try {
        const itens = Array.isArray(p.p_items) ? (p.p_items as Array<Record<string, unknown>>) : [];
        const produtoIds = Array.from(
          new Set(itens.map((item) => String(item.produto_id || item.produtoId || "")).filter(Boolean)),
        );
        let nomesPorId = new Map<string, string>();
        if (produtoIds.length > 0) {
          const { data: produtos } = await supabase.from("produtos").select("id, nome").in("id", produtoIds);
          nomesPorId = new Map((produtos || []).map((produto: { id: string; nome: string }) => [produto.id, produto.nome]));
        }
        const resumo = itens
          .map((item) => {
            const id = String(item.produto_id || item.produtoId || "");
            const nome = nomesPorId.get(id) || "Item";
            const quantidade = Number(item.quantidade || 1);
            return `${quantidade}x ${nome}`;
          })
          .join("\n");

        await supabase.functions.invoke("send-whatsapp", {
          body: {
            pedido_id: pedidoId,
            tipo_mensagem: "confirmado",
            telefone,
            dados_pedido: {
              nome: p.p_cliente_nome,
              itens: resumo,
              resumo,
              total: brl(Number(p.p_total || 0)),
            },
          },
        });
      } catch {
        // WhatsApp nunca pode bloquear a confirmação do pagamento.
      }
    }

    return json({ ok: true, status: "approved", pedido_id: pedidoId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});
