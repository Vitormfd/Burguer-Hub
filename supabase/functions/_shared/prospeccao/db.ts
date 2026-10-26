// Acesso ao banco do agente de prospecção (service role nas Edge Functions).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type ConfigProspeccao,
  type ProspectDados,
  type UsoHoje,
  chavesDedup,
  inicioDoPeriodo,
  mesclarProspect,
  normalizarTelefoneBR,
} from "./core.ts";

export type ConfigCompleta = ConfigProspeccao & {
  evolution_instance: string;
  telefone_alertas: string;
  cotacao_dolar: number;
  estado: string;
  ultimo_alerta_em: string | null;
};

export async function carregarConfig(sb: SupabaseClient): Promise<ConfigCompleta> {
  const { data, error } = await sb.from("prospeccao_config").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`Config da prospecção: ${error.message}`);
  if (!data) throw new Error("Config da prospecção ausente (rode a migration)");
  return {
    ...data,
    hora_inicio: String(data.hora_inicio).slice(0, 5),
    hora_fim: String(data.hora_fim).slice(0, 5),
    preco_mensal: Number(data.preco_mensal),
    limite_gasto_diario_usd: Number(data.limite_gasto_diario_usd),
    limite_gasto_mensal_usd: Number(data.limite_gasto_mensal_usd),
    cotacao_dolar: Number(data.cotacao_dolar),
    dias_semana: (data.dias_semana || []).map(Number),
    especialidades: data.especialidades || [],
    estados: data.estados || [],
    cidades: data.cidades || [],
  } as ConfigCompleta;
}

export async function atualizarEstado(sb: SupabaseClient, campos: Record<string, unknown>) {
  await sb.from("prospeccao_config").update(campos).eq("id", 1);
}

export async function usoAtual(sb: SupabaseClient, cfg: ConfigProspeccao, agora = new Date()): Promise<UsoHoje & { placesHoje: number }> {
  const dia = inicioDoPeriodo(agora, cfg.fuso, "dia").toISOString();
  const mes = inicioDoPeriodo(agora, cfg.fuso, "mes").toISOString();
  const [{ data: execMes }, { count: qualificadosHoje }] = await Promise.all([
    sb.from("prospeccao_execucoes").select("iniciada_em, duracao_ms, custo_usd, buscas_web, chamadas_places, tipo").gte("iniciada_em", mes).limit(10000),
    sb
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .gte("descoberto_em", dia)
      .not("status", "in", "(novo,desqualificado)"),
  ]);
  const uso = { minutosHoje: 0, custoHojeUsd: 0, custoMesUsd: 0, buscasWebHoje: 0, placesHoje: 0, qualificadosHoje: qualificadosHoje || 0 };
  for (const e of execMes || []) {
    const custo = Number(e.custo_usd) || 0;
    uso.custoMesUsd += custo;
    if (e.iniciada_em >= dia) {
      uso.custoHojeUsd += custo;
      uso.buscasWebHoje += Number(e.buscas_web) || 0;
      uso.placesHoje += Number(e.chamadas_places) || 0;
      if (e.tipo === "descoberta") uso.minutosHoje += (Number(e.duracao_ms) || 0) / 60000;
    }
  }
  return uso;
}

export async function iniciarExecucao(sb: SupabaseClient, tipo: string, consulta?: string): Promise<string> {
  const { data, error } = await sb.from("prospeccao_execucoes").insert({ tipo, consulta: consulta ?? null }).select("id").single();
  if (error) throw new Error(`Registro de execução: ${error.message}`);
  return data.id as string;
}

export async function finalizarExecucao(
  sb: SupabaseClient,
  id: string,
  inicio: number,
  campos: Record<string, unknown> & { status: "ok" | "erro" | "pulada" },
) {
  await sb
    .from("prospeccao_execucoes")
    .update({ ...campos, finalizada_em: new Date().toISOString(), duracao_ms: Date.now() - inicio })
    .eq("id", id);
}

/** Execuções "rodando" há mais de 10 min morreram (timeout/reinício): marca como erro. */
export async function limparExecucoesTravadas(sb: SupabaseClient) {
  const limite = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await sb
    .from("prospeccao_execucoes")
    .update({ status: "erro", erro: "Interrompida (tempo limite ou reinício do serviço)", finalizada_em: new Date().toISOString() })
    .eq("status", "rodando")
    .lt("iniciada_em", limite);
}

export async function haExecucaoRodando(sb: SupabaseClient): Promise<boolean> {
  const { count } = await sb
    .from("prospeccao_execucoes")
    .select("id", { count: "exact", head: true })
    .eq("status", "rodando")
    .in("tipo", ["descoberta", "manual"]);
  return (count || 0) > 0;
}

const CAMPOS_PROSPECT =
  "id, nome, categoria, cidade, uf, bairro, instagram, facebook, site, telefone, email, link_cardapio, google_place_id, sistema, sistema_confianca, evidencias, sinais, pontuacao, pontuacao_detalhes, prioridade, publico, status, motivo_desqualificacao, fonte, bloqueado";

