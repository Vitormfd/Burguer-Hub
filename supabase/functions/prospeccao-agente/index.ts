// Agente de prospecção do Easy Food Hub.
//
// Chamadas aceitas (POST, body { acao, ... }):
//   - Cron (pg_cron a cada 5 min, header x-cron-secret = PROSPECCAO_CRON_SECRET): { acao: "tick" }.
//     Só trabalha dentro da agenda, das metas e dos limites de gasto configurados no painel.
//   - Painel (JWT de um usuário em prospeccao_admins):
//       executar_agora            roda um ciclo de descoberta fora da agenda (respeita gastos)
//       gerar_mensagem            reescreve a mensagem sugerida de um prospect
//       enviar                    envia primeiro contato / follow-up pelo WhatsApp comercial
//       registrar_contato_manual  marca como contatado quando o envio foi feito fora daqui
//       whatsapp_status | whatsapp_conectar | whatsapp_desconectar
//
// O primeiro contato NUNCA sai sozinho: o cron só descobre, qualifica e prepara a mensagem.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type BuscaPlanejada,
  type EstabelecimentoBruto,
  type MotivoPausa,
  type ProspectDados,
  DIAS_PARA_FOLLOWUP,
  aberturaDe,
  autorizarEnvio,
  classificarErro,
  custoUsd,
  decidirExecucao,
  ehCelular,
  mensagemFollowup,
  mensagemReserva,
  normalizarTelefoneBR,
  normalizarTexto,
  numeroWhatsapp,
  prepararProspect,
  proximaBusca,
  proximaExecucao,
  validarMensagem,
} from "../_shared/prospeccao/core.ts";
import {
  type ConfigCompleta,
  atualizarEstado,
  carregarConfig,
  contagensHoje,
  finalizarExecucao,
  haExecucaoRodando,
  iniciarExecucao,
  limparExecucoesTravadas,
  registrarEEnviar,
  registrarMensagem,
  salvarProspect,
  usoAtual,
} from "../_shared/prospeccao/db.ts";
import { type ProspectParaMensagem, iaDisponivel, pesquisarEstabelecimentos, redigirMensagens } from "../_shared/prospeccao/ia.ts";
import { buscarNoMaps, placesDisponivel } from "../_shared/prospeccao/places.ts";
import {
  evolutionConnect,
  evolutionCreateInstance,
  evolutionInstanceInfo,
  evolutionLogout,
  evolutionSendText,
  evolutionSetWebhook,
} from "../_shared/evolution.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const emSegundoPlano = (p: Promise<unknown>) => {
  const seguro = p.catch((err) => console.error("prospeccao-agente:", err instanceof Error ? err.message : err));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(seguro);
  return seguro;
};

const ESTADO_POR_MOTIVO: Record<MotivoPausa, string> = {
  pausado: "pausado",
  fora_da_agenda: "aguardando_agenda",
  tempo_diario_esgotado: "tempo_diario_esgotado",
  limite_gasto_diario: "limite_gasto_diario",
  limite_gasto_mensal: "limite_gasto_mensal",
  limite_buscas_web: "limite_buscas_web",
  meta_qualificados_atingida: "meta_atingida",
};

// ---------------------------------------------------------------------------------------------
// Alertas ao operador
// ---------------------------------------------------------------------------------------------

