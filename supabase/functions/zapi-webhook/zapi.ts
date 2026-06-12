import type { LojaConfig, OutboundMessage } from "./format.ts";
import { formatPhoneZapi } from "./format.ts";

const zapiBase = (cfg: LojaConfig) =>
  `https://api.z-api.io/instances/${cfg.zapi_instance_id}/token/${cfg.zapi_token}`;

const zapiHeaders = (cfg: LojaConfig) => ({
  "Content-Type": "application/json",
  "Client-Token": cfg.zapi_client_token,
});

export async function sendZapiMessage(
  cfg: LojaConfig,
  phone: string,
  message: OutboundMessage,
): Promise<void> {
  const formattedPhone = formatPhoneZapi(phone);

  if (message.optionList && message.optionList.options.length > 0) {
    const url = `${zapiBase(cfg)}/send-option-list`;
    const res = await fetch(url, {
      method: "POST",
      headers: zapiHeaders(cfg),
      body: JSON.stringify({
        phone: formattedPhone,
        message: message.text,
        optionList: message.optionList,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Z-API option-list HTTP ${res.status}: ${body}`);
    }
    return;
  }

  const url = `${zapiBase(cfg)}/send-text`;
  const res = await fetch(url, {
    method: "POST",
    headers: zapiHeaders(cfg),
    body: JSON.stringify({
      phone: formattedPhone,
      message: message.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Z-API send-text HTTP ${res.status}: ${body}`);
  }
}

export async function configureZapiWebhook(
  cfg: LojaConfig,
  webhookUrl: string,
): Promise<void> {
  const receivedUrl = `${zapiBase(cfg)}/update-webhook-received`;
  const res = await fetch(receivedUrl, {
    method: "PUT",
    headers: zapiHeaders(cfg),
    body: JSON.stringify({ value: webhookUrl }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Z-API webhook HTTP ${res.status}: ${body}`);
  }

  const notifyUrl = `${zapiBase(cfg)}/update-notify-sent-by-me`;
  await fetch(notifyUrl, {
    method: "PUT",
    headers: zapiHeaders(cfg),
    body: JSON.stringify({ notifySentByMe: false }),
  });
}
