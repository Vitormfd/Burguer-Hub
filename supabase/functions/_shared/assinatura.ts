// Regra da assinatura nas Edge Functions: mesmas funções do banco que bloqueiam pedidos e
// mesas. conta_liberada vale para operar (inclui o teste grátis); conta_whatsapp_liberada
// vale para WhatsApp, robô, IA e marketing (o teste só entra se o administrador liberar).

export const MSG_ASSINATURA_INATIVA =
  "Assinatura inativa: assine o Easy Food Hub para usar o WhatsApp, o atendimento automático e os pedidos online.";

export const MSG_WHATSAPP_BLOQUEADO =
  "O WhatsApp automático, a IA e o marketing são liberados com a assinatura do Easy Food Hub.";

// Tipo mínimo: as funções usam o supabase-js de origens diferentes (esm.sh e npm:).
interface ClienteRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Se a consulta falhar, deixa passar: um erro de banco não pode derrubar o atendimento
 * de quem paga. O bloqueio de pedidos continua garantido pelo trigger no banco.
 */
async function consultar(supabase: ClienteRpc, funcao: string, ownerId: string | null | undefined): Promise<boolean> {
  if (!ownerId) return true;
  const { data, error } = await supabase.rpc(funcao, { p_owner: ownerId });
  if (error) {
    console.error(`${funcao} falhou, liberando por segurança:`, error.message);
    return true;
  }
  return data === true;
}

export const contaLiberada = (supabase: ClienteRpc, ownerId: string | null | undefined) =>
  consultar(supabase, "conta_liberada", ownerId);

export const whatsappLiberado = (supabase: ClienteRpc, ownerId: string | null | undefined) =>
  consultar(supabase, "conta_whatsapp_liberada", ownerId);
