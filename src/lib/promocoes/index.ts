import { supabase } from "@/integrations/supabase/client";
import { getCachedPromocoes, invalidatePromocoesCache, setCachedPromocoes } from "./cache";
import { emptyEscopo, type EscopoProdutos, type Promocao, type PromocaoAcao, type PromocaoCondicao, type PromocaoTipo } from "./types";

const sb = supabase as any;

function parsePromocao(row: Record<string, unknown>): Promocao {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    nome: String(row.nome || ""),
    descricao: (row.descricao as string | null) ?? null,
    tipo: row.tipo as PromocaoTipo,
    ativo: Boolean(row.ativo),
    prioridade: Number(row.prioridade || 0),
    aplica_automaticamente: row.aplica_automaticamente !== false,
    necessita_cupom: Boolean(row.necessita_cupom),
    codigo_cupom: (row.codigo_cupom as string | null) ?? null,
    data_inicio: (row.data_inicio as string | null) ?? null,
    data_fim: (row.data_fim as string | null) ?? null,
    hora_inicio: row.hora_inicio != null ? String(row.hora_inicio).slice(0, 8) : null,
    hora_fim: row.hora_fim != null ? String(row.hora_fim).slice(0, 8) : null,
    dias_semana: Array.isArray(row.dias_semana) ? (row.dias_semana as number[]) : [0, 1, 2, 3, 4, 5, 6],
    limite_usos_total: row.limite_usos_total != null ? Number(row.limite_usos_total) : null,
    usos_realizados: Number(row.usos_realizados || 0),
    limite_por_cliente: row.limite_por_cliente != null ? Number(row.limite_por_cliente) : null,
    condicoes: (Array.isArray(row.condicoes) ? row.condicoes : []) as PromocaoCondicao[],
    acao: (row.acao || {}) as PromocaoAcao,
    escopo_produtos: {
      ...emptyEscopo(),
      ...((row.escopo_produtos || {}) as Partial<EscopoProdutos>),
    },
    criado_em: row.criado_em as string | undefined,
    atualizado_em: row.atualizado_em as string | undefined,
  };
}

/** Carrega promoções ativas do owner (com cache curto). */
export async function carregarPromocoesAtivas(ownerId: string, opts?: { force?: boolean }): Promise<Promocao[]> {
  if (!ownerId) return [];
  if (!opts?.force) {
    const cached = getCachedPromocoes(ownerId);
    if (cached) return cached;
  }

  const { data, error } = await sb
    .from("promocoes")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("ativo", true)
    .order("prioridade", { ascending: false });

  if (error) {
    console.warn("Falha ao carregar promoções:", error.message);
    return [];
  }

  const list = (data || []).map((row: Record<string, unknown>) => parsePromocao(row));
  setCachedPromocoes(ownerId, list);
  return list;
}

export async function carregarTodasPromocoes(ownerId: string): Promise<Promocao[]> {
  const { data, error } = await sb
    .from("promocoes")
    .select("*")
    .eq("owner_id", ownerId)
    .order("prioridade", { ascending: false })
    .order("criado_em", { ascending: false });

  if (error) throw error;
  return (data || []).map((row: Record<string, unknown>) => parsePromocao(row));
}

export { invalidatePromocoesCache, parsePromocao };

export * from "./types";
export * from "./engine";
export * from "./preview";
export * from "./conditions";
export { aplicarAcao } from "./actions";
