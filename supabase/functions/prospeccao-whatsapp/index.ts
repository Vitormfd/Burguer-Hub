// Webhook da instância comercial da Evolution (WhatsApp de prospecção do Easy Food Hub).
//
// - Mensagem do prospect: grava, detecta recusa (bloqueia na hora) e, se permitido, a IA
//   classifica a intenção e responde dentro das regras. Dúvidas sensíveis vão para humano.
// - Mensagem enviada pelo celular do operador: marca o primeiro contato ou, numa conversa já
//   em andamento, tira a IA da conversa (atendimento humano).
// - Números que não são prospects são ignorados.
//
// URL: /functions/v1/prospeccao-whatsapp?secret=<EVOLUTION_WEBHOOK_SECRET>
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type EvolutionWebhookPayload,
  evolutionSendText,
  parseEvolutionFromMe,
  parseEvolutionWebhook,
} from "../_shared/evolution.ts";
import {
  type Intencao,
  type PedidoEnvio,
  MENSAGEM_ENCERRAMENTO,
  autorizarEnvio,
  classificarErro,
  compararPreco,
  custoUsd,
  detectarRecusa,
  efeitoDaIntencao,
  extrairValorMensal,
  numeroWhatsapp,
  validarMensagem,
} from "../_shared/prospeccao/core.ts";
import {
  type ConfigCompleta,
  carregarConfig,
  contagensHoje,
  finalizarExecucao,
  iniciarExecucao,
  prospectPorTelefone,
  registrarEEnviar,
  registrarMensagem,
} from "../_shared/prospeccao/db.ts";
import { decidirResposta, iaDisponivel } from "../_shared/prospeccao/ia.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const ESPERA_AGRUPAR_MS = 8000;
const ORDEM_INTERESSE = { nenhum: 0, baixo: 1, medio: 2, alto: 3 } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Prospect = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function avisarOperador(cfg: ConfigCompleta, texto: string) {
  const destino = numeroWhatsapp(cfg.telefone_alertas);
  if (!destino) return;
  await evolutionSendText(cfg.evolution_instance, destino, `🔔 Prospecção Easy Food Hub\n${texto.slice(0, 600)}`).catch((err) =>
    console.error("Aviso ao operador falhou:", err instanceof Error ? err.message : err)
  );
}

async function mensagemDoOperador(sb: SupabaseClient, phone: string, text: string) {
  const p = await prospectPorTelefone(sb, phone);
  if (!p) return;
  // Eco de algo que nós mesmos enviamos pela API (agente ou botão do painel)?
  const desde = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data: eco } = await sb
    .from("prospect_mensagens")
    .select("id")
    .eq("prospect_id", p.id)
    .eq("direcao", "saida")
    .eq("texto", text)
    .gte("criado_em", desde)
    .limit(1);
  if (eco?.length) return;

  await registrarMensagem(sb, { prospect_id: p.id, direcao: "saida", autor: "operador", texto: text || "(mídia)" });
  const agora = new Date().toISOString();
  if (!p.contatado_em) {
    const status = ["novo", "qualificado"].includes(p.status) ? "contatado" : p.status;
    await sb.from("prospects").update({ status, contatado_em: agora, canal_contato: "whatsapp", proxima_acao: "Aguardar resposta", atualizado_em: agora }).eq("id", p.id);
  } else if (p.respondeu_em) {
    await sb.from("prospects").update({ atendimento_humano: true, proxima_acao: "Conversa com operador", atualizado_em: agora }).eq("id", p.id);
  }
}

async function encerrar(sb: SupabaseClient, cfg: ConfigCompleta, p: Prospect, recusa: "nao_contatar" | "sem_interesse") {
  const efeito = efeitoDaIntencao(recusa, p.status);
  const agora = new Date().toISOString();
  await sb
    .from("prospects")
    .update({
      status: efeito.status,
      bloqueado: true,
      interesse: "nenhum",
      atendimento_humano: false,
      proxima_acao: efeito.proximaAcao,
      motivo_desqualificacao: recusa === "nao_contatar" ? "pediu_para_nao_contatar" : "sem_interesse",
      atualizado_em: agora,
    })
    .eq("id", p.id);

  // Uma única mensagem educada de encerramento, nunca repetida.
  const { data: jaEncerrou } = await sb.from("prospect_mensagens").select("id").eq("prospect_id", p.id).eq("intencao", "encerramento").limit(1);
  if (jaEncerrou?.length || !cfg.responder_automatico) return;
  const aut = autorizarEnvio({
    origem: "agente",
    tipo: "encerramento",
    prospect: { ...p, bloqueado: true } as PedidoEnvio["prospect"],
    ultimaEntradaEm: agora,
    contatosHoje: 0,
    respostasIaHoje: 0,
    cfg,
    agora: new Date(),
  });
  if (!aut.ok) return;
  const texto = MENSAGEM_ENCERRAMENTO[recusa];
  await registrarEEnviar(
    sb,
    { prospect_id: p.id, direcao: "saida", autor: "agente", texto, intencao: "encerramento" },
    () => evolutionSendText(cfg.evolution_instance, numeroWhatsapp(p.telefone)!, texto),
  ).catch((err) => console.error("Encerramento não enviado:", err instanceof Error ? err.message : err));
}

