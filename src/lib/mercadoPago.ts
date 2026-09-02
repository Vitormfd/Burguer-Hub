import { supabase } from "@/integrations/supabase/client";

export interface CriarPagamentoPixParams {
  owner_id: string;
  valor: number;
  cliente_nome: string;
  cliente_telefone: string;
  order_payload: Record<string, unknown>;
}

export interface PagamentoPixCriado {
  fallback?: boolean;
  pagamento_id?: string;
  qr_code?: string;
  qr_code_base64?: string | null;
  expira_em?: string | null;
  error?: string;
}

export type PagamentoPixStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired" | "not_found";

/**
 * Cria uma cobrança Pix via Mercado Pago para o pedido informado.
 * Se a loja não tiver Pix online configurado, retorna { fallback: true } —
 * quem chamar deve então seguir o fluxo tradicional (criar o pedido direto).
 */
export async function criarPagamentoPix(params: CriarPagamentoPixParams): Promise<PagamentoPixCriado> {
  const { data, error } = await supabase.functions.invoke("mp-pix-criar", {
    body: params,
  });

  if (error) {
    const backendMessage =
      data && typeof data === "object" && "error" in data ? String((data as { error?: unknown }).error || "") : "";
    return { error: backendMessage || error.message || "Erro ao gerar cobrança Pix" };
  }

  return (data || {}) as PagamentoPixCriado;
}

/** Consulta o status atual de um pagamento Pix (usado no polling do checkout público). */
export async function consultarStatusPagamentoPix(
  pagamentoId: string,
): Promise<{ status: PagamentoPixStatus; pedido_id: string | null }> {
  const { data, error } = await (supabase as any).rpc("get_pagamento_pix_status", { p_id: pagamentoId });
  if (error) throw new Error(error.message);
  return data as { status: PagamentoPixStatus; pedido_id: string | null };
}
