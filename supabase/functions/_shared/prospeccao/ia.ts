// Chamadas ao Claude do agente de prospecção: pesquisa na web (web_search + web_fetch),
// redação da primeira mensagem e atendimento das respostas.
//
// Requer ANTHROPIC_API_KEY. Modelo configurável por PROSPECCAO_IA_MODEL.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import {
  type BuscaPlanejada,
  type ComparacaoPreco,
  type ConfigProspeccao,
  type EstabelecimentoBruto,
  type Intencao,
  INTENCOES,
  type Interesse,
  type Sistema,
  fatosDoProduto,
} from "./core.ts";

const MODEL = Deno.env.get("PROSPECCAO_IA_MODEL") || "claude-opus-5-5";

export interface UsoIa {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  buscasWeb: number;
}

const usoVazio = (): UsoIa => ({ entrada: 0, saida: 0, cacheLeitura: 0, buscasWeb: 0 });

export const iaDisponivel = (): boolean => Boolean(Deno.env.get("ANTHROPIC_API_KEY"));

let client: Anthropic | null = null;
const cliente = () => {
  if (!iaDisponivel()) throw new Error("ANTHROPIC_API_KEY não configurada");
  client ??= new Anthropic({ maxRetries: 1 });
  return client;
};

function somarUso(total: UsoIa, r: Anthropic.Beta.BetaMessage) {
  const u = r.usage;
  total.entrada += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  total.saida += u.output_tokens || 0;
  total.cacheLeitura += u.cache_read_input_tokens || 0;
  total.buscasWeb += u.server_tool_use?.web_search_requests || 0;
}

const textoDe = (r: Anthropic.Beta.BetaMessage) =>
  r.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

// ---------------------------------------------------------------------------------------------
// Pesquisa de estabelecimentos
// ---------------------------------------------------------------------------------------------

const INSTRUCOES_PESQUISA = `Você é o pesquisador comercial do Easy Food Hub, um sistema brasileiro de cardápio digital e gestão de pedidos para restaurantes. Sua tarefa: encontrar pequenos e médios estabelecimentos de alimentação INDEPENDENTES na cidade pedida e registrar dados públicos sobre eles.

Como pesquisar:
- Use web_search com a consulta sugerida e variações próprias (nome da cidade, bairro, especialidade, "delivery", "instagram", "cardápio"). Resultados do Instagram, Facebook, Google Maps, sites e cardápios públicos servem.
- Use web_fetch para abrir o site, o link de cardápio ou a página pública do estabelecimento quando isso ajudar a confirmar como ele recebe pedidos. Não tente burlar login, paywall ou bloqueios: se uma página não abrir, siga com o que é público nos resultados.
- Ignore grandes redes e franquias (McDonald's, Burger King, Subway, Habib's, Domino's, Pizza Hut, Bob's, Giraffas, Spoleto, Madero, Outback, Cacau Show, Oakberry etc.) e qualquer negócio que diga ter várias unidades franqueadas.
- Ignore estabelecimentos que já aparecem na lista "JÁ CADASTRADOS".
- Pare quando tiver até 6 estabelecimentos com dados úteis, ou quando as buscas pararem de trazer novidades.

Regras de verdade (obrigatórias):
- Nunca invente telefone, @, site, endereço, número de seguidores, avaliações, faturamento ou volume de pedidos. Campo desconhecido fica null.
- Telefone: só o telefone comercial publicado pelo próprio negócio (bio, site, Google Maps, link wa.me). Nunca telefone pessoal de dono encontrado em outro contexto.
- sistema_observado = "anota_ai" SOMENTE se você viu um link do domínio anota.ai (ex.: na bio ou no site) ou uma menção explícita ao Anota AI pelo próprio estabelecimento. Ter cardápio digital NÃO prova que é Anota AI.
- "concorrente" quando o link de pedidos é de outra plataforma (Goomer, Cardápio Web, OlaClick, Menu Dino, Instadelivery, Delivery Direto, Neemo, Saipos etc.). Presença no iFood ou outro marketplace sozinha NÃO é sistema próprio de pedidos.
- "sem_sistema" quando os pedidos claramente são pelo WhatsApp, direct ou telefone e não há link de plataforma de pedidos. A ausência de link não prova nada: na dúvida, "indeterminado".
- links_pedido: todos os links de pedido, cardápio, WhatsApp (wa.me) e agregadores (linktr.ee etc.) que pertencem ao estabelecimento, exatamente como apareceram.
- evidencias: para cada conclusão, a URL onde você viu e o trecho literal curto (ex.: texto da bio, chamada "peça pelo WhatsApp", o link de cardápio).
- sinais.ativo_recente = true só se houver sinal de atividade nos últimos meses (post recente, avaliação recente, "aberto agora"). rede_ou_franquia = true se houver indício de rede.

Quando terminar, chame a ferramenta registrar_estabelecimentos UMA vez com a lista (pode ser vazia).`;

