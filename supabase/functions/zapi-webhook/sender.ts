import { evolutionSendText } from "../_shared/evolution.ts";
import type { LojaConfig, OutboundMessage } from "./format.ts";
import { formatOptionListAsText } from "./format.ts";
import { sendZapiMessage } from "./zapi.ts";

/** Envia pelo provedor da loja. Na Evolution, listas viram texto numerado. */
export async function sendWhatsappMessage(
  cfg: LojaConfig,
  telefone: string,
  message: OutboundMessage,
): Promise<void> {
  if (cfg.whatsapp_provider === "evolution") {
    if (!cfg.evolution_instance) throw new Error("Instância Evolution não configurada");
    // Responde no número exatamente como veio do WhatsApp (sem ajustar o 9º dígito).
    await evolutionSendText(cfg.evolution_instance, telefone, formatOptionListAsText(message));
    return;
  }
  await sendZapiMessage(cfg, telefone, message);
}