async function mensagemDoProspect(sb: SupabaseClient, cfg: ConfigCompleta, phone: string, text: string, messageId?: string) {
  const p = await prospectPorTelefone(sb, phone);
  if (!p) return;

  if (messageId) {
    const { data: repetida } = await sb.from("prospect_mensagens").select("id").eq("external_id", messageId).limit(1);
    if (repetida?.length) return;
  }
  const minhaId = await registrarMensagem(sb, { prospect_id: p.id, direcao: "entrada", autor: "prospect", texto: text, external_id: messageId ?? null });
  const agora = new Date();
  await sb
    .from("prospects")
    .update({
      respondeu_em: p.respondeu_em ?? agora.toISOString(),
      status: ["novo", "qualificado", "contatado"].includes(p.status) ? "respondeu" : p.status,
      atualizado_em: agora.toISOString(),
    })
    .eq("id", p.id);

  // Recusa explícita: bloqueia já, mesmo se a IA estiver desligada ou fora do ar.
  const recusa = detectarRecusa(text);
  if (recusa) return encerrar(sb, cfg, p, recusa);

  if (p.bloqueado || ["nao_contatar", "sem_interesse"].includes(p.status)) return;
  if (p.atendimento_humano || !cfg.responder_automatico) {
    await sb.from("prospects").update({ proxima_acao: "Responder (atendimento humano)" }).eq("id", p.id);
    return;
  }

  // Quem manda várias mensagens seguidas recebe uma resposta só, para todas.
  await sleep(ESPERA_AGRUPAR_MS);
  const { data: ultima } = await sb
    .from("prospect_mensagens")
    .select("id")
    .eq("prospect_id", p.id)
    .eq("direcao", "entrada")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultima && ultima.id !== minhaId) return;

  const { data: atual } = await sb.from("prospects").select("*").eq("id", p.id).single();
  if (!atual || atual.atendimento_humano || atual.bloqueado) return;

  if (!iaDisponivel()) {
    await sb.from("prospects").update({ atendimento_humano: true, proxima_acao: "Responder (IA indisponível)" }).eq("id", p.id);
    await avisarOperador(cfg, `${atual.nome} respondeu e a IA está indisponível. Responda pelo WhatsApp comercial.`);
    return;
  }

  const { data: historico } = await sb
    .from("prospect_mensagens")
    .select("direcao, texto, criado_em")
    .eq("prospect_id", p.id)
    .is("erro", null)
    .order("criado_em", { ascending: false })
    .limit(20);
  const hist = (historico || []).reverse();
  const entradasRecentes = hist.filter((m) => m.direcao === "entrada").slice(-3).map((m) => m.texto).join("\n");
  const valorInformado = extrairValorMensal(entradasRecentes) ?? (atual.valor_concorrente ? Number(atual.valor_concorrente) : null);
  const comparacao = compararPreco(valorInformado, cfg.preco_mensal);

  const inicio = Date.now();
  const execId = await iniciarExecucao(sb, "conversa");
  let decisao = null;
  try {
    const r = await decidirResposta(atual, hist, cfg, comparacao);
    decisao = r.decisao;
    await finalizarExecucao(sb, execId, inicio, {
      status: "ok",
      tokens_entrada: r.uso.entrada,
      tokens_saida: r.uso.saida,
      custo_usd: custoUsd(r.uso),
      detalhes: { prospect_id: p.id, intencao: decisao?.intencao ?? null },
    });
  } catch (err) {
    const c = classificarErro(err);
    await finalizarExecucao(sb, execId, inicio, { status: "erro", erro: `${c.tipo}: ${c.mensagem}`.slice(0, 2000), detalhes: { prospect_id: p.id } });
  }

  if (!decisao) {
    await sb.from("prospects").update({ atendimento_humano: true, proxima_acao: "Responder (IA não decidiu)" }).eq("id", p.id);
    await avisarOperador(cfg, `${atual.nome} respondeu e a IA não conseguiu decidir. Responda pelo WhatsApp comercial.`);
    return;
  }

  const intencao = decisao.intencao as Intencao;
  await sb.from("prospect_mensagens").update({ intencao }).eq("id", minhaId);
  if (intencao === "nao_contatar" || intencao === "sem_interesse") return encerrar(sb, cfg, atual, intencao);

  const efeito = efeitoDaIntencao(intencao, atual.status);
  let humano = efeito.humano || decisao.precisa_humano;
  const valorConcorrente = decisao.valor_concorrente_mensal ?? valorInformado;
  const comp = compararPreco(valorConcorrente, cfg.preco_mensal);

  const { contatosHoje, respostasIaHoje } = await contagensHoje(sb, cfg);
  const aut = autorizarEnvio({
    origem: "agente",
    tipo: "resposta",
    prospect: atual,
    ultimaEntradaEm: new Date().toISOString(),
    contatosHoje,
    respostasIaHoje,
    cfg,
    agora: new Date(),
  });
  const v = validarMensagem(decisao.resposta, {
    tipo: "resposta",
    sistema: atual.sistema,
    sistemaConfianca: atual.sistema_confianca,
    precoMensal: cfg.preco_mensal,
    testeGratisDias: cfg.teste_gratis_dias,
    valoresPermitidos: comp ? [comp.valorConcorrente, Math.abs(comp.diferencaMensal), Math.abs(comp.diferencaAnual)] : [],
    envio: { agora: new Date(), fuso: cfg.fuso },
  });

  let bloqueio: string | null = null;
  if (!decisao.resposta.trim()) bloqueio = "IA não escreveu resposta";
  else if (!aut.ok) bloqueio = aut.motivo;
  else if (!v.ok) bloqueio = `resposta fora das regras (${v.problemas.join("; ")})`;

  if (!bloqueio) {
    try {
      await registrarEEnviar(
        sb,
        { prospect_id: p.id, direcao: "saida", autor: "agente", texto: v.texto, intencao },
        () => evolutionSendText(cfg.evolution_instance, numeroWhatsapp(atual.telefone)!, v.texto),
      );
    } catch (err) {
      bloqueio = `envio falhou: ${classificarErro(err).mensagem}`;
    }
  }
  if (bloqueio) humano = true;

  const interesseAtual = (atual.interesse || "nenhum") as keyof typeof ORDEM_INTERESSE;
  const interesseNovo = (efeito.interesse ?? decisao.interesse) as keyof typeof ORDEM_INTERESSE;
  await sb
    .from("prospects")
    .update({
      status: efeito.status,
      interesse: ORDEM_INTERESSE[interesseNovo] > ORDEM_INTERESSE[interesseAtual] ? interesseNovo : interesseAtual,
      atendimento_humano: humano,
      proxima_acao: bloqueio ? `Responder (${bloqueio})`.slice(0, 300) : efeito.proximaAcao,
      resumo_conversa: decisao.resumo.slice(0, 500),
      valor_concorrente: valorConcorrente ?? atual.valor_concorrente,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", p.id);

  if (humano) {
    await avisarOperador(cfg, `${atual.nome} (${atual.cidade ?? ""}): ${decisao.resumo}${bloqueio ? `\nIA não respondeu: ${bloqueio}` : ""}`);
  }
}

async function processar(sb: SupabaseClient, payload: EvolutionWebhookPayload) {
  const cfg = await carregarConfig(sb);
  if (!payload.instance || payload.instance !== cfg.evolution_instance) return;

  const doOperador = parseEvolutionFromMe(payload);
  if (doOperador) return mensagemDoOperador(sb, doOperador.phone, doOperador.text);

  const msg = parseEvolutionWebhook(payload);
  if (typeof msg === "string") return;
  return mensagemDoProspect(sb, cfg, msg.phone, msg.text, msg.messageId);
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") || "";
  if (!secret || new URL(req.url).searchParams.get("secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response("config", { status: 500 });
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const payload = (await req.json().catch(() => ({}))) as EvolutionWebhookPayload;
  const tarefa = processar(sb, payload).catch((err) => console.error("prospeccao-whatsapp:", err instanceof Error ? err.message : err));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(tarefa);
  else await tarefa;
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