const NULLABLE_STR = { type: ["string", "null"] } as const;
const NULLABLE_BOOL = { type: ["boolean", "null"] } as const;
const NULLABLE_INT = { type: ["integer", "null"] } as const;

const FERRAMENTA_REGISTRO = {
  name: "registrar_estabelecimentos",
  description: "Registra os estabelecimentos encontrados na pesquisa, com dados públicos e evidências.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["estabelecimentos"],
    properties: {
      estabelecimentos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "nome", "categoria", "cidade", "uf", "bairro", "instagram", "facebook", "site", "telefone", "email",
            "link_cardapio", "links_pedido", "sistema_observado", "evidencias", "sinais", "fonte_principal",
          ],
          properties: {
            nome: { type: "string" },
            categoria: { type: "string", description: "hamburgueria, pizzaria, lanchonete, açaíteria, marmitaria..." },
            cidade: { type: "string" },
            uf: { type: "string" },
            bairro: NULLABLE_STR,
            instagram: { ...NULLABLE_STR, description: "@ ou URL do perfil" },
            facebook: NULLABLE_STR,
            site: NULLABLE_STR,
            telefone: { ...NULLABLE_STR, description: "telefone comercial publicado" },
            email: NULLABLE_STR,
            link_cardapio: NULLABLE_STR,
            links_pedido: { type: "array", items: { type: "string" } },
            sistema_observado: { type: "string", enum: ["anota_ai", "concorrente", "sistema_proprio", "sem_sistema", "indeterminado"] },
            evidencias: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["tipo", "url", "trecho"],
                properties: {
                  tipo: { type: "string", enum: ["link", "texto", "pagina", "maps"] },
                  url: { type: "string" },
                  trecho: { type: "string" },
                },
              },
            },
            sinais: {
              type: "object",
              additionalProperties: false,
              required: ["delivery", "retirada", "pedidos_whatsapp", "ativo_recente", "rede_ou_franquia", "aberto", "seguidores", "avaliacoes"],
              properties: {
                delivery: NULLABLE_BOOL,
                retirada: NULLABLE_BOOL,
                pedidos_whatsapp: NULLABLE_BOOL,
                ativo_recente: NULLABLE_BOOL,
                rede_ou_franquia: NULLABLE_BOOL,
                aberto: NULLABLE_BOOL,
                seguidores: NULLABLE_INT,
                avaliacoes: NULLABLE_INT,
              },
            },
            fonte_principal: { type: "string" },
          },
        },
      },
    },
  },
};

interface RegistroIa {
  nome: string;
  categoria: string;
  cidade: string;
  uf: string;
  bairro: string | null;
  instagram: string | null;
  facebook: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  link_cardapio: string | null;
  links_pedido: string[];
  sistema_observado: Sistema;
  evidencias: { tipo: "link" | "texto" | "pagina" | "maps"; url: string; trecho: string }[];
  sinais: {
    delivery: boolean | null;
    retirada: boolean | null;
    pedidos_whatsapp: boolean | null;
    ativo_recente: boolean | null;
    rede_ou_franquia: boolean | null;
    aberto: boolean | null;
    seguidores: number | null;
    avaliacoes: number | null;
  };
  fonte_principal: string;
}

export interface CandidatoMaps {
  nome: string;
  telefone: string | null;
  site: string | null;
  endereco: string | null;
  avaliacoes: number | null;
}

