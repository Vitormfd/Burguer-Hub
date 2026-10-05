// Envio de texto simples pelo provedor de WhatsApp da loja (Z-API ou Evolution).
import { evolutionSendText } from "./evolution.ts";

export interface LojaWhatsappCfg {
  zapi_instance_id?: string | null;
  zapi_token?: string | null;
  zapi_client_token?: string | null;
  zapi_ativo?: boolean | null;
  whatsapp_provider?: string | null;
  evolution_instance?: string | null;
}

/** true quando a loja tem WhatsApp ativo e credenciais do provedor escolhido. */
export function whatsappPronto(cfg: LojaWhatsappCfg): boolean {
  if (!cfg.zapi_ativo) return false;
  if (cfg.whatsapp_provider === "evolution") return Boolean(cfg.evolution_instance);
  return Boolean(cfg.zapi_instance_id && cfg.zapi_token && cfg.zapi_client_token);
}

/** Celular BR → 55 + DDD + 9 + número. null se não parecer celular. */
export function formatBrazilMobile(value: string): string | null {
  let digits = (value || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  if (digits.length === 10) digits = digits.slice(0, 2) + "9" + digits.slice(2);
  if (digits.length !== 11 || digits[2] !== "9") return null;
  return `55${digits}`;
}

export async function sendStoreText(cfg: LojaWhatsappCfg, phone55: string, text: string): Promise<void> {
  if (cfg.whatsapp_provider === "evolution") {
    if (!cfg.evolution_instance) throw new Error("Instância Evolution não configurada");
    await evolutionSendText(cfg.evolution_instance, phone55, text);
    return;
  }
  const res = await fetch(
    `https://api.z-api.io/instances/${cfg.zapi_instance_id}/token/${cfg.zapi_token}/send-text`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Client-Token": String(cfg.zapi_client_token) },
      body: JSON.stringify({ phone: phone55, message: text }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Z-API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Base pública do app: site_url da loja > PUBLIC_APP_URL > domínio oficial. */
export function publicBaseUrl(siteUrl?: string | null): string {
  const fromCfg = (siteUrl || "").trim().replace(/\/+$/, "");
  const fromEnv = (Deno.env.get("PUBLIC_APP_URL") || "").trim().replace(/\/+$/, "");
  return fromCfg || fromEnv || "https://easyfoodhub.com.br";
}
