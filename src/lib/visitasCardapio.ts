import { supabase } from "@/integrations/supabase/client";

export const ETAPA_VISITA = { abriu: 1, carrinho: 2, checkout: 3, pedido: 4 } as const;

const SESSION_KEY = "burgerhub:cardapio-session:v1";

let fallbackSessionId: string | null = null;
const etapaEnviada = new Map<string, number>();

function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    fallbackSessionId ??= crypto.randomUUID();
    return fallbackSessionId;
  }
}

export function registrarEtapaCardapio(ownerId: string, etapa: number) {
  const sessionId = getSessionId();
  const key = `${ownerId}:${sessionId}`;
  if ((etapaEnviada.get(key) ?? 0) >= etapa) return;
  etapaEnviada.set(key, etapa);

  void (supabase as any)
    .rpc("registrar_visita_cardapio", {
      p_owner_id: ownerId,
      p_session_id: sessionId,
      p_etapa: etapa,
    })
    .then(({ error }: { error: unknown }) => {
      if (error) etapaEnviada.set(key, etapa - 1);
    })
    .catch(() => etapaEnviada.set(key, etapa - 1));
}

export interface VisitasCardapioResumo {
  visitas: number;
  carrinho: number;
  checkout: number;
  pedidos: number;
}

export async function fetchVisitasCardapio(ini: string, fim: string): Promise<VisitasCardapioResumo> {
  const { data, error } = await (supabase as any).rpc("relatorio_visitas_cardapio", {
    p_ini: ini,
    p_fim: fim,
  });
  if (error) throw error;
  const r = (data || {}) as Partial<VisitasCardapioResumo>;
  return {
    visitas: Number(r.visitas || 0),
    carrinho: Number(r.carrinho || 0),
    checkout: Number(r.checkout || 0),
    pedidos: Number(r.pedidos || 0),
  };
}
