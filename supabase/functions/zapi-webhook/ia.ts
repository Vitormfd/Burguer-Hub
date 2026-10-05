// Atendente com IA: transforma um pedido escrito em texto livre
// ("2 x-bacon sem cebola e uma coca lata") em itens do cardápio da loja.
//
// Requer o segredo ANTHROPIC_API_KEY na Edge Function. Modelo configurável por
// WHATSAPP_IA_MODEL. Qualquer falha devolve null e o robô segue o fluxo normal.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { produtoPreco } from "./db.ts";

const MODEL = Deno.env.get("WHATSAPP_IA_MODEL") || "claude-opus-5-5";
const TIMEOUT_MS = 20000;

export interface ProdutoIa {
  ref: string;
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  categoria_id: string;
  categoria_nome: string;
}

export interface AdicionalIa {
  ref: string;
  id: string;
  nome: string;
  preco: number;
  grupo_nome: string;
}

export interface CardapioIa {
  produtos: ProdutoIa[];
  adicionais: AdicionalIa[];
  texto: string;
}

export interface ItemInterpretado {
  produto: ProdutoIa;
  quantidade: number;
  observacao?: string;
  adicional_ids: string[];
}

export interface PedidoInterpretado {
  itens: ItemInterpretado[];
  nao_encontrados: string[];
}

export function iaDisponivel(): boolean {
  return Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
}

/** Heurística barata antes de chamar a IA: só textos com letras e de tamanho razoável. */
export function pareceTextoLivre(texto: string): boolean {
  const t = texto.trim();
  if (t.length < 4 || t.length > 600) return false;
  if (/^\d+([,\s]+\d+)*$/.test(t)) return false;
  return /[a-zà-ú]{3,}/i.test(t);
}

export async function loadCardapioIa(supabase: SupabaseClient, ownerId: string): Promise<CardapioIa> {
  const [{ data: categorias }, { data: produtos }, { data: grupos }] = await Promise.all([
    supabase.from("categorias").select("id, nome, ordem").eq("owner_id", ownerId).eq("ativo", true).order("ordem"),
    supabase
      .from("produtos")
      .select("id, nome, descricao, preco, preco_promocional, promocao, categoria_id, ordem")
      .eq("owner_id", ownerId)
      .eq("disponivel", true)
      .order("ordem"),
    supabase.from("grupos_adicionais").select("id, nome").eq("owner_id", ownerId).eq("disponivel", true),
  ]);

  const catNome = new Map((categorias || []).map((c) => [c.id as string, c.nome as string]));
  const grupoNome = new Map((grupos || []).map((g) => [g.id as string, g.nome as string]));
  const grupoIds = [...grupoNome.keys()];
  const { data: adicionais } = grupoIds.length
    ? await supabase
      .from("adicionais")
      .select("id, nome, preco, grupo_id, ordem")
      .in("grupo_id", grupoIds)
      .eq("disponivel", true)
      .order("ordem")
    : { data: [] };

  const prods: ProdutoIa[] = (produtos || [])
    .filter((p) => catNome.has(p.categoria_id))
    .map((p, i) => ({
      ref: `P${i + 1}`,
      id: p.id,
      nome: p.nome,
      descricao: (p.descricao || "").replace(/\s+/g, " ").slice(0, 140),
      preco: produtoPreco(p),
      categoria_id: p.categoria_id,
      categoria_nome: catNome.get(p.categoria_id) || "",
    }));

  const ads: AdicionalIa[] = (adicionais || []).map((a, i) => ({
    ref: `A${i + 1}`,
    id: a.id,
    nome: a.nome,
    preco: Number(a.preco),
    grupo_nome: grupoNome.get(a.grupo_id) || "",
  }));

  const linhas: string[] = ["PRODUTOS (ref | categoria | nome | preço | descrição):"];
  for (const p of prods) {
    linhas.push(`${p.ref} | ${p.categoria_nome} | ${p.nome} | R$ ${p.preco.toFixed(2)}${p.descricao ? ` | ${p.descricao}` : ""}`);
  }
  linhas.push("", "ADICIONAIS / OPÇÕES (ref | grupo | nome | preço):");
  for (const a of ads) {
    linhas.push(`${a.ref} | ${a.grupo_nome} | ${a.nome} | R$ ${a.preco.toFixed(2)}`);
  }

  return { produtos: prods, adicionais: ads, texto: linhas.join("\n") };
}

