/**
 * URL pública canônica do app (cardápio, links compartilháveis, redirects).
 * Preferir VITE_PUBLIC_APP_URL; em runtime local cai para window.location.origin.
 */
export const DEFAULT_PUBLIC_APP_URL = "https://easyfoodhub.com.br";

export function getPublicAppUrl(): string {
  const fromEnv = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return DEFAULT_PUBLIC_APP_URL;
}

export function resolveSiteUrl(siteUrl?: string | null): string {
  const configured = (siteUrl || "").trim().replace(/\/+$/, "");
  return configured || getPublicAppUrl();
}

export function buildCardapioUrl(opts: {
  site_url?: string | null;
  referencia?: string | null;
}): string {
  const base = resolveSiteUrl(opts.site_url);
  const ref = (opts.referencia || "").trim().replace(/^\/+|\/+$/g, "");
  return ref ? `${base}/${ref}/cardapio` : `${base}/cardapio`;
}