async function alertar(sb: SupabaseClient, cfg: ConfigCompleta, texto: string) {
  const agora = new Date();
  await atualizarEstado(sb, { ultimo_erro: texto.slice(0, 1000), ultimo_erro_em: agora.toISOString() });
  const destino = numeroWhatsapp(cfg.telefone_alertas);
  const ultimo = cfg.ultimo_alerta_em ? new Date(cfg.ultimo_alerta_em).getTime() : 0;
  if (!destino || agora.getTime() - ultimo < 6 * 3600 * 1000) return;
  try {
    await evolutionSendText(cfg.evolution_instance, destino, `⚠️ Agente de prospecção Easy Food Hub\n${texto.slice(0, 500)}`);
    await atualizarEstado(sb, { ultimo_alerta_em: agora.toISOString() });
  } catch (err) {
    console.error("Alerta não enviado:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------------------------
// Pesquisas: histórico e cauda longa de cidades (IBGE)
// ---------------------------------------------------------------------------------------------

async function todasAsLinhas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await consulta(de, de + 999);
    todas.push(...(data || []));
    if (!data || data.length < 1000) return todas;
  }
}

async function carregarMunicipiosIbge(sb: SupabaseClient, ufs: string[]) {
  for (const uf of ufs) {
    const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`IBGE HTTP ${res.status} (${uf})`);
    const lista = (await res.json()) as { nome: string }[];
    const linhas = lista.map((m) => ({ uf, nome: m.nome }));
    for (let i = 0; i < linhas.length; i += 500) {
      await sb.from("prospeccao_municipios").upsert(linhas.slice(i, i + 500), { onConflict: "uf,nome", ignoreDuplicates: true });
    }
  }
}

const TODAS_UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

async function planejarBusca(sb: SupabaseClient, cfg: ConfigCompleta): Promise<BuscaPlanejada | null> {
  const desde = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const feitas = await todasAsLinhas<{ chave: string }>((de, ate) =>
    sb.from("prospeccao_buscas").select("chave").gte("executada_em", desde).order("executada_em").range(de, ate)
  );
  const jaFeitas = new Set(feitas.map((f) => f.chave));
  const contador = feitas.length;

  const comExtras = async () => {
    const ufs = cfg.estados.length ? cfg.estados.map((u) => u.toUpperCase()) : TODAS_UFS;
    const municipios = await todasAsLinhas<{ uf: string; nome: string }>((de, ate) =>
      sb.from("prospeccao_municipios").select("uf, nome").in("uf", ufs).order("nome").range(de, ate)
    );
    // Alterna estados na cauda longa também.
    const porUf = new Map<string, [string, string][]>();
    for (const m of municipios) porUf.set(m.uf, [...(porUf.get(m.uf) || []), [m.nome, m.uf]]);
    const extras: [string, string][] = [];
    const maior = Math.max(0, ...[...porUf.values()].map((l) => l.length));
    for (let i = 0; i < maior; i++) for (const l of porUf.values()) if (l[i]) extras.push(l[i]);
    return { extras, ufs, carregados: new Set(municipios.map((m) => m.uf)) };
  };

  let busca = proximaBusca(cfg, jaFeitas, [], contador);
  if (busca || cfg.cidades.length) return busca;

  // Capitais e polos esgotados: segue para os demais municípios (IBGE).
  const primeira = await comExtras();
  let extras = primeira.extras;
  const faltam = primeira.ufs.filter((u) => !primeira.carregados.has(u));
  if (faltam.length) {
    await carregarMunicipiosIbge(sb, faltam.slice(0, 6));
    ({ extras } = await comExtras());
  }
  busca = proximaBusca(cfg, jaFeitas, extras, contador);
  return busca;
}

// ---------------------------------------------------------------------------------------------
// Ciclo de descoberta
// ---------------------------------------------------------------------------------------------

