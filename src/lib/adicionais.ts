import { supabase } from "@/integrations/supabase/client";
import type { Adicional, GrupoAdicional } from "@/types/db";

export interface GrupoComAdicionais extends GrupoAdicional {
  adicionais: Adicional[];
}

interface LoadGruposProdutoOptions {
  fallbackAllAvailable?: boolean;
}

export async function loadGruposProduto(
  produtoId: string,
  options: LoadGruposProdutoOptions = {}
): Promise<GrupoComAdicionais[]> {
  const { data: vinculos, error: vinculosError } = await supabase
    .from("produto_grupos_adicionais")
    .select("grupo_id, ordem")
    .eq("produto_id", produtoId)
    .order("ordem", { ascending: true });

  if (vinculosError) throw vinculosError;

  const fallbackAll = !!options.fallbackAllAvailable;

  if (!vinculos?.length && !fallbackAll) return [];

  const { data: gruposDisponiveis, error: gruposDisponiveisError } = await supabase
    .from("grupos_adicionais")
    .select("id")
    .eq("disponivel", true)
    .order("ordem", { ascending: true });

  if (gruposDisponiveisError) throw gruposDisponiveisError;

  const linkedIds = (vinculos || []).map((v) => v.grupo_id);
  const availableIds = (gruposDisponiveis || []).map((g) => g.id);

  // When fallback is active (hamburger flow), include linked groups plus any new available group.
  const grupoIds = fallbackAll
    ? Array.from(new Set([...linkedIds, ...availableIds]))
    : linkedIds;

  if (!grupoIds.length) return [];

  const [{ data: grupos, error: gruposError }, { data: adicionais, error: adicionaisError }] = await Promise.all([
    supabase
      .from("grupos_adicionais")
      .select("*")
      .in("id", grupoIds)
      .eq("disponivel", true)
      .order("ordem", { ascending: true }),
    supabase
      .from("adicionais")
      .select("*")
      .in("grupo_id", grupoIds)
      .order("ordem", { ascending: true }),
  ]);

  if (gruposError) throw gruposError;
  if (adicionaisError) throw adicionaisError;

  const ordemMap = new Map((vinculos || []).map((v) => [v.grupo_id, v.ordem]));
  const porGrupo = new Map<string, Adicional[]>();

  (adicionais || []).forEach((a) => {
    const list = porGrupo.get(a.grupo_id) || [];
    list.push(a as Adicional);
    porGrupo.set(a.grupo_id, list);
  });

  return (grupos || [])
    .map((g) => ({
      ...(g as GrupoAdicional),
      // In fallback-all mode (hamburger flow), respect the group's own order.
      ordem: fallbackAll ? (g as GrupoAdicional).ordem : (ordemMap.get(g.id) ?? (g as GrupoAdicional).ordem),
      adicionais: porGrupo.get(g.id) || [],
    }))
    .sort((a, b) => a.ordem - b.ordem);
}
