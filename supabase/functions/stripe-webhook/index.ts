// Webhook da Stripe: mantém a tabela assinaturas em dia com os pagamentos.
// Endpoint (cadastrar na Stripe > Developers > Webhooks):
//   https://<projeto>.supabase.co/functions/v1/stripe-webhook
// Eventos: checkout.session.completed, customer.subscription.created/updated/deleted
// Secret: STRIPE_WEBHOOK_SECRET (whsec_..., mostrado pela Stripe ao criar o endpoint).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type EventoStripe, interpretarEvento, verificarAssinaturaStripe } from "../_shared/stripe.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const segredo = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const corpo = await req.text();
  if (!(await verificarAssinaturaStripe(corpo, req.headers.get("stripe-signature"), segredo))) {
    return json({ error: "Assinatura inválida" }, 400);
  }

  const evento = JSON.parse(corpo) as EventoStripe;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // A Stripe reenvia eventos: o id do evento garante que cada um é aplicado uma vez só.
  const { data: novo } = await sb
    .from("stripe_eventos")
    .upsert({ id: evento.id, tipo: evento.type, payload: evento }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (!novo?.length) {
    const { data: antigo } = await sb.from("stripe_eventos").select("processado").eq("id", evento.id).maybeSingle();
    if (antigo?.processado) return json({ ok: true, repetido: true });
  }

  const acao = interpretarEvento(evento);
  let ownerId: string | null = null;
  let email: string | null = null;
  let erro: string | null = null;

  try {
    if (acao.tipo === "vincular") {
      email = acao.email;
      ownerId = acao.ownerId;
      if (!ownerId && email) {
        const { data } = await sb.rpc("owner_por_email", { p_email: email });
        ownerId = (data as string | null) ?? null;
      }
      if (!ownerId) {
        // Pagou sem estar logado e com e-mail que não tem conta: fica para o administrador vincular.
        erro = "Pagamento sem conta vinculada (sem client_reference_id e e-mail não cadastrado)";
      } else {
        const { error } = await sb.from("assinaturas").upsert(
          {
            owner_id: ownerId,
            stripe_customer_id: acao.customer,
            stripe_subscription_id: acao.subscription,
            stripe_status: acao.status,
            email_pagamento: email,
            atualizado_em: new Date().toISOString(),
          },
          { onConflict: "owner_id" },
        );
        if (error) erro = error.message;
      }
    } else if (acao.tipo === "atualizar") {
      const campos = {
        stripe_status: acao.status,
        periodo_fim: acao.periodoFim,
        cancela_no_fim: acao.cancelaNoFim,
        atualizado_em: new Date().toISOString(),
      };
      const { data, error } = await sb
        .from("assinaturas")
        .update(campos)
        .eq("stripe_subscription_id", acao.subscription)
        .select("owner_id");
      if (error) erro = error.message;
      else if (data?.length) ownerId = data[0].owner_id as string;
      else if (acao.customer) {
        // Evento chegou antes do checkout.session.completed: tenta pelo cliente da Stripe.
        const r = await sb
          .from("assinaturas")
          .update({ ...campos, stripe_subscription_id: acao.subscription })
          .eq("stripe_customer_id", acao.customer)
          .select("owner_id");
        if (r.error) erro = r.error.message;
        else ownerId = (r.data?.[0]?.owner_id as string | undefined) ?? null;
      }
    }
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  await sb
    .from("stripe_eventos")
    .update({ processado: !erro, erro: erro ?? (acao.tipo === "ignorar" ? acao.motivo : null), owner_id: ownerId, email })
    .eq("id", evento.id);

  // 200 mesmo sem conta vinculada: reenviar não resolveria. Erro de banco devolve 500 para a Stripe tentar de novo.
  const falhaDeBanco = Boolean(erro) && !erro!.startsWith("Pagamento sem conta");
  return json({ ok: !falhaDeBanco, acao: acao.tipo, erro }, falhaDeBanco ? 500 : 200);
});
