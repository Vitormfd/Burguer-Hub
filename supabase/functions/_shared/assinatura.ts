// Regra da assinatura nas Edge Functions: mesma função do banco (conta_liberada) que
// bloqueia pedidos e mesas. Conta sem assinatura não usa WhatsApp, IA nem marketing.

export const MSG_ASSINATURA_INATIVA =
  "Assinatura inativa: assine o Easy Food Hub para usar o WhatsApp, o atendimento automático e os pedidos online.";

// Tipo mínimo: as funções usam o supabase-js de origens diferentes (esm.sh e npm:).
interface ClienteRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Se a consulta falhar, deixa passar: um erro de banco não pode derrubar o atendimento
 * de quem paga. O bloqueio de pedidos continua garantido pelo trigger no banco.
 */
export async function contaLiberada(supabase: ClienteRpc, ownerId: string | null | undefined): Promise<boolean> {
  if (!ownerId) return true;
  const { data, error } = await supabase.rpc("conta_liberada", { p_owner: ownerId });
  if (error) {
    console.error("conta_liberada falhou, liberando por segurança:", error.message);
    return true;
  }
  return data === true;
}