export async function pesquisarEstabelecimentos(
  busca: BuscaPlanejada,
  jaCadastrados: string[],
  candidatosMaps: CandidatoMaps[] = [],
): Promise<{ estabelecimentos: EstabelecimentoBruto[]; uso: UsoIa }> {
  const uso = usoVazio();
  const api = cliente();

  const partes = [
    `CONSULTA SUGERIDA: ${busca.consulta}`,
    `CIDADE: ${busca.cidade} - ${busca.uf}`,
    `ESPECIALIDADE: ${busca.especialidade}`,
    busca.publico === "B"
      ? "FOCO: estabelecimentos que recebem pedidos pelo Anota AI (link anota.ai). Confirme pelo link ou menção explícita."
      : "FOCO: estabelecimentos que recebem pedidos pelo WhatsApp, direct ou telefone, sem plataforma própria de pedidos.",
  ];
  if (candidatosMaps.length) {
    partes.push(
      "",
      "CANDIDATOS DO GOOGLE MAPS (dados oficiais da API; complete com Instagram, links de pedido e evidências):",
      ...candidatosMaps.map((c) => `- ${c.nome} | tel: ${c.telefone ?? "?"} | site: ${c.site ?? "?"} | ${c.endereco ?? ""} | avaliações: ${c.avaliacoes ?? "?"}`),
    );
  }
  partes.push("", `JÁ CADASTRADOS NESTA CIDADE (ignorar): ${jaCadastrados.slice(0, 60).join("; ") || "nenhum"}`);

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: partes.join("\n") }];
  const tools = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 5,
      user_location: { type: "approximate", city: busca.cidade, country: "BR", timezone: "America/Sao_Paulo" },
    },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, max_content_tokens: 8000 },
    FERRAMENTA_REGISTRO,
  ];

  // Ferramentas de servidor podem pausar o turno (pause_turn): retomamos até 3 vezes.
  for (let i = 0; i < 4; i++) {
    const params = {
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [{ type: "text", text: INSTRUCOES_PESQUISA, cache_control: { type: "ephemeral" } }],
      tools,
      tool_choice: { type: "auto" },
      messages,
    };
    const r = await api.beta.messages.create(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, { timeout: 140_000 });
    somarUso(uso, r);

    const registro = r.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "registrar_estabelecimentos",
    );
    if (registro) {
      const lista = ((registro.input as { estabelecimentos?: RegistroIa[] })?.estabelecimentos ?? []).slice(0, 10);
      return {
        uso,
        estabelecimentos: lista
          .filter((e) => e?.nome?.trim())
          .map((e) => ({
            nome: e.nome,
            categoria: e.categoria || busca.especialidade,
            cidade: e.cidade || busca.cidade,
            uf: e.uf || busca.uf,
            bairro: e.bairro,
            instagram: e.instagram,
            facebook: e.facebook,
            site: e.site,
            telefone: e.telefone,
            email: e.email,
            link_cardapio: e.link_cardapio,
            links: e.links_pedido || [],
            sistema_observado: e.sistema_observado,
            evidencias: (e.evidencias || []).filter((ev) => ev?.url || ev?.trecho).slice(0, 8),
            sinais: e.sinais,
            fonte: e.fonte_principal || null,
          })),
      };
    }
    if (r.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: r.content });
      continue;
    }
    if (r.stop_reason === "refusal") throw new Error("A IA recusou a pesquisa");
    return { estabelecimentos: [], uso };
  }
  return { estabelecimentos: [], uso };
}

// ---------------------------------------------------------------------------------------------
// Primeira mensagem
// ---------------------------------------------------------------------------------------------