function juntarComMaps(
  achados: EstabelecimentoBruto[],
  maps: Awaited<ReturnType<typeof buscarNoMaps>>,
  busca: BuscaPlanejada,
): EstabelecimentoBruto[] {
  const lista = [...achados];
  for (const m of maps) {
    const nomeM = normalizarTexto(m.nome);
    const telM = normalizarTelefoneBR(m.telefone);
    const par = lista.find((e) => {
      const n = normalizarTexto(e.nome);
      return (telM && normalizarTelefoneBR(e.telefone) === telM) || (n.length > 3 && (n.includes(nomeM) || nomeM.includes(n)));
    });
    const sinaisMaps = { avaliacoes: m.avaliacoes, aberto: m.aberto };
    const evid = { tipo: "maps" as const, url: `https://www.google.com/maps/place/?q=place_id:${m.placeId}`, trecho: `Google Maps: ${m.nome}${m.endereco ? `, ${m.endereco}` : ""}` };
    if (par) {
      par.google_place_id = m.placeId;
      par.telefone ||= m.telefone;
      par.site ||= m.site;
      par.links = [...(par.links || []), ...(m.site ? [m.site] : [])];
      par.sinais = { ...(par.sinais || {}), ...Object.fromEntries(Object.entries(sinaisMaps).filter(([, v]) => v !== null)) };
      par.evidencias = [...(par.evidencias || []), evid];
    } else {
      lista.push({
        nome: m.nome,
        categoria: busca.especialidade,
        cidade: busca.cidade,
        uf: busca.uf,
        telefone: m.telefone,
        site: m.site,
        links: m.site ? [m.site] : [],
        google_place_id: m.placeId,
        evidencias: [evid],
        sinais: sinaisMaps,
        fonte: "google_maps",
      });
    }
  }
  return lista;
}

async function prepararMensagens(sb: SupabaseClient, cfg: ConfigCompleta, ids: string[]) {
  if (!ids.length) return { entrada: 0, saida: 0, cacheLeitura: 0, buscasWeb: 0 };
  const { data: prospects } = await sb
    .from("prospects")
    .select("id, nome, categoria, cidade, bairro, sistema, sistema_confianca, sinais, evidencias, telefone, instagram, status")
    .in("id", ids);
  const alvo = (prospects || []).filter((p) => p.status === "qualificado");
  if (!alvo.length) return { entrada: 0, saida: 0, cacheLeitura: 0, buscasWeb: 0 };

  const { data: recentes } = await sb.from("prospects").select("mensagem_sugerida").not("mensagem_sugerida", "is", null).order("mensagem_gerada_em", { ascending: false }).limit(20);
  const aberturas = (recentes || []).map((r) => aberturaDe(r.mensagem_sugerida));

  const lista: ProspectParaMensagem[] = alvo.map((p) => ({
    id: p.id,
    nome: p.nome,
    categoria: p.categoria,
    cidade: p.cidade,
    bairro: p.bairro,
    sistema: p.sistema,
    sistema_confianca: p.sistema_confianca,
    canal: ehCelular(p.telefone) ? "whatsapp" : "instagram",
    sinais: p.sinais || {},
    evidencias: p.evidencias || [],
  }));

  let geradas = new Map<string, string>();
  let uso = { entrada: 0, saida: 0, cacheLeitura: 0, buscasWeb: 0 };
  try {
    ({ mensagens: geradas, uso } = await redigirMensagens(lista, cfg, aberturas));
  } catch (err) {
    console.error("Mensagens pela IA falharam, usando modelo de reserva:", err instanceof Error ? err.message : err);
  }

  for (const p of alvo) {
    const ctx = { tipo: "primeiro_contato" as const, sistema: p.sistema, sistemaConfianca: p.sistema_confianca, precoMensal: cfg.preco_mensal, testeGratisDias: cfg.teste_gratis_dias };
    let v = validarMensagem(geradas.get(p.id) || "", ctx);
    if (!v.ok) v = validarMensagem(mensagemReserva(p, cfg, p.id), ctx);
    await sb
      .from("prospects")
      .update({
        mensagem_sugerida: v.texto,
        mensagem_gerada_em: new Date().toISOString(),
        canal_contato: ehCelular(p.telefone) ? "whatsapp" : "instagram",
        proxima_acao: "Enviar primeiro contato",
      })
      .eq("id", p.id);
  }
  return uso;
}

