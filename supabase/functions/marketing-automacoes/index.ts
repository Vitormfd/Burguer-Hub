// Automações de marketing no WhatsApp (reativação e segunda compra).
//
// Chamadas aceitas:
//   - Cron (pg_cron/pg_net) com header x-cron-secret = MARKETING_CRON_SECRET → todas as lojas.
//   - Painel (JWT do dono) → só a loja do usuário. Body: { dry_run?: boolean, tipo?: string }.
//     dry_run devolve a lista de quem receberia, sem enviar nada.
//
// Cada execução envia no máximo MAX_POR_EXECUCAO mensagens por loja, com intervalo entre
// elas (reduz risco de bloqueio do número). O cron roda de hora em hora até bater o
// limite diário configurado em cada automação.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  formatBrazilMobile,
  publicBaseUrl,
  sendStoreText,
  whatsappPronto,
  type LojaWhatsappCfg,
} from "../_shared/whatsappText.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_POR_EXECUCAO = 8;
const HORA_INICIO = 9;
const HORA_FIM = 21;

type Tipo = "reativacao" | "segunda_compra";

interface Automacao {
  id: string;
  owner_id: string;
  tipo: Tipo;
  ativo: boolean;
  dias: number;
  mensagem: string;
  cupom_id: string | null;
  max_envios_dia: number;
}

interface Candidato {
  telefone: string;
  telefone_key: string;
  cliente_nome: string | null;
  ultimo_pedido: string;
  total_pedidos: number;
}

interface LojaCfg extends LojaWhatsappCfg {
  owner_id: string;
  nome_loja: string;
  referencia: string | null;
  site_url: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hora atual em Brasília (0-23). */
const horaBrasilia = () =>
  Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(new Date()));