const REGRAS_MENSAGEM = `Regras obrigatórias para TODAS as mensagens:
- Português brasileiro natural, como uma pessoa escreveria no WhatsApp. Curta: 2 a 4 frases, no máximo 450 caracteres.
- Nunca use travessão (— ou –) nem hífen como pausa. Use vírgula ou ponto.
- Deixe claro que é um contato comercial do Easy Food Hub (diga o nome Easy Food Hub).
- Não finja ser cliente, não diga que fez pedido, provou ou testou o cardápio.
- Não use elogios artificiais ("cardápio incrível", "fotos maravilhosas").
- Não afirme problemas internos que ninguém relatou. Pode fazer uma pergunta sobre como eles trabalham.
- Não ataque concorrentes e não prometa aumento de vendas nem resultados.
- Não invente preço, desconto, teste grátis ou condição. Na primeira mensagem, prefira não falar de preço.
- Personalize com dados públicos reais do estabelecimento (tipo de negócio, cidade, canal de pedidos observado).
- Termine com uma pergunta simples e fácil de responder.
- Varie a abertura: não comece igual às aberturas recentes listadas.

Público sem sistema: desperte interesse em organizar pedidos e ter um link de cardápio próprio, perguntando como eles recebem pedidos hoje.
Usuário do Anota AI (confirmado): convide a conhecer e comparar uma alternativa que pode sair mais em conta dependendo do plano, sem agressividade.
Anota AI com confiança média: pergunte se usam o Anota AI, sem afirmar.
Sistema indeterminado: não cite nenhuma plataforma; pergunte como recebem pedidos.`;

export interface ProspectParaMensagem {
  id: string;
  nome: string;
  categoria: string | null;
  cidade: string | null;
  bairro: string | null;
  sistema: Sistema;
  sistema_confianca: string;
  canal: "whatsapp" | "instagram";
  sinais: Record<string, unknown>;
  evidencias: { url: string; trecho: string }[];
}

export async function redigirMensagens(
  prospects: ProspectParaMensagem[],
  cfg: ConfigProspeccao,
  aberturasRecentes: string[],
): Promise<{ mensagens: Map<string, string>; uso: UsoIa }> {
  const uso = usoVazio();
  const mensagens = new Map<string, string>();
  if (!prospects.length) return { mensagens, uso };

  const dados = prospects.map((p) => ({
    id: p.id,
    nome: p.nome,
    tipo: p.categoria,
    cidade: p.cidade,
    bairro: p.bairro,
    sistema: p.sistema,
    confianca_sistema: p.sistema_confianca,
    canal_da_mensagem: p.canal,
    delivery: p.sinais.delivery ?? null,
    retirada: p.sinais.retirada ?? null,
    pedidos_whatsapp: p.sinais.pedidos_whatsapp ?? null,
    evidencias: p.evidencias.slice(0, 3).map((e) => e.trecho.slice(0, 160)),
  }));

  const r = await cliente().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["mensagens"],
          properties: {
            mensagens: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "texto"],
                properties: { id: { type: "string" }, texto: { type: "string" } },
              },
            },
          },
        },
      },
    },
    system: [
      { type: "text", text: `Você escreve a primeira mensagem comercial do Easy Food Hub para estabelecimentos de alimentação.\n\n${REGRAS_MENSAGEM}\n\nFATOS DO PRODUTO:\n${fatosDoProduto(cfg)}` },
    ],
    messages: [
      {
        role: "user",
        content: `Aberturas recentes (não repetir): ${aberturasRecentes.slice(0, 20).join(" | ") || "nenhuma"}\n\nEscreva uma mensagem para cada estabelecimento:\n${JSON.stringify(dados)}`,
      },
    ],
  } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, { timeout: 90_000 });
  somarUso(uso, r);
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return { mensagens, uso };

  const parsed = JSON.parse(textoDe(r) || "{}") as { mensagens?: { id: string; texto: string }[] };
  for (const m of parsed.mensagens ?? []) if (m?.id && m.texto) mensagens.set(m.id, m.texto);
  return { mensagens, uso };
}

// ---------------------------------------------------------------------------------------------
// Atendimento das respostas
// ---------------------------------------------------------------------------------------------

export interface DecisaoResposta {
  intencao: Intencao;
  resposta: string;
  precisa_humano: boolean;
  interesse: Interesse;
  resumo: string;
  valor_concorrente_mensal: number | null;
}

export interface MensagemHistorico {
  direcao: "saida" | "entrada";
  texto: string;
}

