// Regras puras do agente de prospecção (sem Deno, sem banco, sem rede): normalização,
// deduplicação, identificação do sistema, pontuação, agenda, autorização de envio e
// validação das mensagens. Testado em src/test/prospeccao.test.ts.

export type Sistema = "sem_sistema" | "anota_ai" | "concorrente" | "sistema_proprio" | "indeterminado";
export type Confianca = "alta" | "media" | "baixa";
export type Prioridade = "alta" | "media" | "baixa";
export type Publico = "A" | "B";
export type Interesse = "nenhum" | "baixo" | "medio" | "alto";
export type StatusProspect =
  | "novo"
  | "qualificado"
  | "contatado"
  | "respondeu"
  | "interessado"
  | "demonstracao"
  | "cliente"
  | "sem_interesse"
  | "nao_contatar"
  | "desqualificado";

export interface Evidencia {
  tipo: "link" | "texto" | "pagina" | "maps";
  url: string;
  trecho: string;
}

export interface Sinais {
  delivery?: boolean | null;
  retirada?: boolean | null;
  pedidos_whatsapp?: boolean | null;
  ativo_recente?: boolean | null;
  rede_ou_franquia?: boolean | null;
  aberto?: boolean | null;
  seguidores?: number | null;
  avaliacoes?: number | null;
  marketplace?: string[];
}

/** Estabelecimento como chega da pesquisa (IA e/ou Google Maps), antes de qualificar. */
export interface EstabelecimentoBruto {
  nome: string;
  categoria?: string | null;
  cidade?: string | null;
  uf?: string | null;
  bairro?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  site?: string | null;
  telefone?: string | null;
  email?: string | null;
  link_cardapio?: string | null;
  google_place_id?: string | null;
  links?: string[];
  sistema_observado?: Sistema | null;
  evidencias?: Evidencia[];
  sinais?: Sinais;
  fonte?: string | null;
}

export interface ProspectDados {
  nome: string;
  categoria: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  instagram: string | null;
  facebook: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  link_cardapio: string | null;
  google_place_id: string | null;
  sistema: Sistema;
  sistema_confianca: Confianca;
  evidencias: Evidencia[];
  sinais: Sinais;
  pontuacao: number;
  pontuacao_detalhes: Record<string, number>;
  prioridade: Prioridade;
  publico: Publico | null;
  status: StatusProspect;
  motivo_desqualificacao: string | null;
  fonte: string | null;
}

export interface ConfigProspeccao {
  ativo: boolean;
  dias_semana: number[];
  hora_inicio: string;
  hora_fim: string;
  fuso: string;
  minutos_diarios: number;
  meta_qualificados_dia: number;
  meta_contatos_dia: number;
  especialidades: string[];
  estados: string[];
  cidades: string[];
  peso_anota_ai: number;
  peso_sem_sistema: number;
  pontuacao_minima: number;
  limite_gasto_diario_usd: number;
  limite_gasto_mensal_usd: number;
  limite_buscas_web_dia: number;
  limite_places_dia: number;
  limite_respostas_ia_dia: number;
  preco_mensal: number;
  teste_gratis_dias: number;
  bot_whatsapp: "incluso" | "nao_incluso" | "consultar";
  link_site: string;
  link_demo: string;
  nome_remetente: string;
  responder_automatico: boolean;
}

// ---------------------------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------------------------