const inicioDoDiaBrasiliaISO = () => {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${ymd}T00:00:00-03:00`).toISOString();
};

const primeiroNome = (nome: string | null) => {
  const n = (nome || "").trim().split(/\s+/)[0] || "";
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
};

function montarMensagem(template: string, vars: { nome: string; loja: string; cupom: string; link: string }): string {
  let msg = template;
  // Sem cupom válido, remove as linhas que o mencionam em vez de mandar "use o cupom ".
  if (!vars.cupom) msg = msg.split("\n").filter((l) => !l.includes("{cupom}")).join("\n");
  msg = msg
    .replaceAll("{nome}", vars.nome)
    .replaceAll("{loja}", vars.loja)
    .replaceAll("{cupom}", vars.cupom)
    .replaceAll("{link}", vars.link);
  // "Oi !" quando o cliente não tem nome.
  return msg.replace(/ +([!,.?])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}

async function cupomValido(supabase: SupabaseClient, cupomId: string | null): Promise<string> {
  if (!cupomId) return "";
  const { data } = await supabase
    .from("cupons")
    .select("codigo, ativo, data_expiracao, limite_usos_total, usos_realizados")
    .eq("id", cupomId)
    .maybeSingle();
  if (!data?.ativo) return "";
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  if (data.data_expiracao && String(data.data_expiracao) < hoje) return "";
  if (data.limite_usos_total && Number(data.usos_realizados) >= Number(data.limite_usos_total)) return "";
  return String(data.codigo);
}

interface ResultadoAutomacao {
  tipo: Tipo;
  enviados: number;
  erros: number;
  pulado?: string;
  candidatos?: { nome: string | null; telefone: string; ultimo_pedido: string }[];
}

async function processarLoja(
  supabase: SupabaseClient,
  ownerId: string,
  opts: { dryRun: boolean; tipo?: Tipo },
): Promise<ResultadoAutomacao[]> {
  const { data: cfg } = await supabase
    .from("configuracoes")
    .select(
      "owner_id, nome_loja, referencia, site_url, zapi_instance_id, zapi_token, zapi_client_token, zapi_ativo, whatsapp_provider, evolution_instance",
    )
    .eq("owner_id", ownerId)
    .limit(1)
    .maybeSingle();
  if (!cfg) return [];
  const loja = cfg as LojaCfg;

  let q = supabase.from("marketing_automacoes").select("*").eq("owner_id", ownerId);
  if (opts.tipo) q = q.eq("tipo", opts.tipo);
  else q = q.eq("ativo", true);
  const { data: automacoes } = await q;

  const ref = (loja.referencia || "").trim().replace(/^\/+|\/+$/g, "");
  const link = `${publicBaseUrl(loja.site_url)}${ref ? `/${ref}` : ""}/cardapio`;
  const resultados: ResultadoAutomacao[] = [];
  let restanteExecucao = MAX_POR_EXECUCAO;

  for (const a of (automacoes || []) as Automacao[]) {
    const res: ResultadoAutomacao = { tipo: a.tipo, enviados: 0, erros: 0 };
    resultados.push(res);

    if (!a.mensagem?.trim()) {
      res.pulado = "Mensagem vazia";
      continue;
    }
    if (!opts.dryRun && !a.ativo) {
      res.pulado = "Automação desligada";
      continue;
    }

    const { count: enviadosHoje } = await supabase
      .from("marketing_envios")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("automacao_tipo", a.tipo)
      .gte("enviado_em", inicioDoDiaBrasiliaISO());
    const limiteHoje = Math.max(Number(a.max_envios_dia) - Number(enviadosHoje || 0), 0);
    const limite = opts.dryRun ? 50 : Math.min(limiteHoje, restanteExecucao);
    if (limite <= 0) {
      res.pulado = "Limite diário atingido";
      continue;
    }

    const { data: cands, error: candErr } = await supabase.rpc("marketing_candidatos", {
      p_owner: ownerId,
      p_tipo: a.tipo,
      p_dias: a.dias,
      p_limite: limite,
    });
    if (candErr) {
      res.pulado = candErr.message;
      continue;
    }
    const candidatos = (cands || []) as Candidato[];

    if (opts.dryRun) {
      res.candidatos = candidatos.map((c) => ({ nome: c.cliente_nome, telefone: c.telefone, ultimo_pedido: c.ultimo_pedido }));
      continue;
    }

    if (!candidatos.length) continue;

    if (!whatsappPronto(loja)) {
      res.pulado = "WhatsApp da loja não está conectado/ativo";
      continue;
    }

    const cupom = await cupomValido(supabase, a.cupom_id);
    if (a.cupom_id && !cupom) {
      res.pulado = "Cupom inativo, expirado ou esgotado — revise a automação";
      continue;
    }

    for (const c of candidatos) {
      const phone = formatBrazilMobile(c.telefone);
      if (!phone) continue;
      const mensagem = montarMensagem(a.mensagem, {
        nome: primeiroNome(c.cliente_nome),
        loja: loja.nome_loja,
        cupom,
        link,
      });

      let status: "enviado" | "erro" = "enviado";
      let erro: string | null = null;
      try {
        await sendStoreText(loja, phone, mensagem);
        res.enviados += 1;
      } catch (err) {
        status = "erro";
        erro = err instanceof Error ? err.message : String(err);
        res.erros += 1;
      }

      await supabase.from("marketing_envios").insert({
        owner_id: ownerId,
        automacao_tipo: a.tipo,
        telefone: phone,
        telefone_key: c.telefone_key,
        cliente_nome: c.cliente_nome,
        mensagem,
        status,
        erro,
      });

      restanteExecucao -= 1;
      if (restanteExecucao <= 0) break;
      // Intervalo aleatório entre mensagens para parecer envio humano.
      await sleep(4000 + Math.floor(Math.random() * 4000));
    }

    await supabase.from("marketing_automacoes").update({ ultima_execucao_em: new Date().toISOString() }).eq("id", a.id);
    if (restanteExecucao <= 0) break;
  }

  return resultados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Configuração interna ausente" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean; tipo?: Tipo };
  const tipo = body.tipo === "reativacao" || body.tipo === "segunda_compra" ? body.tipo : undefined;
  const dryRun = Boolean(body.dry_run);

  const cronSecret = Deno.env.get("MARKETING_CRON_SECRET") || "";
  const isCron = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;

  const fora = horaBrasilia() < HORA_INICIO || horaBrasilia() >= HORA_FIM;

  if (isCron) {
    if (fora) return json({ ok: true, skipped: "fora_do_horario" });
    const { data: ativos } = await supabase.from("marketing_automacoes").select("owner_id").eq("ativo", true);
    const owners = [...new Set((ativos || []).map((r: { owner_id: string }) => r.owner_id))];
    // Lojas em paralelo (instâncias de WhatsApp diferentes); mensagens de uma loja em sequência.
    const resultados = await Promise.all(
      owners.map(async (ownerId) => {
        try {
          return { owner_id: ownerId, resultados: await processarLoja(supabase, ownerId, { dryRun: false }) };
        } catch (err) {
          return { owner_id: ownerId, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    return json({ ok: true, lojas: resultados.length, resultados });
  }

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData } = await supabase.auth.getUser(jwt);
  const ownerId = userData?.user?.id;
  if (!ownerId) return json({ ok: false, error: "Não autorizado" }, 401);

  if (!dryRun && fora) {
    return json({ ok: false, error: `Envios só entre ${HORA_INICIO}h e ${HORA_FIM}h (horário de Brasília).` });
  }

  try {
    const resultados = await processarLoja(supabase, ownerId, { dryRun, tipo });
    return json({ ok: true, resultados, max_por_execucao: MAX_POR_EXECUCAO });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