const INSTRUCOES = `Você interpreta mensagens de clientes de um restaurante no WhatsApp e converte pedidos em itens do cardápio abaixo.

Regras:
- eh_pedido = true somente se a mensagem pede um ou mais itens para comprar. Saudações, perguntas (horário, endereço, preço, "tem X?"), reclamações ou conversas → eh_pedido = false e itens vazio.
- Use apenas refs que existem no cardápio. Associe nomes aproximados, apelidos, abreviações e erros de digitação ao item mais provável ("xbacon", "x bacon", "coca lata" → o item correspondente). Se houver dúvida real entre itens diferentes, não escolha: coloque o trecho em nao_encontrados.
- quantidade: inteiro de 1 a 20; padrão 1. "dois", "2x", "um par" etc. viram número.
- adicionais: refs de ADICIONAIS que o cliente pediu explicitamente para aquele item ("com bacon extra", "ponto da carne mal passado", "sabor laranja"). Não invente.
- observacao: pedidos de remoção ou preparo que não são adicionais ("sem cebola", "bem passado" quando não houver opção), em poucas palavras. Vazio se não houver.
- nao_encontrados: trechos que parecem itens pedidos mas não existem no cardápio.
- Ignore endereço, forma de pagamento e nome do cliente: o robô pergunta isso depois.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["eh_pedido", "itens", "nao_encontrados"],
  properties: {
    eh_pedido: { type: "boolean" },
    itens: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["produto_ref", "quantidade", "adicionais_refs", "observacao"],
        properties: {
          produto_ref: { type: "string" },
          quantidade: { type: "integer" },
          adicionais_refs: { type: "array", items: { type: "string" } },
          observacao: { type: "string" },
        },
      },
    },
    nao_encontrados: { type: "array", items: { type: "string" } },
  },
} as const;

interface RespostaIa {
  eh_pedido: boolean;
  itens: { produto_ref: string; quantidade: number; adicionais_refs: string[]; observacao: string }[];
  nao_encontrados: string[];
}

let client: Anthropic | null = null;

/** Retorna null quando não é pedido, quando nada foi reconhecido ou se a IA falhar. */
export async function interpretarPedido(cardapio: CardapioIa, mensagem: string): Promise<PedidoInterpretado | null> {
  if (!iaDisponivel() || !cardapio.produtos.length) return null;
  client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });

  try {
    const params = {
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system: [
        { type: "text", text: INSTRUCOES },
        // Cardápio da loja muda pouco: fica em cache entre mensagens.
        { type: "text", text: `CARDÁPIO\n${cardapio.texto}`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: `Mensagem do cliente:\n"""${mensagem.slice(0, 600)}"""` }],
    };
    const response = await client.beta.messages.create(
      params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
    );

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    const texto = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (!texto) return null;

    const parsed = JSON.parse(texto) as RespostaIa;
    if (!parsed.eh_pedido || !Array.isArray(parsed.itens)) return null;

    const porRefP = new Map(cardapio.produtos.map((p) => [p.ref, p]));
    const porRefA = new Map(cardapio.adicionais.map((a) => [a.ref, a]));
    const itens: ItemInterpretado[] = [];
    for (const it of parsed.itens) {
      const produto = porRefP.get(String(it.produto_ref).trim());
      if (!produto) continue;
      const quantidade = Math.min(Math.max(Math.round(Number(it.quantidade) || 1), 1), 20);
      const adicional_ids = (it.adicionais_refs || [])
        .map((r) => porRefA.get(String(r).trim())?.id)
        .filter((id): id is string => Boolean(id));
      const observacao = (it.observacao || "").trim().slice(0, 140) || undefined;
      itens.push({ produto, quantidade, observacao, adicional_ids });
    }

    if (!itens.length) return null;
    return { itens, nao_encontrados: (parsed.nao_encontrados || []).map(String).slice(0, 5) };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`IA WhatsApp: API ${err.status}: ${err.message}`);
    } else {
      console.error("IA WhatsApp:", err instanceof Error ? err.message : String(err));
    }
    return null;
  }
}