async function cicloDescoberta(sb: SupabaseClient, manual: boolean): Promise<Record<string, unknown>> {
  await limparExecucoesTravadas(sb);
  const cfg = await carregarConfig(sb);
  const agora = new Date();
  const uso = await usoAtual(sb, cfg, agora);

  await marcarFollowups(sb);

  const decisao = decidirExecucao(cfg, agora, uso, { manual });
  if (!decisao.executar) {
    await atualizarEstado(sb, {
      estado: ESTADO_POR_MOTIVO[decisao.motivo],
      proxima_execucao_em: proximaExecucao(cfg, decisao.motivo, agora)?.toISOString() ?? null,
    });
    return { executou: false, motivo: decisao.motivo };
  }
  if (!iaDisponivel()) {
    await alertar(sb, cfg, "configuracao: ANTHROPIC_API_KEY não está configurada nas Edge Functions.");
    await atualizarEstado(sb, { estado: "erro" });
    return { executou: false, motivo: "ia_indisponivel" };
  }
  if (await haExecucaoRodando(sb)) return { executou: false, motivo: "em_andamento" };

  const busca = await planejarBusca(sb, cfg);
  if (!busca) {
    await atualizarEstado(sb, { estado: "sem_novas_buscas" });
    return { executou: false, motivo: "sem_novas_buscas" };
  }

  const inicio = Date.now();
  const execId = await iniciarExecucao(sb, manual ? "manual" : "descoberta", busca.consulta);
  await atualizarEstado(sb, { estado: "executando", ultima_execucao_em: agora.toISOString() });

  let chamadasPlaces = 0;
  let usoIa = { entrada: 0, saida: 0, cacheLeitura: 0, buscasWeb: 0 };
  try {
    let maps: Awaited<ReturnType<typeof buscarNoMaps>> = [];
    if (placesDisponivel() && busca.publico === "A" && uso.placesHoje < cfg.limite_places_dia) {
      chamadasPlaces = 1;
      try {
        maps = await buscarNoMaps(`${busca.especialidade} em ${busca.cidade} ${busca.uf}`);
      } catch (err) {
        const c = classificarErro(err);
        if (c.tipo === "autenticacao") await alertar(sb, cfg, `Google Places recusou a chave: ${c.mensagem}`);
        else console.error("Google Places:", c.mensagem);
      }
    }

    const { data: daCidade } = await sb.from("prospects").select("nome").eq("uf", busca.uf).ilike("cidade", busca.cidade).limit(60);
    const pesquisa = await pesquisarEstabelecimentos(busca, (daCidade || []).map((p) => p.nome), maps);
    usoIa = pesquisa.uso;

    const brutos = juntarComMaps(pesquisa.estabelecimentos, maps, busca);
    let novos = 0;
    const qualificados: string[] = [];
    const resumo: { nome: string; status: string; sistema: string; pontuacao: number; novo: boolean }[] = [];
    for (const e of brutos) {
      const dados: ProspectDados = prepararProspect(e, cfg, busca.publico);
      const r = await salvarProspect(sb, dados, cfg, busca.consulta);
      if (r.novo) novos++;
      if (r.qualificadoAgora) qualificados.push(r.id);
      resumo.push({ nome: dados.nome, status: r.status, sistema: dados.sistema, pontuacao: dados.pontuacao, novo: r.novo });
    }

    const usoMsg = await prepararMensagens(sb, cfg, qualificados);
    const custo = custoUsd({
      entrada: usoIa.entrada + usoMsg.entrada,
      saida: usoIa.saida + usoMsg.saida,
      cacheLeitura: usoIa.cacheLeitura + usoMsg.cacheLeitura,
      buscasWeb: usoIa.buscasWeb,
      places: chamadasPlaces,
    });

    await sb.from("prospeccao_buscas").upsert(
      {
        chave: busca.chave,
        consulta: busca.consulta,
        especialidade: busca.especialidade,
        cidade: busca.cidade,
        uf: busca.uf,
        publico: busca.publico,
        fonte: maps.length ? "ia+google_maps" : "ia_web",
        executada_em: new Date().toISOString(),
        encontrados: brutos.length,
        novos,
        custo_usd: custo,
      },
      { onConflict: "chave" },
    );

    await finalizarExecucao(sb, execId, inicio, {
      status: "ok",
      encontrados: brutos.length,
      novos,
      qualificados: qualificados.length,
      tokens_entrada: usoIa.entrada + usoMsg.entrada,
      tokens_saida: usoIa.saida + usoMsg.saida,
      buscas_web: usoIa.buscasWeb,
      chamadas_places: chamadasPlaces,
      custo_usd: custo,
      detalhes: { busca, resultados: resumo },
    });
    await atualizarEstado(sb, {
      estado: cfg.ativo ? "ativo" : "pausado",
      ultimo_erro: null,
      proxima_execucao_em: proximaExecucao(cfg, null, new Date())?.toISOString() ?? null,
    });
    return { executou: true, consulta: busca.consulta, encontrados: brutos.length, novos, qualificados: qualificados.length, custo_usd: custo };
  } catch (err) {
    const c = classificarErro(err);
    const custo = custoUsd({ ...usoIa, places: chamadasPlaces });
    await finalizarExecucao(sb, execId, inicio, {
      status: "erro",
      erro: `${c.tipo}: ${c.mensagem}`.slice(0, 2000),
      buscas_web: usoIa.buscasWeb,
      chamadas_places: chamadasPlaces,
      tokens_entrada: usoIa.entrada,
      tokens_saida: usoIa.saida,
      custo_usd: custo,
      detalhes: { busca },
    });
    // Erro "comum" na mesma busca não pode travar o agente em loop: registra e segue.
    if (c.tipo === "outro") {
      await sb.from("prospeccao_buscas").upsert(
        { chave: busca.chave, consulta: busca.consulta, especialidade: busca.especialidade, cidade: busca.cidade, uf: busca.uf, publico: busca.publico, fonte: "erro", executada_em: new Date().toISOString(), custo_usd: custo },
        { onConflict: "chave" },
      );
    }
    await atualizarEstado(sb, { estado: "erro", proxima_execucao_em: proximaExecucao(cfg, null, new Date())?.toISOString() ?? null });
    const textoAlerta: Record<string, string> = {
      autenticacao: "A chave da Anthropic foi recusada (autenticação). O agente não consegue pesquisar até a chave ser corrigida.",
      limite: "Limite de uso da API da Anthropic atingido. O agente tenta de novo nos próximos ciclos.",
      configuracao: `Configuração incompleta: ${c.mensagem}`,
      indisponivel: `Serviço externo indisponível: ${c.mensagem}`,
      outro: `Erro na pesquisa "${busca.consulta}": ${c.mensagem}`,
    };
    await alertar(sb, cfg, textoAlerta[c.tipo]);
    return { executou: false, motivo: "erro", erro: c };
  }
}