export interface ResultadoSalvar {
  id: string;
  novo: boolean;
  status: string;
  qualificadoAgora: boolean;
}

/**
 * Salva com deduplicação: se qualquer identificador (telefone, @, facebook, domínio, link de
 * cardápio, place id, nome+cidade) já existe, mescla no prospect existente.
 */
export async function salvarProspect(
  sb: SupabaseClient,
  dados: ProspectDados,
  cfg: ConfigProspeccao,
  consulta: string | null,
): Promise<ResultadoSalvar> {
  const chaves = chavesDedup(dados);
  const valores = [...new Set(chaves.map((c) => c.valor))];
  let existenteId: string | null = null;
  if (valores.length) {
    const { data: achados } = await sb.from("prospect_identificadores").select("prospect_id, tipo, valor").in("valor", valores);
    const casados = (achados || []).filter((a: { tipo: string; valor: string }) => chaves.some((c) => c.tipo === a.tipo && c.valor === a.valor));
    // Identificadores fortes primeiro (telefone/@/domínio valem mais que nome+cidade).
    casados.sort((a: { tipo: string }, b: { tipo: string }) => Number(a.tipo === "nome_cidade") - Number(b.tipo === "nome_cidade"));
    existenteId = casados[0]?.prospect_id ?? null;
  }

  let id: string;
  let novo = false;
  let statusAntes: string | null = null;
  let final: ProspectDados;

  if (existenteId) {
    const { data: atual, error } = await sb.from("prospects").select(CAMPOS_PROSPECT).eq("id", existenteId).single();
    if (error) throw new Error(`Prospect ${existenteId}: ${error.message}`);
    statusAntes = atual.status;
    final = mesclarProspect(atual as unknown as ProspectDados & { bloqueado: boolean }, dados, cfg);
    const { error: upErr } = await sb
      .from("prospects")
      .update({ ...final, bloqueado: undefined, verificado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
      .eq("id", existenteId);
    if (upErr) throw new Error(`Atualizar prospect: ${upErr.message}`);
    id = existenteId;
  } else {
    final = dados;
    const { data: criado, error } = await sb
      .from("prospects")
      .insert({ ...dados, consulta_origem: consulta })
      .select("id")
      .single();
    if (error) throw new Error(`Inserir prospect: ${error.message}`);
    id = criado.id;
    novo = true;
  }

  const todas = chavesDedup(final);
  if (todas.length) {
    await sb
      .from("prospect_identificadores")
      .upsert(todas.map((c) => ({ prospect_id: id, tipo: c.tipo, valor: c.valor })), { onConflict: "tipo,valor", ignoreDuplicates: true });
  }

  return { id, novo, status: final.status, qualificadoAgora: final.status === "qualificado" && statusAntes !== "qualificado" };
}

export async function prospectPorTelefone(sb: SupabaseClient, telefone: string) {
  const tel = normalizarTelefoneBR(telefone);
  if (!tel) return null;
  const { data } = await sb.from("prospect_identificadores").select("prospect_id").eq("tipo", "telefone").eq("valor", tel).maybeSingle();
  if (!data) return null;
  const { data: p } = await sb.from("prospects").select("*").eq("id", data.prospect_id).maybeSingle();
  return p;
}

export async function registrarMensagem(
  sb: SupabaseClient,
  m: {
    prospect_id: string;
    direcao: "saida" | "entrada";
    autor: "agente" | "operador" | "prospect" | "sistema";
    texto: string;
    canal?: string;
    intencao?: string | null;
    external_id?: string | null;
    erro?: string | null;
  },
): Promise<string | null> {
  const { data } = await sb.from("prospect_mensagens").insert({ canal: "whatsapp", ...m }).select("id").single();
  return data?.id ?? null;
}

/**
 * Grava a mensagem ANTES de enviar (o eco do próprio envio chega pelo webhook e precisa achar
 * o registro para não ser confundido com uma mensagem digitada no celular) e marca o erro se falhar.
 */
export async function registrarEEnviar(
  sb: SupabaseClient,
  m: Parameters<typeof registrarMensagem>[1],
  enviarFn: () => Promise<void>,
): Promise<void> {
  const id = await registrarMensagem(sb, m);
  try {
    await enviarFn();
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err);
    if (id) await sb.from("prospect_mensagens").update({ erro: erro.slice(0, 500) }).eq("id", id);
    throw err;
  }
}

export async function contagensHoje(sb: SupabaseClient, cfg: ConfigProspeccao) {
  const dia = inicioDoPeriodo(new Date(), cfg.fuso, "dia").toISOString();
  const [{ count: contatos }, { count: respostas }] = await Promise.all([
    sb.from("prospects").select("id", { count: "exact", head: true }).gte("contatado_em", dia),
    sb
      .from("prospect_mensagens")
      .select("id", { count: "exact", head: true })
      .eq("direcao", "saida")
      .eq("autor", "agente")
      .gte("criado_em", dia),
  ]);
  return { contatosHoje: contatos || 0, respostasIaHoje: respostas || 0 };
}
