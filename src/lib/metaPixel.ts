// Pixel do Meta no sistema. A landing tem o próprio trecho, gerado em
// LP/EasyFoodHubLp/scripts/build-seo.mjs.
//
// O pixel recebe só o nome do evento e o valor da assinatura: nada de e-mail, telefone ou
// correspondência avançada.

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
  push?: unknown;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

const SCRIPT = "https://connect.facebook.net/en_US/fbevents.js";

/** Pixel "Easy Food Hub" (negócio Easy System). O ID é público. */
export const PIXEL_PRODUCAO = "1628835118137335";

/**
 * Sem VITE_META_PIXEL_ID, o pixel só carrega no domínio de produção: dev local e prévias da
 * Vercel não enviam eventos. Com a variável, vale ela (testes).
 */
export function idPixelPara(hostname: string, idDoAmbiente: string): string {
  if (idDoAmbiente.trim()) return idDoAmbiente.trim();
  return /(^|\.)easyfoodhub\.com\.br$/.test(hostname) ? PIXEL_PRODUCAO : "";
}

const idDoPixel = () =>
  idPixelPara(typeof window === "undefined" ? "" : window.location.hostname, String(import.meta.env.VITE_META_PIXEL_ID || ""));

/**
 * Sem pixel:
 * - cardápio e acompanhamento: quem acessa é cliente do restaurante, não cliente do Easy Food Hub;
 * - raiz e /lp: só redirecionam, e contariam duas visitas.
 */
export function rotaSemPixel(caminho: string): boolean {
  if (caminho === "/" || caminho === "/lp") return true;
  if (caminho.startsWith("/admin/")) return false;
  return caminho.startsWith("/pedido/") || /\/cardapio\/?$/.test(caminho);
}

let iniciado = false;
let ultimaPagina: string | null = null;
const jaEnviados = new Set<string>();

function iniciar(): Fbq | null {
  const id = idDoPixel();
  if (!/^\d+$/.test(id) || typeof window === "undefined") return null;
  if (iniciado && window.fbq) return window.fbq;

  if (!window.fbq) {
    const fbq: Fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    };
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;

    const script = document.createElement("script");
    script.async = true;
    script.src = SCRIPT;
    document.head.appendChild(script);
  }

  // autoConfig desligado: o Meta não captura cliques e campos de formulário sozinho.
  window.fbq("set", "autoConfig", false, id);
  window.fbq("init", id);
  iniciado = true;
  return window.fbq;
}

/** Uma visita por página. Chamadas repetidas para o mesmo caminho não contam de novo. */
export function registrarPagina(caminho: string): void {
  if (rotaSemPixel(caminho) || caminho === ultimaPagina) return;
  const fbq = iniciar();
  if (!fbq) return;
  ultimaPagina = caminho;
  fbq("track", "PageView");
}

function jaEnviadoNoNavegador(chave: string): boolean {
  try {
    return window.localStorage.getItem(chave) === "1";
  } catch {
    return false;
  }
}

/** Evento de conversão que só pode contar uma vez por conta neste navegador. */
export function registrarEventoUnico(evento: string, contaId: string, parametros?: Record<string, unknown>): void {
  const chave = `efh_evento_${evento}_${contaId}`;
  if (jaEnviados.has(chave) || jaEnviadoNoNavegador(chave)) return;
  const fbq = iniciar();
  if (!fbq) return;
  jaEnviados.add(chave);
  try {
    window.localStorage.setItem(chave, "1");
  } catch {
    // Sem armazenamento, o controle em memória vale até recarregar a página.
  }
  if (parametros) fbq("track", evento, parametros);
  else fbq("track", evento);
}

/** Só para os testes. */
export function reiniciarPixelParaTeste(): void {
  iniciado = false;
  ultimaPagina = null;
  jaEnviados.clear();
  delete window.fbq;
  delete window._fbq;
}