/** Contatados há alguns dias sem resposta entram na fila de follow-up (máximo 1). */
async function marcarFollowups(sb: SupabaseClient) {
  const limite = new Date(Date.now() - DIAS_PARA_FOLLOWUP * 24 * 3600 * 1000).toISOString();
  const { data } = await sb
    .from("prospects")
    .select("id")
    .eq("status", "contatado")
    .eq("followups", 0)
    .eq("bloqueado", false)
    .is("respondeu_em", null)
    .lt("contatado_em", limite)
    .or('proxima_acao.is.null,proxima_acao.neq."Enviar follow-up"')
    .limit(200);
  for (const p of data || []) {
    await sb.from("prospects").update({ proxima_acao: "Enviar follow-up", mensagem_sugerida: mensagemFollowup(p.id) }).eq("id", p.id);
  }
}

// ---------------------------------------------------------------------------------------------
// Ações do painel
// ---------------------------------------------------------------------------------------------

const webhookProspeccao = () => {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const secret = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") || "";
  if (!url || !secret) throw new Error("SUPABASE_URL ou EVOLUTION_WEBHOOK_SECRET ausente");
  return `${url}/functions/v1/prospeccao-whatsapp?secret=${encodeURIComponent(secret)}`;
};

async function enviar(sb: SupabaseClient, body: { prospect_id?: string; texto?: string; tipo?: string }) {
  const cfg = await carregarConfig(sb);
  const { data: p } = await sb.from("prospects").select("*").eq("id", body.prospect_id).maybeSingle();
  if (!p) return { ok: false, error: "Prospect não encontrado" };
  const tipo = body.tipo === "followup" ? "followup" : body.tipo === "resposta" ? "resposta" : "primeiro_contato";

  const { data: ultimaEntrada } = await sb
    .from("prospect_mensagens")
    .select("criado_em")
    .eq("prospect_id", p.id)
    .eq("direcao", "entrada")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { contatosHoje, respostasIaHoje } = await contagensHoje(sb, cfg);

  const aut = autorizarEnvio({
    origem: "operador",
    tipo,
    prospect: p,
    ultimaEntradaEm: ultimaEntrada?.criado_em ?? null,
    contatosHoje,
    respostasIaHoje,
    cfg,
    agora: new Date(),
  });
  if (!aut.ok) return { ok: false, error: aut.motivo };

  const v = validarMensagem(body.texto || "", {
    tipo,
    sistema: p.sistema,
    sistemaConfianca: p.sistema_confianca,
    precoMensal: cfg.preco_mensal,
    testeGratisDias: cfg.teste_gratis_dias,
    valoresPermitidos: p.valor_concorrente ? [Number(p.valor_concorrente)] : [],
  });
  if (!v.ok) return { ok: false, error: `Mensagem fora das regras: ${v.problemas.join("; ")}`, problemas: v.problemas };

  const numero = numeroWhatsapp(p.telefone)!;
  try {
    await registrarEEnviar(
      sb,
      { prospect_id: p.id, direcao: "saida", autor: "operador", texto: v.texto, intencao: tipo },
      () => evolutionSendText(cfg.evolution_instance, numero, v.texto),
    );
  } catch (err) {
    const c = classificarErro(err);
    if (c.tipo === "autenticacao" || c.tipo === "configuracao") await alertar(sb, cfg, `WhatsApp comercial: ${c.mensagem}`);
    return { ok: false, error: `WhatsApp: ${c.mensagem}` };
  }
  const agora = new Date().toISOString();
  const campos: Record<string, unknown> =
    tipo === "primeiro_contato"
      ? { status: "contatado", contatado_em: agora, canal_contato: "whatsapp", proxima_acao: "Aguardar resposta" }
      : tipo === "followup"
        ? { followups: (p.followups || 0) + 1, proxima_acao: "Aguardar resposta" }
        : { atendimento_humano: true, proxima_acao: "Conversa com operador" };
  await sb.from("prospects").update({ ...campos, atualizado_em: agora }).eq("id", p.id);
  return { ok: true, texto: v.texto };
}

