import { supabase } from "@/integrations/supabase/client";
import type { TipoMensagemWhatsapp } from "@/types/db";

export interface WhatsappDadosPedido {
  nome?: string;
  itens?: string;
  total?: string;
  tempo_estimado?: string;
}

/**
 * Dispara a Edge Function send-whatsapp de forma fire-and-forget.
 * Nunca lança exceção — erros são silenciados para não bloquear o fluxo.
 */
export async function sendWhatsapp(
  pedido_id: string,
  tipo_mensagem: TipoMensagemWhatsapp,
  telefone: string,
  dados_pedido?: WhatsappDadosPedido
): Promise<void> {
  try {
    await supabase.functions.invoke("send-whatsapp", {
      body: { pedido_id, tipo_mensagem, telefone, dados_pedido },
    });
  } catch {
    // Silently ignore — WhatsApp failure must never block order operations
  }
}