export const semAcento = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export const normalizarTexto = (s: string | null | undefined): string =>
  semAcento(String(s ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Telefone BR em 10 (fixo) ou 11 (celular) dígitos, sem o 55. Null se não parecer telefone BR. */
export function normalizarTelefoneBR(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1); // 0 + DDD + número
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + "9" + d.slice(2); // celular antigo sem o 9
  if (d.length !== 10 && d.length !== 11) return null;
  if (d.length === 11 && d[2] !== "9") return null;
  if (Number(d.slice(0, 2)) < 11) return null;
  return d;
}

export const ehCelular = (tel: string | null | undefined): boolean => {
  const t = normalizarTelefoneBR(tel);
  return Boolean(t && t.length === 11);
};

/** Número no formato do WhatsApp (55 + DDD + número) ou null se não for celular. */
export const numeroWhatsapp = (tel: string | null | undefined): string | null => {
  const t = normalizarTelefoneBR(tel);
  return t && t.length === 11 ? `55${t}` : null;
};

// DDDs em que o WhatsApp manteve o 9º dígito na identificação da conta (SP, RJ e ES).
// Nos demais, a conta é "55 + DDD + 8 dígitos", sem o 9 da frente.
const DDDS_COM_NONO_DIGITO = new Set(["11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "24", "27", "28"]);

/**
 * Formas do número para o código de pareamento: primeiro a que o WhatsApp costuma usar
 * (sem o 9 fora de SP/RJ/ES), depois a outra. Vazio se não for celular BR.
 */
export function formatosPareamentoBR(tel: string | null | undefined): string[] {
  const t = normalizarTelefoneBR(tel);
  if (!t || t.length !== 11) return [];
  const com9 = `55${t}`;
  const sem9 = `55${t.slice(0, 2)}${t.slice(3)}`;
  return DDDS_COM_NONO_DIGITO.has(t.slice(0, 2)) ? [com9, sem9] : [sem9, com9];
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function parseUrl(raw: string | null | undefined): URL | null {
  const s = String(raw ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  try {
    return new URL(URL_RE.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

export const hostDe = (raw: string | null | undefined): string | null => {
  const u = parseUrl(raw);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "") : null;
};

const IG_RESERVADOS = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct", "about", "legal"]);

export function extrairInstagram(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let handle: string | null = null;
  if (/instagram\.com|instagr\.am/i.test(s)) {
    const u = parseUrl(s);
    handle = u?.pathname.split("/").filter(Boolean)[0] ?? null;
  } else {
    const m = s.match(/^@?([a-z0-9._]{2,30})$/i);
    handle = m ? m[1] : null;
  }
  if (!handle) return null;
  handle = handle.toLowerCase().replace(/^@/, "");
  if (IG_RESERVADOS.has(handle) || !/^[a-z0-9._]{2,30}$/.test(handle)) return null;
  return handle;
}

export function extrairFacebook(raw: string | null | undefined): string | null {
  const u = parseUrl(raw);
  if (!u || !/(^|\.)facebook\.com$|(^|\.)fb\.com$/i.test(u.hostname)) return null;
  const partes = u.pathname.split("/").filter(Boolean);
  if (!partes.length) return null;
  if (partes[0] === "profile.php") return u.searchParams.get("id") ? `id:${u.searchParams.get("id")}` : null;
  if (partes[0] === "pages" && partes.length >= 2) return partes[partes.length - 1].toLowerCase();
  if (["groups", "sharer", "share", "events", "watch", "photo", "story.php", "people"].includes(partes[0])) return null;
  return partes[0].toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// Plataformas conhecidas
// ---------------------------------------------------------------------------------------------

interface Plataforma {
  id: string;
  nome: string;
  tipo: "anota_ai" | "concorrente" | "marketplace" | "agregador" | "rede_social" | "whatsapp";
  hosts: RegExp;
}

// Só plataformas com domínio de cardápio/pedido conhecido. Na dúvida, fica fora:
// classificar errado é pior do que deixar "indeterminado".
const PLATAFORMAS: Plataforma[] = [
  { id: "anota_ai", nome: "Anota AI", tipo: "anota_ai", hosts: /(^|\.)anota\.ai$|(^|\.)anotaai\.com(\.br)?$/ },
  { id: "goomer", nome: "Goomer", tipo: "concorrente", hosts: /(^|\.)goomer\.(app|com\.br|com)$/ },
  { id: "cardapioweb", nome: "Cardápio Web", tipo: "concorrente", hosts: /(^|\.)cardapioweb\.com$/ },
  { id: "olaclick", nome: "OlaClick", tipo: "concorrente", hosts: /(^|\.)olaclick\.(com|app)$/ },
  { id: "menudino", nome: "Menu Dino", tipo: "concorrente", hosts: /(^|\.)menudino\.com$/ },
  { id: "instadelivery", nome: "Instadelivery", tipo: "concorrente", hosts: /(^|\.)instadelivery\.com\.br$/ },
  { id: "deliverydireto", nome: "Delivery Direto", tipo: "concorrente", hosts: /(^|\.)deliverydireto\.com\.br$/ },
  { id: "neemo", nome: "Neemo", tipo: "concorrente", hosts: /(^|\.)neemo\.com\.br$/ },
  { id: "saipos", nome: "Saipos", tipo: "concorrente", hosts: /(^|\.)saipos\.com$/ },
  { id: "kyte", nome: "Kyte", tipo: "concorrente", hosts: /(^|\.)kyte\.site$/ },
  { id: "easyfoodhub", nome: "Easy Food Hub", tipo: "concorrente", hosts: /(^|\.)easyfoodhub\.com\.br$/ },
  { id: "ifood", nome: "iFood", tipo: "marketplace", hosts: /(^|\.)ifood\.com\.br$/ },
  { id: "aiqfome", nome: "aiqfome", tipo: "marketplace", hosts: /(^|\.)aiqfome\.com$/ },
  { id: "rappi", nome: "Rappi", tipo: "marketplace", hosts: /(^|\.)rappi\.com\.br$/ },
  { id: "99food", nome: "99Food", tipo: "marketplace", hosts: /(^|\.)99app\.com$|(^|\.)99food\.com\.br$/ },
  { id: "deliverymuch", nome: "Delivery Much", tipo: "marketplace", hosts: /(^|\.)deliverymuch\.com\.br$/ },
  { id: "whatsapp", nome: "WhatsApp", tipo: "whatsapp", hosts: /(^|\.)wa\.me$|(^|\.)whatsapp\.com$|(^|\.)wa\.link$/ },
  {
    id: "agregador",
    nome: "Agregador de links",
    tipo: "agregador",
    hosts: /(^|\.)(linktr\.ee|linktree\.com|beacons\.ai|bio\.link|lnk\.bio|linkbio\.co|taplink\.cc|campsite\.bio|bit\.ly|tinyurl\.com|encurtador\.com\.br|abre\.ai|linkme\.bio)$/,
  },
  {
    id: "rede_social",
    nome: "Rede social / Google",
    tipo: "rede_social",
    hosts: /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.com|tiktok\.com|youtube\.com|twitter\.com|x\.com|google\.com|goo\.gl|g\.page|maps\.app\.goo\.gl|tripadvisor\.com(\.br)?|threads\.net)$/,
  },
];

export function plataformaDoLink(raw: string | null | undefined): Plataforma | null {
  const host = hostDe(raw);
  if (!host) return null;
  return PLATAFORMAS.find((p) => p.hosts.test(host)) ?? null;
}

/** Link de cardápio Anota AI de verdade (subdomínio ou caminho de loja), não a home institucional. */
const ehLinkCardapioAnota = (raw: string): boolean => {
  const u = parseUrl(raw);
  if (!u) return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!/(^|\.)anota\.ai$|(^|\.)anotaai\.com(\.br)?$/.test(host)) return false;
  const institucional = ["anota.ai", "anotaai.com", "anotaai.com.br", "blog.anota.ai", "ajuda.anota.ai"];
  const caminho = u.pathname.replace(/\/+$/, "");
  return !institucional.includes(host) || caminho.length > 1;
};

/** Domínio próprio do estabelecimento (null para redes sociais, plataformas e agregadores). */
export const dominioProprio = (raw: string | null | undefined): string | null => {
  const host = hostDe(raw);
  if (!host || plataformaDoLink(raw)) return null;
  return host;
};

/** Identificador do link de cardápio numa plataforma (host + caminho), para deduplicar. */
const chaveCardapio = (raw: string | null | undefined): string | null => {
  const u = parseUrl(raw);
  if (!u) return null;
  const p = plataformaDoLink(raw);
  if (!p || p.tipo === "rede_social" || p.tipo === "whatsapp" || p.tipo === "agregador") return null;
  const caminho = u.pathname.replace(/\/+$/, "").toLowerCase();
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!caminho && host.split(".").length <= 2) return null; // só a home da plataforma
  return `${host}${caminho}`;
};

// ---------------------------------------------------------------------------------------------
// Identificação do sistema atual
// ---------------------------------------------------------------------------------------------

export interface ResultadoSistema {
  sistema: Sistema;
  confianca: Confianca;
  evidencias: Evidencia[];
  plataforma: string | null;
  marketplaces: string[];
  pedidosWhatsapp: boolean;
}

// \b do JavaScript não trata "í" como letra: "Anota Aí!" precisa de lookahead.
const MENCAO_ANOTA = /\banota\s*a[ií](?![a-z0-9])|\banotaai\b|anota\.ai/i;

export function detectarSistema(e: EstabelecimentoBruto): ResultadoSistema {
  const links = [...new Set([e.link_cardapio, e.site, ...(e.links ?? [])].filter((l): l is string => Boolean(l)))];
  const evidenciasIa = e.evidencias ?? [];
  const evidencias: Evidencia[] = [];
  const marketplaces = new Set<string>();
  let pedidosWhatsapp = Boolean(e.sinais?.pedidos_whatsapp);

  let anota: string | null = null;
  let concorrente: Plataforma | null = null;
  let concorrenteLink: string | null = null;

  const todosLinks = [...links, ...evidenciasIa.map((ev) => ev.url).filter(Boolean)];
  for (const l of todosLinks) {
    const p = plataformaDoLink(l);
    if (!p) continue;
    if (p.tipo === "anota_ai" && ehLinkCardapioAnota(l)) anota ??= l;
    else if (p.tipo === "concorrente" && !concorrente) {
      concorrente = p;
      concorrenteLink = l;
    } else if (p.tipo === "marketplace") marketplaces.add(p.nome);
    else if (p.tipo === "whatsapp") pedidosWhatsapp = true;
  }

  if (anota) {
    evidencias.push({ tipo: "link", url: anota, trecho: "Link de cardápio/pedidos no domínio do Anota AI" });
    return { sistema: "anota_ai", confianca: "alta", evidencias, plataforma: "Anota AI", marketplaces: [...marketplaces], pedidosWhatsapp };
  }

  // Menção textual (ex.: "peça pelo Anota AI" na bio ou em um post) vale como evidência média.
  const mencao = evidenciasIa.find((ev) => MENCAO_ANOTA.test(ev.trecho || ""));
  if (mencao) {
    evidencias.push({ tipo: "texto", url: mencao.url, trecho: mencao.trecho.slice(0, 280) });
    return { sistema: "anota_ai", confianca: "media", evidencias, plataforma: "Anota AI", marketplaces: [...marketplaces], pedidosWhatsapp };
  }

  if (concorrente && concorrenteLink) {
    evidencias.push({ tipo: "link", url: concorrenteLink, trecho: `Link de pedidos na plataforma ${concorrente.nome}` });
    return { sistema: "concorrente", confianca: "alta", evidencias, plataforma: concorrente.nome, marketplaces: [...marketplaces], pedidosWhatsapp };
  }

  const siteProprio = links.find((l) => dominioProprio(l));
  if (siteProprio && e.sistema_observado === "sistema_proprio") {
    const ev = evidenciasIa.find((x) => hostDe(x.url) === hostDe(siteProprio));
    evidencias.push({ tipo: "link", url: siteProprio, trecho: ev?.trecho?.slice(0, 280) || "Site próprio com pedidos online" });
    return { sistema: "sistema_proprio", confianca: "media", evidencias, plataforma: null, marketplaces: [...marketplaces], pedidosWhatsapp };
  }

  // Sem link de plataforma: pedidos pelo WhatsApp/direct sugerem "sem sistema", mas a ausência
  // de link não prova nada. Por isso a confiança nunca passa de média.
  const temLinkPedidoDesconhecido = links.some((l) => dominioProprio(l) && /pedi|cardapio|menu|delivery|order/i.test(l));
  if (pedidosWhatsapp && !temLinkPedidoDesconhecido) {
    const ev = evidenciasIa.find((x) => /whats|zap|direct|wa\.me|pedido/i.test(`${x.trecho} ${x.url}`));
    evidencias.push({
      tipo: ev ? ev.tipo : "texto",
      url: ev?.url || links[0] || "",
      trecho: ev?.trecho?.slice(0, 280) || "Pedidos pelo WhatsApp, sem link de plataforma de pedidos encontrado",
    });
    const confianca: Confianca = e.instagram || e.site ? "media" : "baixa";
    return { sistema: "sem_sistema", confianca, evidencias, plataforma: null, marketplaces: [...marketplaces], pedidosWhatsapp };
  }

  if (e.sistema_observado === "sem_sistema" && !temLinkPedidoDesconhecido) {
    const ev = evidenciasIa[0];
    if (ev) evidencias.push({ ...ev, trecho: ev.trecho.slice(0, 280) });
    return { sistema: "sem_sistema", confianca: "baixa", evidencias, plataforma: null, marketplaces: [...marketplaces], pedidosWhatsapp };
  }

  // Inclui o caso da IA dizer "anota_ai" sem prova: não confiamos.
  if (evidenciasIa[0]) evidencias.push({ ...evidenciasIa[0], trecho: evidenciasIa[0].trecho.slice(0, 280) });
  return { sistema: "indeterminado", confianca: "baixa", evidencias, plataforma: null, marketplaces: [...marketplaces], pedidosWhatsapp };
}

// ---------------------------------------------------------------------------------------------
// Grandes redes e perfil
// ---------------------------------------------------------------------------------------------

const REDES = [
  "mcdonald", "burger king", "subway", "bob s", "bobs", "habib s", "habibs", "giraffas", "spoleto", "china in box",
  "domino s", "dominos", "pizza hut", "kfc", "popeyes", "outback", "madero", "jeronimo", "starbucks", "coco bambu",
  "divino fogao", "mania de churrasco", "vivenda do camarao", "gendai", "ragazzo", "casa do pao de queijo",
  "oakberry", "chiquinho sorvetes", "kopenhagen", "cacau show", "rei do mate", "montana grill", "griletto",
  "taco bell", "johnny rockets", "applebee", "abbraccio", "paris 6", "pizza prime", "jin jin", "patroni",
  "the best acai", "acai concept", "frango assado", "fifties", "ze delivery", "lugano", "sodie", "brasil cacau",
  "the fifties", "mr pretzels", "baked potato", "cheirin bao", "bendito cacau", "pastel de feira do japa",
];

export function ehRedeOuFranquia(nome: string, sinais?: Sinais): boolean {
  if (sinais?.rede_ou_franquia) return true;
  const n = ` ${normalizarTexto(nome)} `;
  return REDES.some((r) => n.includes(` ${r} `) || n.includes(` ${r}`));
}

// Especialidade → categoria canônica gravada no prospect.
const CATEGORIAS: [RegExp, string][] = [
  [/hamburg|burger|burguer|smash/, "hamburgueria"],
  [/pizz/, "pizzaria"],
  [/acai|açai/, "açaiteria"],
  [/pastel/, "pastelaria"],
  [/sorvet|gelat|picol/, "sorveteria"],
  [/marmit|quentinh|comida caseira|prato feito/, "marmitaria"],
  [/espet|churrasquinh|churrasc/, "espetinho e churrasco"],
  [/lanch|sandu|cachorro quente|hot dog|salgad/, "lanchonete"],
  [/japon|sushi|temaki|oriental/, "comida japonesa"],
  [/restaur|cozinha|bistr|self service|buffet|comida/, "restaurante"],
  [/padar|confeit|doce|bolo|brigad|cafe|cafeteria/, "padaria e doceria"],
  [/frango|galeto|assado/, "frango assado"],
  [/delivery/, "delivery de comida"],
];

export function categoriaCanonica(raw: string | null | undefined): string | null {
  const n = normalizarTexto(raw);
  if (!n) return null;
  for (const [re, cat] of CATEGORIAS) if (re.test(n)) return cat;
  return null;
}

const CATEGORIAS_PRIORITARIAS = new Set([
  "hamburgueria", "pizzaria", "açaiteria", "pastelaria", "sorveteria", "marmitaria", "espetinho e churrasco",
  "lanchonete", "restaurante", "delivery de comida", "comida japonesa", "frango assado",
]);

// ---------------------------------------------------------------------------------------------
// Qualificação e pontuação (0 a 100)
// ---------------------------------------------------------------------------------------------

export function prioridadeDe(pontuacao: number): Prioridade {
  if (pontuacao >= 70) return "alta";
  if (pontuacao >= 45) return "media";
  return "baixa";
}

export interface ResultadoPontuacao {
  total: number;
  detalhes: Record<string, number>;
  prioridade: Prioridade;
}

export function calcularPontuacao(
  p: Pick<ProspectDados, "categoria" | "sistema" | "sistema_confianca" | "sinais" | "telefone" | "instagram" | "email" | "facebook">,
  cfg: Pick<ConfigProspeccao, "peso_anota_ai" | "peso_sem_sistema">,
): ResultadoPontuacao {
  const s = p.sinais || {};
  const d: Record<string, number> = {};

  d.perfil = p.categoria && CATEGORIAS_PRIORITARIAS.has(p.categoria) ? 15 : p.categoria ? 8 : 4;

  d.ativo = s.aberto === false ? 0 : s.ativo_recente ? 15 : s.aberto ? 12 : 5;

  d.delivery_retirada = s.delivery || s.retirada ? 15 : s.delivery === false && s.retirada === false ? 0 : 5;

  const volume = Math.max(Number(s.avaliacoes) || 0, Math.round((Number(s.seguidores) || 0) / 20));
  d.atividade = volume >= 200 ? 10 : volume >= 50 ? 7 : volume > 0 ? 4 : 2;

  const peso = (x: number) => Math.min(Math.max(x, 0), 100) / 100;
  if (p.sistema === "anota_ai") d.sistema = Math.round(10 + 15 * peso(cfg.peso_anota_ai));
  else if (p.sistema === "sem_sistema") d.sistema = Math.round(10 + 15 * peso(cfg.peso_sem_sistema));
  else if (p.sistema === "indeterminado") d.sistema = 6;
  else if (p.sistema === "concorrente") d.sistema = 3;
  else d.sistema = 0;
  if (p.sistema_confianca === "baixa" && (p.sistema === "anota_ai" || p.sistema === "sem_sistema")) d.sistema -= 4;

  d.contato = ehCelular(p.telefone) ? 15 : p.instagram ? (p.telefone ? 11 : 9) : p.telefone ? 7 : p.email || p.facebook ? 4 : 0;

  d.beneficio = s.pedidos_whatsapp ? 5 : s.delivery ? 3 : 1;

  const total = Math.max(0, Math.min(100, Object.values(d).reduce((a, b) => a + b, 0)));
  return { total, detalhes: d, prioridade: prioridadeDe(total) };
}

export const temCanalDeContato = (p: Pick<ProspectDados, "telefone" | "instagram">): boolean =>
  ehCelular(p.telefone) || Boolean(p.instagram);

/** Converte o que veio da pesquisa num prospect qualificado (ou desqualificado, com motivo). */
export function prepararProspect(
  e: EstabelecimentoBruto,
  cfg: Pick<ConfigProspeccao, "peso_anota_ai" | "peso_sem_sistema" | "pontuacao_minima">,
  publico: Publico | null = null,
): ProspectDados {
  const sis = detectarSistema(e);
  const sinais: Sinais = { ...(e.sinais || {}), marketplace: sis.marketplaces, pedidos_whatsapp: sis.pedidosWhatsapp || e.sinais?.pedidos_whatsapp || null };
  const instagram = extrairInstagram(e.instagram) ?? (e.links || []).map(extrairInstagram).find(Boolean) ?? null;
  const facebookSlug = extrairFacebook(e.facebook) ?? (e.links || []).map(extrairFacebook).find(Boolean) ?? null;
  const telefone = normalizarTelefoneBR(e.telefone) ?? (e.links || []).map(telefoneDoLinkWhatsapp).find(Boolean) ?? null;
  const site = dominioProprio(e.site) ? (parseUrl(e.site)?.toString() ?? null) : null;
  const linkCardapio = e.link_cardapio || (sis.sistema === "anota_ai" || sis.sistema === "concorrente" ? sis.evidencias[0]?.url : null) || null;

  const base = {
    nome: e.nome.trim().slice(0, 160),
    categoria: categoriaCanonica(e.categoria) ?? categoriaCanonica(e.nome) ?? (e.categoria ? normalizarTexto(e.categoria).slice(0, 60) : null),
    cidade: e.cidade?.trim() || null,
    uf: e.uf ? e.uf.trim().toUpperCase().slice(0, 2) : null,
    bairro: e.bairro?.trim() || null,
    instagram,
    facebook: facebookSlug ? (e.facebook && parseUrl(e.facebook) ? e.facebook : `https://facebook.com/${facebookSlug}`) : null,
    site,
    telefone,
    email: e.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email) ? e.email.trim().toLowerCase() : null,
    link_cardapio: linkCardapio,
    google_place_id: e.google_place_id || null,
    sistema: sis.sistema,
    sistema_confianca: sis.confianca,
    evidencias: sis.evidencias,
    sinais,
    fonte: e.fonte || null,
  };

  const pont = calcularPontuacao(base, cfg);
  let status: StatusProspect = "novo";
  let motivo: string | null = null;

  if (ehRedeOuFranquia(base.nome, sinais)) motivo = "rede_ou_franquia";
  else if (sinais.aberto === false) motivo = "fechado_ou_inativo";
  else if (sis.sistema === "concorrente" && sis.plataforma === "Easy Food Hub") motivo = "ja_e_cliente";
  else if (base.categoria === null && !categoriaCanonica(`${e.nome} ${e.categoria ?? ""}`)) motivo = "fora_do_perfil";

  if (motivo) status = "desqualificado";
  else if (pont.total >= cfg.pontuacao_minima && temCanalDeContato(base)) status = "qualificado";

  const publicoFinal: Publico | null = sis.sistema === "anota_ai" ? "B" : sis.sistema === "sem_sistema" ? "A" : publico;

  return {
    ...base,
    pontuacao: motivo ? 0 : pont.total,
    pontuacao_detalhes: pont.detalhes,
    prioridade: motivo ? "baixa" : pont.prioridade,
    publico: publicoFinal,
    status,
    motivo_desqualificacao: motivo,
  };
}

function telefoneDoLinkWhatsapp(raw: string | null | undefined): string | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (host === "wa.me") return normalizarTelefoneBR(u.pathname.replace(/\//g, ""));
  if (host.endsWith("whatsapp.com")) return normalizarTelefoneBR(u.searchParams.get("phone"));
  return null;
}

// ---------------------------------------------------------------------------------------------
// Deduplicação
// ---------------------------------------------------------------------------------------------

export interface Identificador {
  tipo: "telefone" | "instagram" | "facebook" | "dominio" | "cardapio" | "place" | "nome_cidade";
  valor: string;
}

const PALAVRAS_GENERICAS = /\b(hamburgueria|pizzaria|lanchonete|restaurante|acaiteria|pastelaria|sorveteria|marmitaria|delivery|lanches|burger|burguer|oficial|ltda|me)\b/g;

export function chavesDedup(
  p: Pick<ProspectDados, "telefone" | "instagram" | "facebook" | "site" | "link_cardapio" | "google_place_id" | "nome" | "cidade" | "uf">,
): Identificador[] {
  const ids: Identificador[] = [];
  const tel = normalizarTelefoneBR(p.telefone);
  if (tel) ids.push({ tipo: "telefone", valor: tel });
  const ig = extrairInstagram(p.instagram);
  if (ig) ids.push({ tipo: "instagram", valor: ig });
  const fb = extrairFacebook(p.facebook);
  if (fb) ids.push({ tipo: "facebook", valor: fb });
  const dom = dominioProprio(p.site);
  if (dom) ids.push({ tipo: "dominio", valor: dom });
  const card = chaveCardapio(p.link_cardapio);
  if (card) ids.push({ tipo: "cardapio", valor: card });
  if (p.google_place_id) ids.push({ tipo: "place", valor: p.google_place_id });
  const nome = normalizarTexto(p.nome).replace(PALAVRAS_GENERICAS, " ").replace(/\s+/g, " ").trim();
  const cidade = normalizarTexto(p.cidade);
  if (nome.length >= 3 && cidade) ids.push({ tipo: "nome_cidade", valor: `${nome}|${cidade}|${(p.uf || "").toLowerCase()}` });
  return ids;
}

const STATUS_TRAVADOS: StatusProspect[] = [
  "contatado", "respondeu", "interessado", "demonstracao", "cliente", "sem_interesse", "nao_contatar", "desqualificado",
];

/**
 * Junta um prospect já salvo com o mesmo estabelecimento achado de novo (outra rede, outra busca).
 * Preenche lacunas, soma evidências e recalcula a pontuação, mas nunca "destrava" quem já foi
 * contatado, recusou ou pediu para não receber mensagens.
 */
export function mesclarProspect(
  existente: ProspectDados & { bloqueado?: boolean },
  novo: ProspectDados,
  cfg: Pick<ConfigProspeccao, "peso_anota_ai" | "peso_sem_sistema" | "pontuacao_minima">,
): ProspectDados {
  const campos = ["categoria", "cidade", "uf", "bairro", "instagram", "facebook", "site", "telefone", "email", "link_cardapio", "google_place_id"] as const;
  const m: ProspectDados = { ...existente };
  for (const c of campos) if (!m[c] && novo[c]) (m as unknown as Record<string, unknown>)[c] = novo[c];

  // Celular vence fixo: é o canal de contato que importa.
  if (!ehCelular(m.telefone) && ehCelular(novo.telefone)) m.telefone = novo.telefone;

  const ordem: Record<Confianca, number> = { alta: 3, media: 2, baixa: 1 };
  const novoMaisForte =
    novo.sistema !== "indeterminado" &&
    (existente.sistema === "indeterminado" || ordem[novo.sistema_confianca] > ordem[existente.sistema_confianca]);
  if (novoMaisForte) {
    m.sistema = novo.sistema;
    m.sistema_confianca = novo.sistema_confianca;
    if (novo.publico) m.publico = novo.publico;
  }

  const vistos = new Set(existente.evidencias.map((e) => `${e.url}|${e.trecho}`));
  m.evidencias = [...existente.evidencias, ...novo.evidencias.filter((e) => !vistos.has(`${e.url}|${e.trecho}`))].slice(0, 12);

  const sinais: Sinais = { ...existente.sinais };
  for (const [k, v] of Object.entries(novo.sinais || {})) {
    const atual = (sinais as Record<string, unknown>)[k];
    if (atual === undefined || atual === null || (typeof v === "number" && typeof atual === "number" && v > atual) || v === true) {
      (sinais as Record<string, unknown>)[k] = v;
    }
  }
  m.sinais = sinais;

  const pont = calcularPontuacao(m, cfg);
  const travado = existente.bloqueado || STATUS_TRAVADOS.includes(existente.status);
  if (!travado) {
    if (novo.status === "desqualificado") {
      m.status = "desqualificado";
      m.motivo_desqualificacao = novo.motivo_desqualificacao;
      m.pontuacao = 0;
      m.prioridade = "baixa";
      return m;
    }
    m.status = pont.total >= cfg.pontuacao_minima && temCanalDeContato(m) ? "qualificado" : "novo";
  }
  m.pontuacao = existente.status === "desqualificado" ? 0 : pont.total;
  m.pontuacao_detalhes = pont.detalhes;
  m.prioridade = existente.status === "desqualificado" ? "baixa" : pont.prioridade;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------------------------

export interface HoraLocal {
  diaSemana: number; // 0 = domingo
  minutos: number; // minutos desde 00:00
  data: string; // YYYY-MM-DD
}

export function horaLocal(agora: Date, fuso: string): HoraLocal {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    diaSemana: dias.indexOf(get("weekday")),
    minutos: Number(get("hour")) * 60 + Number(get("minute")),
    data: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Diferença (minutos) entre o horário local do fuso e UTC naquele instante. */
function offsetMinutos(agora: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const comoUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((comoUtc - Math.floor(agora.getTime() / 1000) * 1000) / 60000);
}

/** Meia-noite de hoje (ou dia 1 do mês) no fuso configurado, como instante UTC. */
export function inicioDoPeriodo(agora: Date, fuso: string, periodo: "dia" | "mes"): Date {
  const [y, m, d] = horaLocal(agora, fuso).data.split("-").map(Number);
  const local = Date.UTC(y, m - 1, periodo === "mes" ? 1 : d);
  return new Date(local - offsetMinutos(new Date(local), fuso) * 60000);
}

export const minutosDoHorario = (hhmm: string): number => {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export function dentroDaAgenda(cfg: Pick<ConfigProspeccao, "dias_semana" | "hora_inicio" | "hora_fim" | "fuso">, agora: Date): boolean {
  const l = horaLocal(agora, cfg.fuso);
  if (!cfg.dias_semana.includes(l.diaSemana)) return false;
  return l.minutos >= minutosDoHorario(cfg.hora_inicio) && l.minutos < minutosDoHorario(cfg.hora_fim);
}

/** Próximo instante (em passos de 5 min) em que a agenda abre. Null se nenhum dia está marcado. */
export function proximaJanela(cfg: Pick<ConfigProspeccao, "dias_semana" | "hora_inicio" | "hora_fim" | "fuso">, agora: Date): Date | null {
  if (!cfg.dias_semana.length) return null;
  const passo = 5 * 60 * 1000;
  let t = new Date(Math.ceil(agora.getTime() / passo) * passo);
  for (let i = 0; i < (8 * 24 * 60) / 5; i++) {
    if (dentroDaAgenda(cfg, t)) return t;
    t = new Date(t.getTime() + passo);
  }
  return null;
}

export interface UsoHoje {
  minutosHoje: number;
  custoHojeUsd: number;
  custoMesUsd: number;
  buscasWebHoje: number;
  qualificadosHoje: number;
}

export type MotivoPausa =
  | "pausado"
  | "fora_da_agenda"
  | "tempo_diario_esgotado"
  | "limite_gasto_diario"
  | "limite_gasto_mensal"
  | "limite_buscas_web"
  | "meta_qualificados_atingida";

export function decidirExecucao(
  cfg: ConfigProspeccao,
  agora: Date,
  uso: UsoHoje,
  opts: { manual?: boolean } = {},
): { executar: true } | { executar: false; motivo: MotivoPausa } {
  if (!opts.manual) {
    if (!cfg.ativo) return { executar: false, motivo: "pausado" };
    if (!dentroDaAgenda(cfg, agora)) return { executar: false, motivo: "fora_da_agenda" };
    if (uso.minutosHoje >= cfg.minutos_diarios) return { executar: false, motivo: "tempo_diario_esgotado" };
    if (uso.qualificadosHoje >= cfg.meta_qualificados_dia) return { executar: false, motivo: "meta_qualificados_atingida" };
  }
  // Limites de gasto valem até para o botão "Executar agora".
  if (uso.custoHojeUsd >= cfg.limite_gasto_diario_usd) return { executar: false, motivo: "limite_gasto_diario" };
  if (uso.custoMesUsd >= cfg.limite_gasto_mensal_usd) return { executar: false, motivo: "limite_gasto_mensal" };
  if (uso.buscasWebHoje >= cfg.limite_buscas_web_dia) return { executar: false, motivo: "limite_buscas_web" };
  return { executar: true };
}

/** Quando o agente volta a trabalhar, dado o motivo de não ter executado agora. */
export function proximaExecucao(cfg: ConfigProspeccao, motivo: MotivoPausa | null, agora: Date): Date | null {
  if (motivo === "pausado" || !cfg.ativo) return null;
  const dia = 24 * 3600 * 1000;
  if (motivo === null) {
    const t = new Date(Math.ceil((agora.getTime() + 1000) / 300000) * 300000);
    return dentroDaAgenda(cfg, t) ? t : proximaJanela(cfg, t);
  }
  if (motivo === "fora_da_agenda") return proximaJanela(cfg, agora);
  if (motivo === "limite_gasto_mensal") {
    const mes = inicioDoPeriodo(agora, cfg.fuso, "mes");
    return proximaJanela(cfg, inicioDoPeriodo(new Date(mes.getTime() + 32 * dia), cfg.fuso, "mes"));
  }
  return proximaJanela(cfg, inicioDoPeriodo(new Date(agora.getTime() + dia), cfg.fuso, "dia"));
}

// ---------------------------------------------------------------------------------------------
// Geração de pesquisas (Brasil inteiro, capitais e interior)
// ---------------------------------------------------------------------------------------------

export const CAPITAIS: [string, string][] = [
  ["Salvador", "BA"], ["São Paulo", "SP"], ["Belo Horizonte", "MG"], ["Recife", "PE"], ["Curitiba", "PR"],
  ["Fortaleza", "CE"], ["Rio de Janeiro", "RJ"], ["Goiânia", "GO"], ["Porto Alegre", "RS"], ["Manaus", "AM"],
  ["Belém", "PA"], ["São Luís", "MA"], ["Natal", "RN"], ["João Pessoa", "PB"], ["Maceió", "AL"], ["Aracaju", "SE"],
  ["Teresina", "PI"], ["Florianópolis", "SC"], ["Vitória", "ES"], ["Cuiabá", "MT"], ["Campo Grande", "MS"],
  ["Brasília", "DF"], ["Palmas", "TO"], ["Porto Velho", "RO"], ["Rio Branco", "AC"], ["Macapá", "AP"], ["Boa Vista", "RR"],
];

const POLOS_POR_UF: Record<string, string[]> = {
  BA: ["Feira de Santana", "Vitória da Conquista", "Camaçari", "Juazeiro", "Itabuna", "Ilhéus", "Lauro de Freitas", "Jequié", "Teixeira de Freitas", "Barreiras", "Alagoinhas", "Porto Seguro", "Santo Antônio de Jesus", "Paulo Afonso", "Luís Eduardo Magalhães"],
  SP: ["Campinas", "Guarulhos", "São José dos Campos", "Ribeirão Preto", "Sorocaba", "Santos", "São José do Rio Preto", "Piracicaba", "Bauru", "Jundiaí", "Franca", "Presidente Prudente", "Marília", "Araraquara", "São Carlos", "Limeira", "Taubaté", "Americana", "Araçatuba", "Botucatu", "Rio Claro", "Itapetininga"],
  MG: ["Uberlândia", "Contagem", "Juiz de Fora", "Montes Claros", "Uberaba", "Governador Valadares", "Ipatinga", "Divinópolis", "Sete Lagoas", "Poços de Caldas", "Patos de Minas", "Pouso Alegre", "Varginha", "Teófilo Otoni", "Lavras"],
  RJ: ["Niterói", "Campos dos Goytacazes", "Petrópolis", "Volta Redonda", "Macaé", "Nova Friburgo", "Cabo Frio", "Resende"],
  PR: ["Londrina", "Maringá", "Ponta Grossa", "Cascavel", "Foz do Iguaçu", "Guarapuava", "Toledo", "Apucarana", "Umuarama", "Campo Mourão"],
  SC: ["Joinville", "Blumenau", "Chapecó", "Itajaí", "Criciúma", "Lages", "Balneário Camboriú", "Jaraguá do Sul"],
  RS: ["Caxias do Sul", "Pelotas", "Santa Maria", "Passo Fundo", "Novo Hamburgo", "Santa Cruz do Sul", "Lajeado", "Erechim", "Uruguaiana"],
  GO: ["Anápolis", "Aparecida de Goiânia", "Rio Verde", "Jataí", "Itumbiara", "Catalão"],
  MT: ["Rondonópolis", "Sinop", "Várzea Grande", "Tangará da Serra", "Sorriso"],
  MS: ["Dourados", "Três Lagoas", "Corumbá"],
  PE: ["Caruaru", "Petrolina", "Jaboatão dos Guararapes", "Olinda", "Garanhuns", "Vitória de Santo Antão"],
  CE: ["Juazeiro do Norte", "Sobral", "Crato", "Maracanaú", "Iguatu"],
  PB: ["Campina Grande", "Patos", "Sousa"],
  RN: ["Mossoró", "Parnamirim", "Caicó"],
  AL: ["Arapiraca", "Palmeira dos Índios"],
  SE: ["Itabaiana", "Lagarto", "Nossa Senhora do Socorro"],
  PI: ["Parnaíba", "Picos", "Floriano"],
  MA: ["Imperatriz", "Caxias", "Timon", "Bacabal"],
  PA: ["Ananindeua", "Santarém", "Marabá", "Castanhal", "Parauapebas"],
  AM: ["Parintins", "Itacoatiara"],
  TO: ["Araguaína", "Gurupi"],
  RO: ["Ji-Paraná", "Ariquemes", "Vilhena"],
  AC: ["Cruzeiro do Sul"],
  AP: ["Santana"],
  ES: ["Vila Velha", "Serra", "Cariacica", "Cachoeiro de Itapemirim", "Linhares", "Colatina"],
};

/** Capitais primeiro, depois cidades-polo do interior alternando estados (varre o país todo). */
export function cidadesBase(): [string, string][] {
  const lista: [string, string][] = [...CAPITAIS];
  const ufs = Object.keys(POLOS_POR_UF);
  const maior = Math.max(...ufs.map((u) => POLOS_POR_UF[u].length));
  for (let i = 0; i < maior; i++) for (const uf of ufs) if (POLOS_POR_UF[uf][i]) lista.push([POLOS_POR_UF[uf][i], uf]);
  return lista;
}

/** "Feira de Santana - BA", "Feira de Santana/BA" ou "Feira de Santana, BA". */
export function parseCidade(s: string): [string, string] | null {
  const m = String(s).trim().match(/^(.+?)\s*[-/,]\s*([A-Za-z]{2})$/);
  return m ? [m[1].trim(), m[2].toUpperCase()] : null;
}

export interface BuscaPlanejada {
  chave: string;
  consulta: string;
  especialidade: string;
  cidade: string;
  uf: string;
  publico: Publico;
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function textoConsulta(esp: string, cidade: string, uf: string, publico: Publico, variante: number): string {
  const A = [
    `${esp} delivery em ${cidade} ${uf} pedidos pelo WhatsApp`,
    `${esp} em ${cidade} ${uf} instagram delivery`,
    `${esp} ${cidade} ${uf} faça seu pedido no WhatsApp`,
  ];
  const B = [
    `${esp} ${cidade} ${uf} "anota.ai"`,
    `${esp} em ${cidade} ${uf} cardápio digital Anota AI`,
    `"anota.ai" ${esp} ${cidade}`,
  ];
  const lista = publico === "A" ? A : B;
  return lista[variante % lista.length];
}

/**
 * Próxima pesquisa ainda não feita. Mistura cidade × especialidade × público para não
 * passar o dia numa cidade só; a proporção Anota AI / sem sistema segue os pesos.
 */
export function proximaBusca(
  cfg: Pick<ConfigProspeccao, "especialidades" | "estados" | "cidades" | "peso_anota_ai" | "peso_sem_sistema">,
  jaFeitas: Set<string>,
  extras: [string, string][] = [],
  contador = 0,
): BuscaPlanejada | null {
  let cidades: [string, string][] = cfg.cidades.map(parseCidade).filter((c): c is [string, string] => Boolean(c));
  if (!cidades.length) {
    const base = [...cidadesBase(), ...extras];
    const estados = new Set(cfg.estados.map((e) => e.toUpperCase()));
    cidades = estados.size ? base.filter(([, uf]) => estados.has(uf)) : base;
  }
  const esps = cfg.especialidades.length ? cfg.especialidades : ["hamburgueria", "pizzaria", "lanchonete"];
  if (!cidades.length) return null;

  const pa = Math.max(cfg.peso_anota_ai, 0);
  const ps = Math.max(cfg.peso_sem_sistema, 0);
  // Público desta rodada pela proporção dos pesos (determinístico pelo contador).
  const fracaoB = pa + ps === 0 ? 0.5 : pa / (pa + ps);
  const preferido: Publico = (contador * 0.618034) % 1 < fracaoB ? "B" : "A";
  const ordemPublicos: Publico[] = preferido === "B" ? ["B", "A"] : ["A", "B"];

  for (const publico of ordemPublicos) {
    if ((publico === "B" && pa === 0) || (publico === "A" && ps === 0)) continue;
    // Percorre em diagonal (cidade i, especialidade j) para espalhar pelo país.
    const total = cidades.length * esps.length;
    for (let k = 0; k < total; k++) {
      const j = k % esps.length;
      const i = (Math.floor(k / esps.length) + j * 3) % cidades.length;
      const [cidade, uf] = cidades[i];
      const esp = esps[j];
      const chave = `${publico}|${normalizarTexto(esp)}|${normalizarTexto(cidade)}|${uf.toLowerCase()}`;
      if (jaFeitas.has(chave)) continue;
      return { chave, consulta: textoConsulta(esp, cidade, uf, publico, hash(chave)), especialidade: esp, cidade, uf, publico };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Mensagens: validação, abertura e modelo de reserva
// ---------------------------------------------------------------------------------------------

export interface ContextoMensagem {
  tipo: "primeiro_contato" | "followup" | "resposta";
  sistema: Sistema;
  sistemaConfianca: Confianca;
  precoMensal: number;
  testeGratisDias: number;
  valoresPermitidos?: number[];
}

const PROIBIDOS: [RegExp, string][] = [
  [/\b(fiz|fizemos) (um |uns )?pedido|\bpedi (a[ií](?![a-z0-9])|com voc[eê]s|de voc[eê]s)/i, "finge que fez pedido"],
  [/\b(provei|experimentei|comi a[ií]|testei o card[aá]pio|testamos o card[aá]pio)/i, "finge que provou ou testou"],
  [/\bsou (seu |sua |um |uma )?cliente\b|\bcomo cliente de voc[eê]s/i, "finge ser cliente"],
  [/aumenta(r|mos|rá)? (suas |as |em )?(vendas|pedidos|faturamento) em \d|\b\d+ ?% (a mais|de aumento)/i, "promete resultado"],
  [/\bgarant(o|imos|ido|ia de resultado)/i, "promete garantia"],
  [/\b(anota ?a[ií])(?![a-z0-9]).{0,40}\b(ruim|p[eé]ssimo|caro demais|fraco|lixo|horr[ií]vel)/i, "ataca concorrente"],
  [/(card[aá]pio|perfil|p[aá]gina|fotos?|lanches?|trabalho)\s+(?:[eé]|s[aã]o|est[aá]|t[aá]|ficou|ficaram|muito|super|t[aã]o)?\s*(?:muito |super |t[aã]o )?(incr[ií]ve(l|is)|maravilhos[oa]s?|sensaciona(l|is)|perfeit[oa]s?|top demais|lind[oa]s?|espetacula(r|res))/i, "elogio artificial"],
  [/\b(desconto|promo[cç][aã]o de lan[cç]amento|primeiro m[eê]s (gr[aá]tis|de gra[cç]a)|cashback)\b/i, "oferece condição não configurada"],
];

export function semTravessao(texto: string): string {
  return texto
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/(\S) - (\S)/g, "$1, $2")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1");
}

export interface ValidacaoMensagem {
  ok: boolean;
  texto: string;
  problemas: string[];
}

export function validarMensagem(bruto: string, ctx: ContextoMensagem): ValidacaoMensagem {
  const texto = semTravessao(String(bruto || "").trim()).replace(/\n{3,}/g, "\n\n");
  const problemas: string[] = [];

  if (!texto) problemas.push("vazia");
  const limite = ctx.tipo === "resposta" ? 900 : 480;
  if (texto.length > limite) problemas.push(`longa demais (${texto.length} caracteres)`);

  for (const [re, motivo] of PROIBIDOS) if (re.test(texto)) problemas.push(motivo);

  if (/\banota ?a[ií](?![a-z0-9])|anota\.ai/i.test(texto) && ctx.sistema !== "anota_ai" && ctx.tipo !== "resposta") {
    problemas.push("cita Anota AI sem evidência de uso");
  }
  if (ctx.tipo === "primeiro_contato" && !/easy ?food ?hub/i.test(texto)) problemas.push("não se identifica como Easy Food Hub");

  if (/gr[aá]tis|gratuit|de gra[cç]a|teste (de|por) \d+ dias/i.test(texto) && ctx.testeGratisDias <= 0) {
    problemas.push("oferece teste grátis não configurado");
  }

  const permitidos = new Set([ctx.precoMensal, ...(ctx.valoresPermitidos ?? [])].map((v) => Math.round(v * 100)));
  for (const m of texto.matchAll(/R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/g)) {
    const valor = Number(m[1].replace(/\./g, "")) + (m[2] ? Number(m[2]) / 100 : 0);
    if (!permitidos.has(Math.round(valor * 100))) problemas.push(`valor não confirmado (R$ ${valor})`);
  }

  return { ok: problemas.length === 0, texto, problemas };
}

/** Primeiras palavras da mensagem, para não repetir sempre a mesma abertura. */
export const aberturaDe = (texto: string): string => normalizarTexto(texto).split(" ").slice(0, 4).join(" ");

const ARTIGO_CATEGORIA: Record<string, string> = {
  hamburgueria: "hamburgueria",
  pizzaria: "pizzaria",
  "açaiteria": "açaíteria",
  pastelaria: "pastelaria",
  sorveteria: "sorveteria",
  marmitaria: "marmitaria",
  lanchonete: "lanchonete",
  restaurante: "restaurante",
};

/** Mensagem de reserva (sem IA), personalizada só com dados públicos reais. */
export function mensagemReserva(
  p: Pick<ProspectDados, "nome" | "categoria" | "cidade" | "sistema" | "sistema_confianca" | "sinais">,
  cfg: Pick<ConfigProspeccao, "nome_remetente">,
  semente: string,
): string {
  const quem = cfg.nome_remetente.trim() ? `Aqui é ${cfg.nome_remetente.trim()}, do Easy Food Hub` : "Aqui é do Easy Food Hub";
  const tipo = (p.categoria && ARTIGO_CATEGORIA[p.categoria]) || "casa";
  const local = p.cidade ? ` aqui de ${p.cidade}` : "";
  const v = hash(semente) % 3;

  if (p.sistema === "anota_ai" && p.sistema_confianca === "alta") {
    const opcoes = [
      `Oi, tudo bem? ${quem}, uma plataforma de cardápio digital e gestão de pedidos. Vi que a ${p.nome} recebe pedidos pelo Anota AI. Trabalho com uma alternativa que pode sair mais em conta, dependendo do plano que vocês usam. Faz sentido eu te mostrar para vocês compararem?`,
      `Olá! ${quem}. Encontrei o cardápio da ${p.nome} no Anota AI e queria fazer uma pergunta rápida: vocês estão satisfeitos com o custo atual? Temos um sistema de cardápio e pedidos que pode ficar mais barato, conforme os recursos que vocês usam. Posso te apresentar?`,
      `Oi! ${quem}. Vi que a ${p.nome} usa o Anota AI para os pedidos. Se em algum momento vocês quiserem comparar preço e recursos com outra opção, o Easy Food Hub pode ser uma alternativa mais econômica. Quer que eu te mande os detalhes?`,
    ];
    return opcoes[v];
  }
  if (p.sistema === "anota_ai") {
    return `Oi, tudo bem? ${quem}. Vi que a ${p.nome} tem cardápio online e queria fazer uma pergunta rápida: vocês usam o Anota AI hoje? Trabalho com uma alternativa de cardápio e gestão de pedidos que pode sair mais em conta, dependendo do plano. Se fizer sentido, posso te apresentar.`;
  }
  const delivery = p.sinais?.delivery ? " e vi que vocês trabalham com delivery" : "";
  const opcoes = [
    `Oi, tudo bem? ${quem}. Encontrei a ${tipo} de vocês${local}${delivery}. Queria saber: hoje os pedidos chegam mais pelo WhatsApp ou vocês já usam algum sistema de cardápio e pedidos online?`,
    `Olá! ${quem}, um sistema de cardápio digital e pedidos para restaurantes. Vi a ${p.nome}${local} e fiquei curioso: como vocês organizam os pedidos do delivery hoje, pelo WhatsApp mesmo?`,
    `Oi! ${quem}. Achei a ${p.nome}${local}${delivery}. Vocês já têm um link de cardápio onde o cliente monta o pedido sozinho, ou tudo passa pelo WhatsApp? Pergunto porque trabalho justamente com isso.`,
  ];
  return opcoes[v];
}

/** Único follow-up permitido, alguns dias depois do primeiro contato sem resposta. */
export function mensagemFollowup(semente: string): string {
  const opcoes = [
    "Oi, tudo bem? Passando só para saber se você viu minha mensagem sobre o Easy Food Hub. Se não fizer sentido agora, sem problema, é só me avisar que eu não insisto.",
    "Olá! Retomando rapidinho o contato do Easy Food Hub: posso te mandar mais detalhes sobre o cardápio digital e os pedidos online? Se não for o momento, tudo bem também.",
  ];
  return opcoes[hash(semente) % opcoes.length];
}

export const DIAS_PARA_FOLLOWUP = 4;

// ---------------------------------------------------------------------------------------------
// Respostas dos prospects
// ---------------------------------------------------------------------------------------------

export const INTENCOES = [
  "interesse",
  "pergunta_preco",
  "pergunta_funcionalidade",
  "quer_demonstracao",
  "pediu_link",
  "objecao_preco",
  "usa_outro_sistema",
  "sem_interesse",
  "nao_contatar",
  "ambigua",
  "precisa_humano",
] as const;
export type Intencao = (typeof INTENCOES)[number];

const NAO_CONTATAR =
  /\b(pare|para) de (me )?(mandar|enviar)|n[aã]o (me )?(mande|envie|chame) mais|me (tire|tira|remova|remove) (da|dessa|desta) lista|\bdescadastr|\bspam\b|vou (te )?bloquear|\bsair da lista\b|n[aã]o quero (mais )?receber/i;
const SEM_INTERESSE =
  /\bn[aã]o (tenho|temos) interesse|\bsem interesse\b|n[aã]o (preciso|precisamos|queremos|quero)(,| )?(obrigad[oa])?\.?$|\bn[aã]o,? obrigad[oa]|\bdispenso\b|n[aã]o (estou|estamos) interessad/i;

/** Recusa explícita detectada sem IA (vale mesmo se a IA estiver fora do ar). */
export function detectarRecusa(texto: string): "nao_contatar" | "sem_interesse" | null {
  const t = String(texto || "").trim();
  if (NAO_CONTATAR.test(t)) return "nao_contatar";
  if (SEM_INTERESSE.test(t)) return "sem_interesse";
  return null;
}

export interface EfeitoIntencao {
  status: StatusProspect;
  interesse: Interesse | null;
  bloquear: boolean;
  humano: boolean;
  proximaAcao: string;
}

export function efeitoDaIntencao(intencao: Intencao, statusAtual: StatusProspect): EfeitoIntencao {
  const avancado = (s: StatusProspect) => (["demonstracao", "cliente"].includes(statusAtual) ? statusAtual : s);
  switch (intencao) {
    case "nao_contatar":
      return { status: "nao_contatar", interesse: "nenhum", bloquear: true, humano: false, proximaAcao: "Não contatar novamente" };
    case "sem_interesse":
      return { status: "sem_interesse", interesse: "nenhum", bloquear: true, humano: false, proximaAcao: "Encerrado: sem interesse" };
    case "quer_demonstracao":
      return { status: avancado("demonstracao"), interesse: "alto", bloquear: false, humano: true, proximaAcao: "Agendar demonstração" };
    case "interesse":
    case "pediu_link":
      return { status: avancado("interessado"), interesse: "alto", bloquear: false, humano: false, proximaAcao: "Acompanhar e fechar contratação" };
    case "pergunta_preco":
    case "pergunta_funcionalidade":
      return { status: avancado("interessado"), interesse: "medio", bloquear: false, humano: false, proximaAcao: "Responder dúvidas" };
    case "objecao_preco":
      return { status: avancado("respondeu"), interesse: "baixo", bloquear: false, humano: false, proximaAcao: "Tratar objeção de preço" };
    case "usa_outro_sistema":
      return { status: avancado("respondeu"), interesse: "baixo", bloquear: false, humano: false, proximaAcao: "Comparar com o sistema atual" };
    case "precisa_humano":
      return { status: avancado("respondeu"), interesse: null, bloquear: false, humano: true, proximaAcao: "Atendimento humano" };
    default:
      return { status: avancado("respondeu"), interesse: null, bloquear: false, humano: false, proximaAcao: "Aguardar resposta" };
  }
}

export const MENSAGEM_ENCERRAMENTO: Record<"nao_contatar" | "sem_interesse", string> = {
  nao_contatar: "Tudo certo, não vou mais enviar mensagens. Desculpe o incômodo e boas vendas!",
  sem_interesse: "Sem problema, obrigado pelo retorno! Não vou insistir. Boas vendas!",
};

// ---------------------------------------------------------------------------------------------
// Comparação de preço (só com valor informado pelo próprio prospect ou fonte confiável)
// ---------------------------------------------------------------------------------------------

/** Valor mensal citado na mensagem ("pago 289 por mês", "R$ 249,90 mensal"). Null se não houver. */
export function extrairValorMensal(texto: string): number | null {
  const t = String(texto || "").toLowerCase();
  if (!/m[eê]s|mensal|mensalidade|por m[eê]s|\/m[eê]s/.test(t)) return null;
  const m = t.match(/(?:r\$\s?)?(\d{2,4})(?:[.,](\d{2}))?\s*(?:reais|real|r\$)?\s*(?:por m[eê]s|\/\s?m[eê]s|mensa|ao m[eê]s|no m[eê]s|todo m[eê]s)/) ||
    t.match(/(?:pago|pagamos|pagando|custa|sai|plano de|mensalidade de|mensalidade [eé])\s*(?:uns |umas |cerca de |quase )?(?:r\$\s?)?(\d{2,4})(?:[.,](\d{2}))?/);
  if (!m) return null;
  const v = Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0);
  return v >= 20 && v <= 5000 ? v : null;
}

export interface ComparacaoPreco {
  valorConcorrente: number;
  nossoPreco: number;
  diferencaMensal: number;
  diferencaAnual: number;
  maisBarato: boolean;
}

export function compararPreco(valorConcorrente: number | null | undefined, nossoPreco: number): ComparacaoPreco | null {
  const v = Number(valorConcorrente);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(nossoPreco) || nossoPreco <= 0) return null;
  const diferencaMensal = Math.round((v - nossoPreco) * 100) / 100;
  return {
    valorConcorrente: v,
    nossoPreco,
    diferencaMensal,
    diferencaAnual: Math.round(diferencaMensal * 12 * 100) / 100,
    maisBarato: diferencaMensal > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Autorização de envio (nenhuma mensagem sai sem passar por aqui)
// ---------------------------------------------------------------------------------------------

export type OrigemEnvio = "operador" | "agente" | "cron";
export type TipoEnvio = "primeiro_contato" | "followup" | "resposta" | "encerramento";

export interface PedidoEnvio {
  origem: OrigemEnvio;
  tipo: TipoEnvio;
  prospect: {
    status: StatusProspect;
    bloqueado: boolean;
    telefone: string | null;
    atendimento_humano: boolean;
    contatado_em: string | null;
    followups: number;
  };
  ultimaEntradaEm: string | null;
  contatosHoje: number;
  respostasIaHoje: number;
  cfg: Pick<ConfigProspeccao, "meta_contatos_dia" | "limite_respostas_ia_dia" | "responder_automatico" | "fuso">;
  agora: Date;
}

export function autorizarEnvio(p: PedidoEnvio): { ok: true } | { ok: false; motivo: string } {
  const pr = p.prospect;
  if (!numeroWhatsapp(pr.telefone)) return { ok: false, motivo: "Sem celular/WhatsApp válido" };

  if (p.tipo === "encerramento") {
    return p.origem === "agente" ? { ok: true } : { ok: false, motivo: "Encerramento só é enviado pelo agente" };
  }

  if (pr.bloqueado || ["nao_contatar", "sem_interesse", "desqualificado"].includes(pr.status)) {
    return { ok: false, motivo: "Estabelecimento bloqueado para novos contatos" };
  }

  if (p.tipo === "primeiro_contato" || p.tipo === "followup") {
    // Abordagem ativa nunca sai sozinha: precisa do clique do operador.
    if (p.origem !== "operador") return { ok: false, motivo: "Primeiro contato e follow-up exigem envio pelo operador" };
    if (p.tipo === "primeiro_contato" && pr.contatado_em) return { ok: false, motivo: "Já foi contatado" };
    if (p.tipo === "followup") {
      if (!pr.contatado_em) return { ok: false, motivo: "Ainda não houve primeiro contato" };
      if (p.ultimaEntradaEm) return { ok: false, motivo: "Já respondeu: continue a conversa" };
      if (pr.followups >= 1) return { ok: false, motivo: "Follow-up já enviado (máximo 1)" };
    }
    if (p.contatosHoje >= p.cfg.meta_contatos_dia) return { ok: false, motivo: "Limite diário de contatos atingido" };
    const { minutos } = horaLocal(p.agora, p.cfg.fuso);
    if (minutos < 8 * 60 || minutos >= 20 * 60) return { ok: false, motivo: "Contatos comerciais só entre 8h e 20h" };
    return { ok: true };
  }

  // Resposta: só dentro de uma conversa que o prospect continuou.
  if (!p.ultimaEntradaEm) return { ok: false, motivo: "Prospect não escreveu nada para responder" };
  if (p.agora.getTime() - new Date(p.ultimaEntradaEm).getTime() > 24 * 3600 * 1000) {
    return { ok: false, motivo: "Última mensagem do prospect tem mais de 24h" };
  }
  if (p.origem === "agente") {
    if (!p.cfg.responder_automatico) return { ok: false, motivo: "Resposta automática desligada" };
    if (pr.atendimento_humano) return { ok: false, motivo: "Conversa com atendimento humano" };
    if (p.respostasIaHoje >= p.cfg.limite_respostas_ia_dia) return { ok: false, motivo: "Limite diário de respostas da IA" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Custos e erros
// ---------------------------------------------------------------------------------------------

// Preços em USD (Claude Opus 5.5: US$ 4 / US$ 20 por milhão de tokens; busca web US$ 10 por mil;
// Google Places Text Search com telefone/site: estimativa conservadora por chamada).
export const PRECOS = { entradaPorMilhao: 4, saidaPorMilhao: 20, cacheLeituraPorMilhao: 0.2, buscaWeb: 0.01, places: 0.04 };

export function custoUsd(u: { entrada?: number; saida?: number; cacheLeitura?: number; buscasWeb?: number; places?: number }): number {
  const c =
    ((u.entrada || 0) * PRECOS.entradaPorMilhao +
      (u.saida || 0) * PRECOS.saidaPorMilhao +
      (u.cacheLeitura || 0) * PRECOS.cacheLeituraPorMilhao) /
      1_000_000 +
    (u.buscasWeb || 0) * PRECOS.buscaWeb +
    (u.places || 0) * PRECOS.places;
  return Math.round(c * 10000) / 10000;
}

export type TipoErro = "autenticacao" | "limite" | "indisponivel" | "configuracao" | "outro";

export function classificarErro(err: unknown): { tipo: TipoErro; mensagem: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const status = Number((err as { status?: number })?.status) || Number(msg.match(/HTTP (\d{3})/)?.[1]) || 0;
  if (status === 401 || status === 403 || /invalid x-api-key|authentication|api key not valid|PERMISSION_DENIED|unauthorized/i.test(msg)) {
    return { tipo: "autenticacao", mensagem: msg };
  }
  if (status === 429 || /rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(msg)) return { tipo: "limite", mensagem: msg };
  if (status >= 500 || /timeout|timed out|ECONNRESET|fetch failed|overloaded|network/i.test(msg)) {
    return { tipo: "indisponivel", mensagem: msg };
  }
  if (/não configurad|ausente|missing|not configured/i.test(msg)) return { tipo: "configuracao", mensagem: msg };
  return { tipo: "outro", mensagem: msg };
}

/** Texto com os fatos comerciais confirmados. A IA não pode afirmar nada além disto. */
export function fatosDoProduto(cfg: Pick<ConfigProspeccao, "preco_mensal" | "teste_gratis_dias" | "bot_whatsapp" | "link_site" | "link_demo" | "nome_remetente">): string {
  const preco = cfg.preco_mensal.toFixed(2).replace(".", ",").replace(",00", "");
  const linhas = [
    `PREÇO: R$ ${preco} por mês (plano único). Não existem descontos, promoções ou outros planos além disto.`,
    cfg.teste_gratis_dias > 0
      ? `TESTE: ${cfg.teste_gratis_dias} dias grátis para testar antes de pagar.`
      : "TESTE GRÁTIS: não oferecemos. Não mencione teste grátis.",
    cfg.bot_whatsapp === "incluso"
      ? "ROBÔ DE WHATSAPP COM IA: incluso no preço."
      : cfg.bot_whatsapp === "nao_incluso"
        ? "ROBÔ DE WHATSAPP COM IA: não está incluso no preço; o valor é combinado com a equipe (encaminhe para humano)."
        : "ROBÔ DE WHATSAPP COM IA: existe, mas condições e valor devem ser confirmados com a equipe (encaminhe para humano se perguntarem).",
    `SITE: ${cfg.link_site} (apresentação do sistema, recursos e contato). Pode enviar quando quiserem conhecer melhor.`,
    "CONTRATAÇÃO: não existe cadastro sozinho pelo site; a conta é ativada pela nossa equipe. Nunca mande link de cadastro ou login. Quem quiser contratar, testar ou ver o sistema funcionando é atendido por uma pessoa da equipe (encaminhe para humano).",
    cfg.link_demo ? `CARDÁPIO DE DEMONSTRAÇÃO: ${cfg.link_demo}` : "Não há link de demonstração; se pedirem demonstração, encaminhe para humano.",
    cfg.nome_remetente ? `Você fala em nome de ${cfg.nome_remetente}, do Easy Food Hub.` : "Você fala em nome do Easy Food Hub.",
    "",
    "RECURSOS CONFIRMADOS NO SISTEMA (só cite estes):",
    "- Cardápio digital com link próprio, categorias, fotos, adicionais e complementos",
    "- Pedidos online para delivery e retirada, com taxa de entrega por bairro",
    "- Painel de pedidos do delivery, acompanhamento do pedido pelo cliente e avaliação",
    "- Mesas e atendimento no salão, com impressão de pedidos em impressora térmica",
    "- Cupons de desconto e promoções configuráveis pela loja",
    "- Programa de fidelidade com pontos e recompensas",
    "- Cadastro de clientes e histórico de pedidos",
    "- Financeiro: caixa, contas a pagar e receber, fornecedores e relatórios",
    "- Estoque com ficha técnica e lucro por produto",
    "- Marketing automático no WhatsApp para clientes que sumiram e para a segunda compra",
    "- Integração com WhatsApp (notificações de pedido) e robô de atendimento com IA",
    "- Pagamento por Pix online (Mercado Pago)",
    "",
    "NÃO PROMETA: migração automática de cardápio ou de dados de outro sistema, aplicativo próprio nas lojas de apps, integração com iFood, números de aumento de vendas, prazos de implantação.",
  ];
  return linhas.join("\n");
}
