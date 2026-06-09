import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  CartItemWa,
  Etapa,
  GrupoAdicionalWa,
  LojaConfig,
  SessionDados,
  WhatsappSession,
} from "./types.ts";
import { normalizePhone } from "./format.ts";

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Configuração interna ausente");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function findLojaByInstance(
  supabase: SupabaseClient,
  instanceId: string,
): Promise<LojaConfig | null> {
  const { data } = await supabase
    .from("configuracoes")
    .select(
      "id, owner_id, nome_loja, zapi_instance_id, zapi_token, zapi_client_token, " +
      "zapi_ativo, whatsapp_pedido_ativo, whatsapp_msg_boas_vindas, tempo_entrega_min, " +
      "retirada_ativa, hora_abertura, hora_fechamento, horario_funcionamento, endereco_estabelecimento",
    )
    .eq("zapi_instance_id", instanceId)
    .eq("zapi_ativo", true)
    .eq("whatsapp_pedido_ativo", true)
    .not("zapi_token", "is", null)
    .not("zapi_client_token", "is", null)
    .limit(1)
    .maybeSingle();

  return data as LojaConfig | null;
}

export async function getSession(
  supabase: SupabaseClient,
  ownerId: string,
  telefone: string,
): Promise<WhatsappSession | null> {
  const phone = normalizePhone(telefone);
  const { data } = await supabase
    .from("whatsapp_pedido_sessions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("telefone", phone)
    .maybeSingle();

  if (!data) return null;

  const session = data as WhatsappSession;
  const age = Date.now() - new Date(session.atualizado_em).getTime();
  if (age > 45 * 60 * 1000) {
    await deleteSession(supabase, ownerId, phone);
    return null;
  }

  const stored = session.dados as SessionDados;
  session.dados = {
    ...stored,
    carrinho: stored?.carrinho || [],
  };
  return session;
}

export async function upsertSession(
  supabase: SupabaseClient,
  ownerId: string,
  telefone: string,
  etapa: Etapa,
  dados: SessionDados,
  messageId?: string,
): Promise<void> {
  const phone = normalizePhone(telefone);
  await supabase.from("whatsapp_pedido_sessions").upsert(
    {
      owner_id: ownerId,
      telefone: phone,
      etapa,
      dados,
      ultimo_message_id: messageId ?? null,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "owner_id,telefone" },
  );
}

export async function deleteSession(
  supabase: SupabaseClient,
  ownerId: string,
  telefone: string,
): Promise<void> {
  const phone = normalizePhone(telefone);
  await supabase
    .from("whatsapp_pedido_sessions")
    .delete()
    .eq("owner_id", ownerId)
    .eq("telefone", phone);
}

export async function loadCategorias(
  supabase: SupabaseClient,
  ownerId: string,
) {
  const { data } = await supabase
    .from("categorias")
    .select("id, nome, emoji, ordem")
    .eq("owner_id", ownerId)
    .eq("ativo", true)
    .order("ordem", { ascending: true });
  return data || [];
}

export async function loadProdutos(
  supabase: SupabaseClient,
  ownerId: string,
  categoriaId: string,
) {
  const { data } = await supabase
    .from("produtos")
    .select("id, nome, descricao, preco, preco_promocional, promocao, categoria_id, ordem")
    .eq("owner_id", ownerId)
    .eq("categoria_id", categoriaId)
    .eq("disponivel", true)
    .order("ordem", { ascending: true });
  return data || [];
}

export async function loadBairros(
  supabase: SupabaseClient,
  ownerId: string,
) {
  const { data } = await supabase
    .from("bairros_taxas")
    .select("id, nome, taxa")
    .eq("owner_id", ownerId)
    .eq("ativo", true)
    .order("nome", { ascending: true });
  return data || [];
}

export async function loadClienteByPhone(
  supabase: SupabaseClient,
  telefone: string,
) {
  const phone = normalizePhone(telefone);
  const { data } = await supabase
    .from("clientes")
    .select("id, nome, endereco, numero, complemento, bairro")
    .eq("telefone", phone)
    .maybeSingle();
  return data;
}

export function produtoPreco(p: {
  preco: number;
  promocao?: boolean;
  preco_promocional?: number | null;
}): number {
  if (p.promocao && p.preco_promocional != null && p.preco_promocional > 0) {
    return Number(p.preco_promocional);
  }
  return Number(p.preco);
}

export function isHamburger(
  categoriaNome: string,
  produtoNome: string,
): boolean {
  const cat = categoriaNome.toLowerCase();
  const prod = produtoNome.toLowerCase();
  return (
    cat.includes("hamburg") ||
    cat.includes("burger") ||
    cat.includes("lanche") ||
    prod.includes("hamburg") ||
    prod.includes("burger")
  );
}

export async function loadGruposProduto(
  supabase: SupabaseClient,
  produtoId: string,
  fallbackAll: boolean,
): Promise<GrupoAdicionalWa[]> {
  const { data: vinculos } = await supabase
    .from("produto_grupos_adicionais")
    .select("grupo_id, ordem")
    .eq("produto_id", produtoId)
    .order("ordem", { ascending: true });

  const linkedIds = (vinculos || []).map((v) => v.grupo_id);

  let grupoIds = linkedIds;
  if (fallbackAll || !linkedIds.length) {
    const { data: todos } = await supabase
      .from("grupos_adicionais")
      .select("id")
      .eq("disponivel", true)
      .order("ordem", { ascending: true });
    const availableIds = (todos || []).map((g) => g.id);
    grupoIds = fallbackAll
      ? Array.from(new Set([...linkedIds, ...availableIds]))
      : linkedIds;
  }

  if (!grupoIds.length) return [];

  const [{ data: grupos }, { data: adicionais }] = await Promise.all([
    supabase
      .from("grupos_adicionais")
      .select("id, nome, obrigatorio, min_escolhas, max_escolhas, ordem")
      .in("id", grupoIds)
      .eq("disponivel", true)
      .order("ordem", { ascending: true }),
    supabase
      .from("adicionais")
      .select("id, grupo_id, nome, preco, disponivel, ordem")
      .in("grupo_id", grupoIds)
      .eq("disponivel", true)
      .order("ordem", { ascending: true }),
  ]);

  const porGrupo = new Map<string, GrupoAdicionalWa["adicionais"]>();
  for (const a of adicionais || []) {
    const list = porGrupo.get(a.grupo_id) || [];
    list.push({
      id: a.id,
      nome: a.nome,
      preco: Number(a.preco),
      disponivel: a.disponivel,
    });
    porGrupo.set(a.grupo_id, list);
  }

  return (grupos || [])
    .map((g) => ({
      id: g.id,
      nome: g.nome,
      obrigatorio: g.obrigatorio,
      min_escolhas: g.min_escolhas,
      max_escolhas: g.max_escolhas,
      adicionais: porGrupo.get(g.id) || [],
    }))
    .filter((g) => g.adicionais.length > 0);
}

export async function createWhatsappOrder(
  supabase: SupabaseClient,
  ownerId: string,
  params: {
    tipo_entrega: string;
    cliente_nome: string;
    cliente_telefone: string;
    endereco: string;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    taxa_entrega: number;
    forma_pagamento: string;
    troco_para: number | null;
    subtotal: number;
    total: number;
    items: CartItemWa[];
  },
): Promise<{ pedido_id: string; cliente_id?: string }> {
  const itemsPayload = params.items.map((item) => ({
    produto_id: item.produto_id,
    quantidade: item.quantidade,
    preco_unitario: item.preco_unitario,
    observacao: item.observacao || null,
    adicionais: item.adicionais.map((a) => ({
      adicional_id: a.adicional_id,
      quantidade: a.quantidade,
      preco_unitario: a.preco_unitario,
    })),
  }));

  const { data, error } = await supabase.rpc("create_whatsapp_delivery_order", {
    p_owner_id: ownerId,
    p_tipo_entrega: params.tipo_entrega,
    p_cliente_nome: params.cliente_nome,
    p_cliente_telefone: params.cliente_telefone,
    p_endereco: params.endereco,
    p_numero: params.numero,
    p_complemento: params.complemento,
    p_bairro: params.bairro,
    p_taxa_entrega: params.taxa_entrega,
    p_forma_pagamento: params.forma_pagamento,
    p_troco_para: params.troco_para,
    p_subtotal: params.subtotal,
    p_total: params.total,
    p_items: itemsPayload,
  });

  if (error) throw new Error(error.message);
  return data as { pedido_id: string; cliente_id?: string };
}

interface HorarioDia {
  dia: number;
  ativo: boolean;
  abertura: string;
  fechamento: string;
}

export function isLojaAberta(cfg: LojaConfig, date = new Date()): boolean {
  const dia = date.getDay();
  const cur = date.getHours() * 60 + date.getMinutes();

  const toMinutes = (t: string) => {
    const [h, m] = (t || "00:00").split(":").map(Number);
    return h * 60 + m;
  };

  const fallbackAbertura = cfg.hora_abertura || "18:00";
  const fallbackFechamento = cfg.hora_fechamento || "23:00";

  let today: HorarioDia | null = null;
  if (Array.isArray(cfg.horario_funcionamento)) {
    for (const raw of cfg.horario_funcionamento) {
      if (!raw || typeof raw !== "object") continue;
      const d = Number((raw as HorarioDia).dia);
      if (d === dia) {
        today = raw as HorarioDia;
        break;
      }
    }
  }

  if (!today) {
    today = { dia, ativo: true, abertura: fallbackAbertura, fechamento: fallbackFechamento };
  }
  if (!today.ativo) return false;

  const ini = toMinutes(today.abertura);
  const fim = toMinutes(today.fechamento);
  return fim > ini ? cur >= ini && cur <= fim : cur >= ini || cur <= fim;
}