async function registrarContatoManual(sb: SupabaseClient, body: { prospect_id?: string; canal?: string; texto?: string }) {
  const { data: p } = await sb.from("prospects").select("id, status, bloqueado, contatado_em").eq("id", body.prospect_id).maybeSingle();
  if (!p) return { ok: false, error: "Prospect não encontrado" };
  if (p.bloqueado || ["nao_contatar", "sem_interesse", "desqualificado"].includes(p.status)) {
    return { ok: false, error: "Estabelecimento bloqueado para novos contatos" };
  }
  const canal = body.canal === "instagram" ? "instagram" : body.canal === "email" ? "email" : "whatsapp";
  await registrarMensagem(sb, { prospect_id: p.id, direcao: "saida", autor: "operador", canal, texto: body.texto || "(enviado fora do painel)" });
  if (!p.contatado_em) {
    await sb
      .from("prospects")
      .update({ status: "contatado", contatado_em: new Date().toISOString(), canal_contato: canal, proxima_acao: "Aguardar resposta" })
      .eq("id", p.id);
  }
  return { ok: true };
}

async function gerarMensagem(sb: SupabaseClient, prospectId: string) {
  const cfg = await carregarConfig(sb);
  const { data: p } = await sb.from("prospects").select("id, status").eq("id", prospectId).maybeSingle();
  if (!p) return { ok: false, error: "Prospect não encontrado" };
  if (p.status !== "qualificado") {
    await sb.from("prospects").update({ status: "qualificado" }).eq("id", prospectId).eq("status", "novo");
  }
  const uso = await prepararMensagens(sb, cfg, [prospectId]);
  const custo = custoUsd(uso);
  if (custo > 0) {
    const execId = await iniciarExecucao(sb, "mensagem");
    await finalizarExecucao(sb, execId, Date.now(), { status: "ok", tokens_entrada: uso.entrada, tokens_saida: uso.saida, custo_usd: custo });
  }
  const { data } = await sb.from("prospects").select("mensagem_sugerida").eq("id", prospectId).single();
  return { ok: true, mensagem: data?.mensagem_sugerida };
}