export async function decidirResposta(
  prospect: { nome: string; categoria: string | null; cidade: string | null; sistema: Sistema; sistema_confianca: string },
  historico: MensagemHistorico[],
  cfg: ConfigProspeccao,
  comparacao: ComparacaoPreco | null,
): Promise<{ decisao: DecisaoResposta | null; uso: UsoIa }> {
  const uso = usoVazio();
  const conversa = historico
    .slice(-20)
    .map((m) => `${m.direcao === "saida" ? "NÓS" : "ESTABELECIMENTO"}: ${m.texto.slice(0, 800)}`)
    .join("\n");

  const comp = comparacao
    ? comparacao.maisBarato
      ? `COMPARAÇÃO CALCULADA (use exatamente estes números): o estabelecimento informou pagar R$ ${comparacao.valorConcorrente} por mês. Nosso preço é R$ ${comparacao.nossoPreco}. Diferença: R$ ${comparacao.diferencaMensal} por mês, R$ ${comparacao.diferencaAnual} por ano. Lembre que a comparação vale se os recursos que eles usam existirem no Easy Food Hub.`
      : `COMPARAÇÃO CALCULADA: o estabelecimento informou pagar R$ ${comparacao.valorConcorrente} por mês, que é igual ou menor que nosso preço (R$ ${comparacao.nossoPreco}). Não diga que sai mais barato; destaque apenas recursos confirmados, se fizer sentido.`
    : "Sem valor do concorrente informado: não calcule economia. Se perguntarem, diga nosso preço e convide a comparar.";

  const system = `Você atende, pelo WhatsApp comercial do Easy Food Hub, donos de estabelecimentos de alimentação que responderam à nossa abordagem.

Classifique a ÚLTIMA mensagem do estabelecimento em uma intenção:
interesse | pergunta_preco | pergunta_funcionalidade | quer_demonstracao | pediu_link | objecao_preco | usa_outro_sistema | sem_interesse | nao_contatar | ambigua | precisa_humano

Depois escreva a resposta (campo resposta), seguindo:
- Explique só os benefícios mais relevantes para a pergunta. Respostas curtas (até ~600 caracteres).
- Preço: informe exatamente o que está nos fatos do produto.
- Quer conhecer ou pediu link: envie o link do site e pergunte se quer conversar com a equipe para ativar. Nunca envie link de cadastro ou login.
- Quer contratar, testar, ativar a conta ou saber como começa: precisa_humano = true e diga que alguém da equipe continua o atendimento por aqui para ativar a conta.
- Usa Anota AI ou outro sistema: ajude a comparar recursos e custos sem prometer migração automática.
- Dúvida técnica ou comercial que os fatos não respondem, negociação, pedido de desconto, demonstração ao vivo, irritação ou assunto sensível: precisa_humano = true e uma resposta curta dizendo que alguém da equipe vai retornar.
- sem_interesse ou nao_contatar: resposta vazia (o sistema envia o encerramento padrão).
- Ambígua: uma pergunta curta para entender.
- valor_concorrente_mensal: o valor mensal que o estabelecimento disse pagar hoje por outro sistema, ou null.
- resumo: uma frase com a situação da conversa para o operador.

${REGRAS_MENSAGEM}

FATOS DO PRODUTO:
${fatosDoProduto(cfg)}`;

  const r = await cliente().beta.messages.create({
    model: MODEL,
    max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["intencao", "resposta", "precisa_humano", "interesse", "resumo", "valor_concorrente_mensal"],
          properties: {
            intencao: { type: "string", enum: [...INTENCOES] },
            resposta: { type: "string" },
            precisa_humano: { type: "boolean" },
            interesse: { type: "string", enum: ["nenhum", "baixo", "medio", "alto"] },
            resumo: { type: "string" },
            valor_concorrente_mensal: { type: ["number", "null"] },
          },
        },
      },
    },
    system: [{ type: "text", text: system }],
    messages: [
      {
        role: "user",
        content: `ESTABELECIMENTO: ${prospect.nome} (${prospect.categoria ?? "alimentação"}, ${prospect.cidade ?? "cidade não informada"}). Sistema identificado: ${prospect.sistema} (confiança ${prospect.sistema_confianca}).\n${comp}\n\nCONVERSA:\n${conversa}`,
      },
    ],
  } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, { timeout: 60_000 });
  somarUso(uso, r);
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return { decisao: null, uso };
  const d = JSON.parse(textoDe(r) || "null") as DecisaoResposta | null;
  if (!d || !INTENCOES.includes(d.intencao)) return { decisao: null, uso };
  return { decisao: d, uso };
}
