// De onde a conta veio: UTMs e fbclid do anúncio, guardados no navegador e enviados no
// cadastro. Landing e sistema ficam no mesmo domínio e usam a mesma chave
// (a landing grava em LP/EasyFoodHubLp/src/lib/rastreamento.js).

const CHAVE = "efh_origem";
const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;

export const PARAMS_ORIGEM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"] as const;

export type Origem = Partial<Record<(typeof PARAMS_ORIGEM)[number], string>>;

function armazenamento(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function lerOrigem(): Origem {
  try {
    const salvo = JSON.parse(armazenamento()?.getItem(CHAVE) || "null");
    if (!salvo || Date.now() - Number(salvo.capturado_em) > VALIDADE_MS) return {};
    const origem: Origem = {};
    for (const k of PARAMS_ORIGEM) if (typeof salvo[k] === "string" && salvo[k]) origem[k] = salvo[k];
    return origem;
  } catch {
    return {};
  }
}

/** Grava os parâmetros da URL. Um anúncio novo substitui o anterior; URL sem parâmetros não apaga nada. */
export function capturarOrigem(search: string = window.location.search): Origem {
  const params = new URLSearchParams(search);
  const nova: Origem = {};
  for (const k of PARAMS_ORIGEM) {
    const valor = (params.get(k) || "").trim().slice(0, 200);
    if (valor) nova[k] = valor;
  }
  if (!Object.keys(nova).length) return lerOrigem();
  try {
    armazenamento()?.setItem(CHAVE, JSON.stringify({ ...nova, capturado_em: Date.now() }));
  } catch {
    // Navegador sem armazenamento: segue sem origem, o cadastro não depende disso.
  }
  return nova;
}

/** UTMs aceitas pela Stripe nos links de pagamento: letras, números, - e _, até 150 caracteres. */
export function utmsParaStripe(origem: Origem): [string, string][] {
  return PARAMS_ORIGEM.filter((k) => k !== "fbclid")
    .map((k) => [k, origem[k] ?? ""] as [string, string])
    .filter(([, valor]) => /^[\w-]{1,150}$/.test(valor));
}