async function whatsapp(sb: SupabaseClient, acao: string) {
  const cfg = await carregarConfig(sb);
  const instancia = cfg.evolution_instance;
  if (acao === "whatsapp_status") {
    const info = await evolutionInstanceInfo(instancia);
    return { ok: true, instancia, existe: Boolean(info), estado: info?.state ?? "inexistente", telefone: info?.phone ?? null };
  }
  if (acao === "whatsapp_desconectar") {
    await evolutionLogout(instancia);
    return { ok: true };
  }
  const url = webhookProspeccao();
  const info = await evolutionInstanceInfo(instancia);
  if (!info) await evolutionCreateInstance(instancia, url);
  else await evolutionSetWebhook(instancia, url);
  if (info?.state === "open") return { ok: true, conectado: true, telefone: info.phone };
  const qr = await evolutionConnect(instancia);
  return { ok: true, conectado: !qr, qr };
}

// ---------------------------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Configuração interna ausente" }, 500);
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const body = (await req.json().catch(() => ({}))) as { acao?: string; prospect_id?: string; texto?: string; tipo?: string; canal?: string };
  const acao = body.acao || "tick";

  const cronSecret = Deno.env.get("PROSPECCAO_CRON_SECRET") || "";
  const isCron = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;

  if (isCron) {
    if (acao !== "tick") return json({ ok: false, error: "Ação não permitida para o cron" }, 403);
    // Responde na hora (o pg_net espera pouco) e trabalha em segundo plano.
    emSegundoPlano(cicloDescoberta(sb, false));
    return json({ ok: true, aceito: true }, 202);
  }

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await sb.auth.getUser(jwt);
  const userId = userData?.user?.id;
  if (!userId) return json({ ok: false, error: "Não autorizado" }, 401);
  const { data: admin } = await sb.from("prospeccao_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (!admin) return json({ ok: false, error: "Acesso restrito ao administrador da prospecção" }, 403);

  try {
    switch (acao) {
      case "executar_agora":
        emSegundoPlano(cicloDescoberta(sb, true));
        return json({ ok: true, aceito: true });
      case "gerar_mensagem":
        return json(await gerarMensagem(sb, String(body.prospect_id)));
      case "enviar":
        return json(await enviar(sb, body));
      case "registrar_contato_manual":
        return json(await registrarContatoManual(sb, body));
      case "whatsapp_status":
      case "whatsapp_conectar":
      case "whatsapp_desconectar":
        return json(await whatsapp(sb, acao));
      default:
        return json({ ok: false, error: `Ação desconhecida: ${acao}` }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
