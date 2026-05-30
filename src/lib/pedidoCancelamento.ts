import { supabase } from "@/integrations/supabase/client";
import type { PedidoStatus } from "@/types/db";
import { pedidoEditavel } from "@/lib/pedidoEdit";

export type MotivoCancelamento = "Erro do atendente" | "Cliente desistiu" | "Item indisponível" | "Outro";

export const MOTIVOS_CANCELAMENTO: MotivoCancelamento[] = [
  "Erro do atendente",
  "Cliente desistiu",
  "Item indisponível",
  "Outro",
];

export const pedidoCancelavel = (status: PedidoStatus) => pedidoEditavel(status);

export const motivoComObservacao = (motivo: string, observacao: string) => {
  const texto = observacao.trim();
  return texto ? `${motivo} | Obs: ${texto}` : motivo;
};

export async function cancelarPedidoCompleto(
  pedidoId: string,
  motivo: string,
  canceladoPor: string
): Promise<{ error: string | null }> {
  const agora = new Date().toISOString();

  const [{ error: pedidoError }, { error: itensError }] = await Promise.all([
    supabase
      .from("pedidos")
      .update({
        status: "cancelado",
        cancelado_em: agora,
        motivo_cancelamento: motivo,
        cancelado_por: canceladoPor,
      })
      .eq("id", pedidoId),
    supabase
      .from("pedido_itens")
      .update({
        cancelado: true,
        cancelado_em: agora,
        motivo_cancelamento: motivo,
      })
      .eq("pedido_id", pedidoId),
  ]);

  if (pedidoError || itensError) {
    return { error: pedidoError?.message || itensError?.message || "Erro ao cancelar pedido" };
  }

  return { error: null };
}
