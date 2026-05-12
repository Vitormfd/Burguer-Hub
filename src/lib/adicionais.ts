import { supabase } from "@/integrations/supabase/client";
import type { Adicional, GrupoAdicional } from "@/types/db";

export interface GrupoComAdicionais extends GrupoAdicional {
  adicionais: Adicional[];
}

export async function loadGruposProduto(produtoId: string): Promise<GrupoComAdicionais[]> {
  const { data: vinculos, error: vinculosError } = await supabase
    .from("produto_grupos_adicionais")
    .select("grupo_id, ordem")
    .eq("produto_id", produtoId)
    .order("ordem", { ascending: true });

  if (vinculosError) throw vinculosError;
  if (!vinculos?.length) return [];

  const grupoIds = vinculos.map((v) => v.grupo_id);

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

  const ordemMap = new Map(vinculos.map((v) => [v.grupo_id, v.ordem]));
  const porGrupo = new Map<string, Adicional[]>();

  (adicionais || []).forEach((a) => {
    const list = porGrupo.get(a.grupo_id) || [];
    list.push(a as Adicional);
    porGrupo.set(a.grupo_id, list);
  });

  return (grupos || [])
    .map((g) => ({
      ...(g as GrupoAdicional),
      ordem: ordemMap.get(g.id) ?? (g as GrupoAdicional).ordem,
      adicionais: porGrupo.get(g.id) || [],
    }))
    .sort((a, b) => a.ordem - b.ordem);
}
