import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createWhatsappOrder,
  isLojaAberta,
  loadBairros,
  carrinhoBloqueiaFreteGratis,
  loadCategorias,
  loadClienteByPhone,
  loadGruposProduto,
  loadProdutos,
  produtoPreco,
  isHamburger,
  upsertSession,
} from "./db.ts";
import {
  AJUDA_TEXTO,
  brl,
  cartSubtotal,
  encodeKdsObservation,
  formatPhoneZapi,
  formatBoasVindas,
  formatCardapioLinkMsg,
  formatCart,
  formatOptionListAsText,
  formatPagamento,
  calcularTaxaEntregaWhatsapp,
  formatResumoConfirmacao,
  normalizeText,
} from "./format.ts";
import type {
  CartAdicionalWa,
  CartItemWa,
  Etapa,
  GrupoAdicionalWa,
  LojaConfig,
  OutboundMessage,
  ProdutoTempWa,
  SessionDados,
  WhatsappSession,
} from "./format.ts";
import { iaDisponivel, interpretarPedido, loadCardapioIa, pareceTextoLivre } from "./ia.ts";
import type { PedidoInterpretado } from "./ia.ts";

const PRODUTOS_POR_PAGINA = 8;

interface FlowResult {
  messages: OutboundMessage[];
  etapa: Etapa;
  dados: SessionDados;
  clearSession?: boolean;
  /** Não envia resposta — deixa a conversa livre para atendimento humano */
  noReply?: boolean;
  /** Resposta não reconhecida (conta para MAX_TENTATIVAS_INVALIDAS) */
  invalid?: boolean;
}

const BOT_START_COMMANDS = ["menu", "cardapio", "cardápio", "pedido", "inicio"];

const MENU_PRINCIPAL = "*1* — Fazer pedido\n*2* — Ver cardápio online\n*3* — Falar com um atendente";
/** Boas-vindas no máximo uma vez nesse intervalo por cliente. */
const BOAS_VINDAS_INTERVALO_MS = 12 * 60 * 60 * 1000;
/** Depois de N respostas inválidas seguidas o bot sai e deixa a conversa para o atendente. */
const MAX_TENTATIVAS_INVALIDAS = 3;

const FORMAS_PAGAMENTO = [
  { id: "pix", title: "PIX", description: "" },
  { id: "cartao", title: "Cartão", description: "Débito ou crédito" },
  { id: "dinheiro", title: "Dinheiro", description: "" },
];

function showMenuPrincipal(dados: SessionDados, intro?: string): FlowResult {
  return {
    messages: [textMsg(intro ? `${intro}\n\n${MENU_PRINCIPAL}` : MENU_PRINCIPAL)],
    etapa: "menu_principal",
    dados: { ...dados, bot_ativo: false },
  };
}

function invalidInput(etapa: Etapa, dados: SessionDados, hint: string): FlowResult {
  const invalidas = (dados.invalidas || 0) + 1;
  if (invalidas >= MAX_TENTATIVAS_INVALIDAS) return silentExit(dados);
  return { messages: [textMsg(hint)], etapa, dados: { ...dados, invalidas }, invalid: true };
}

function pagamentoMsg(): OutboundMessage {
  return listMsg("💳 Forma de pagamento:", "Pagamento", "Escolher", FORMAS_PAGAMENTO);
}

function observacaoMsg(nome: string): OutboundMessage {
  return textMsg(`Alguma observação para *${nome}*? (ex: sem cebola)\n\nDigite a observação ou *0* para seguir sem observação.`);
}

/** Escolha por id (lista do WhatsApp) ou pelo número digitado. */
function pickOption<T extends { id: string }>(options: T[], selected: string): T | undefined {
  return options.find((o) => o.id === selected) || options[parseInt(selected, 10) - 1];
}

function isBotFlowActive(etapa: Etapa, dados: SessionDados): boolean {
  if (dados.bot_ativo) return true;
  if (dados.carrinho.length > 0) return true;
  if (dados.produto_temp) return true;
  const midFlow: Etapa[] = [
    "menu_principal", "menu_categoria", "menu_produto",
    "produto_quantidade", "produto_adicional", "produto_observacao",
    "carrinho", "tipo_entrega", "cliente_nome", "endereco_salvo", "cliente_endereco",
    "cliente_numero", "cliente_complemento", "cliente_bairro",
    "forma_pagamento", "troco", "confirmacao",
  ];
  return midFlow.includes(etapa);
}

/** Sai do bot sem mensagem — conversa volta ao atendimento normal */
function silentExit(dados: SessionDados): FlowResult {
  return {
    messages: [],
    etapa: "inicio",
    dados: emptyDados(dados.sender_name),
    clearSession: true,
    noReply: true,
  };
}

function emptyDados(senderName?: string): SessionDados {
  return { carrinho: [], sender_name: senderName };
}

function parseNumbers(input: string): number[] {
  return input
    .split(/[,;\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

function textMsg(text: string): OutboundMessage {
  return { text };
}

function listMsg(
  text: string,
  title: string,
  buttonLabel: string,
  options: { id: string; title: string; description: string }[],
  footer?: string,
): OutboundMessage {
  const msg: OutboundMessage = { text, footer, optionList: { title, buttonLabel, options } };
  if (options.length <= 10) return msg;
  return { text: formatOptionListAsText(msg) };
}

async function showCategorias(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  dados: SessionDados,
): Promise<FlowResult> {
  const categorias = await loadCategorias(supabase, cfg.owner_id);
  if (!categorias.length) {
    return {
      messages: [textMsg("😔 Nenhum item disponível no cardápio no momento.")],
      etapa: "inicio",
      dados,
    };
  }

  const options = categorias.map((c) => ({
    id: c.id,
    title: `${c.emoji ? c.emoji + " " : ""}${c.nome}`.trim(),
    description: "",
  }));

  return {
    messages: [
      listMsg(
        "🍔 *Cardápio* — Escolha uma categoria:",
        "Categorias",
        "Ver categorias",
        options,
        "*0* — Voltar ao início",
      ),
    ],
    etapa: "menu_categoria",
    dados: { ...dados, bot_ativo: true },
  };
}

async function showProdutos(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  dados: SessionDados,
  categoriaId: string,
  categoriaNome: string,
  pagina = 0,
): Promise<FlowResult> {
  const produtos = await loadProdutos(supabase, cfg.owner_id, categoriaId);
  if (!produtos.length) {
    return {
      messages: [textMsg("Nenhum produto disponível nesta categoria. Escolha outra categoria ou digite *0* para voltar.")],
      etapa: "menu_categoria",
      dados,
    };
  }

  const slice = produtos.slice(pagina * PRODUTOS_POR_PAGINA, (pagina + 1) * PRODUTOS_POR_PAGINA);
  const options = slice.map((p) => ({
    id: p.id,
    title: p.nome,
    description: brl(produtoPreco(p)),
  }));

  const hasMore = produtos.length > (pagina + 1) * PRODUTOS_POR_PAGINA;
  const footer = hasMore
    ? "*9* — Ver mais produtos\n*0* — Voltar às categorias"
    : "*0* — Voltar às categorias";

  return {
    messages: [
      listMsg(
        `📋 *${categoriaNome}* — Escolha um produto:`,
        categoriaNome,
        "Ver produtos",
        options,
        footer,
      ),
    ],
    etapa: "menu_produto",
    dados: { ...dados, categoria_id: categoriaId, categoria_nome: categoriaNome, pagina_produtos: pagina },
  };
}

async function startProdutoConfig(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  dados: SessionDados,
  produtoId: string,
): Promise<FlowResult> {
  const produtos = await loadProdutos(supabase, cfg.owner_id, dados.categoria_id!);
  const produto = produtos.find((p) => p.id === produtoId);
  if (!produto) {
    return {
      messages: [textMsg("Produto não encontrado. Escolha outro ou digite *0* para voltar.")],
      etapa: "menu_produto",
      dados,
    };
  }

  const preco = produtoPreco(produto);
  const catNome = dados.categoria_nome || "";
  const fallback = isHamburger(catNome, produto.nome);
  const grupos = await loadGruposProduto(supabase, produtoId, fallback);

  dados.produto_temp = {
    produto_id: produto.id,
    nome: produto.nome,
    preco,
    quantidade: 1,
    adicionais: [],
    grupo_index: 0,
    grupos,
    categoria_id: dados.categoria_id!,
    categoria_nome: catNome,
    fallback_all_groups: fallback,
  };

  return {
    messages: [
      textMsg(
        `✅ *${produto.nome}* — ${brl(preco)}\n\nQuantas unidades? Digite de *1* a *9*.\n*0* — Voltar aos produtos`,
      ),
    ],
    etapa: "produto_quantidade",
    dados,
  };
}

function showAdicionalGrupo(dados: SessionDados): FlowResult {
  const temp = dados.produto_temp!;
  const grupo = temp.grupos[temp.grupo_index];

  if (!grupo) {
    if (temp.ia) return addToCart(dados, temp.observacao_ia);
    return {
      messages: [observacaoMsg(temp.nome)],
      etapa: "produto_observacao",
      dados,
    };
  }

  const obrig = grupo.obrigatorio || grupo.min_escolhas > 0;
  const max = grupo.max_escolhas;
  const lines = [
    `🧀 *${grupo.nome}*`,
    obrig ? `_Escolha ${grupo.min_escolhas || 1} a ${max} opção(ões):_` : `_Opcional — escolha até ${max}:_`,
    "",
  ];

  grupo.adicionais.forEach((a, i) => {
    const preco = a.preco > 0 ? ` (+${brl(a.preco)})` : "";
    lines.push(`*${i + 1}* — ${a.nome}${preco}`);
  });

  if (!obrig) lines.push("*0* — Não quero");
  lines.push(max > 1
    ? "\n_Digite o número (para escolher vários, separe por vírgula: 1,3)._"
    : "\n_Digite o número da opção._");

  return {
    messages: [textMsg(lines.join("\n"))],
    etapa: "produto_adicional",
    dados,
  };
}

function addToCart(dados: SessionDados, observacao?: string): FlowResult {
  const temp = dados.produto_temp!;
  const item: CartItemWa = {
    id: crypto.randomUUID(),
    produto_id: temp.produto_id,
    produto_nome: temp.nome,
    quantidade: temp.quantidade,
    preco_unitario: temp.preco,
    observacao: observacao || undefined,
    adicionais: temp.adicionais,
  };

  const carrinho = [...dados.carrinho, item];
  delete dados.produto_temp;

  const proximo = dados.ia_pendentes?.shift();
  if (!dados.ia_pendentes?.length) delete dados.ia_pendentes;
  if (proximo) {
    const next = showAdicionalGrupo({ ...dados, carrinho, produto_temp: proximo });
    return {
      ...next,
      messages: [textMsg(`✅ *${temp.nome}* adicionado! Agora o próximo item:`), ...next.messages],
    };
  }

  return {
    messages: [
      textMsg(`✅ *${temp.nome}* adicionado ao carrinho!\n\n${formatCart(carrinho)}\n\n*1* — Adicionar mais itens\n*2* — Finalizar pedido\n*3* — Limpar carrinho`),
    ],
    etapa: "carrinho",
    dados: { ...dados, carrinho },
  };
}

/** Lê o liga/desliga da IA à parte: se a coluna não existir, a IA fica desligada. */
async function iaAtivaNaLoja(supabase: SupabaseClient, cfg: LojaConfig): Promise<boolean> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("whatsapp_ia_ativa")
    .eq("id", cfg.id)
    .maybeSingle();
  return !error && data?.whatsapp_ia_ativa === true;
}

/**
 * Tenta entender um pedido em texto livre. Retorna null quando a IA está desligada,
 * a mensagem não é um pedido ou nada foi reconhecido — o fluxo normal segue.
 */
async function tentarPedidoIa(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  dados: SessionDados,
  rawText: string,
  saudacao?: string,
): Promise<FlowResult | null> {
  if (!iaDisponivel() || !pareceTextoLivre(rawText)) return null;
  if (!(await iaAtivaNaLoja(supabase, cfg))) return null;

  const cardapio = await loadCardapioIa(supabase, cfg.owner_id);
  const pedido = await interpretarPedido(cardapio, rawText);
  if (!pedido) return null;
  return aplicarPedidoIa(supabase, dados, pedido, saudacao);
}

/** Separa as escolhas da IA válidas por grupo e os grupos obrigatórios que ficaram sem escolha. */
function adicionaisEscolhidos(grupos: GrupoAdicionalWa[], ids: string[]) {
  const escolhidos: CartAdicionalWa[] = [];
  const pendentes: GrupoAdicionalWa[] = [];
  for (const g of grupos) {
    const sel = g.adicionais.filter((a) => ids.includes(a.id)).slice(0, Math.max(g.max_escolhas, 1));
    const minimo = g.obrigatorio || g.min_escolhas > 0 ? Math.max(g.min_escolhas, 1) : 0;
    if (sel.length < minimo) {
      pendentes.push(g);
      continue;
    }
    for (const a of sel) {
      escolhidos.push({ adicional_id: a.id, nome: a.nome, quantidade: 1, preco_unitario: a.preco });
    }
  }
  return { escolhidos, pendentes };
}

async function aplicarPedidoIa(
  supabase: SupabaseClient,
  dados: SessionDados,
  pedido: PedidoInterpretado,
  saudacao?: string,
): Promise<FlowResult> {
  const carrinho = [...dados.carrinho];
  const pendentes: ProdutoTempWa[] = [];
  const adicionadosTxt: string[] = [];

  for (const it of pedido.itens) {
    const fallback = isHamburger(it.produto.categoria_nome, it.produto.nome);
    const grupos = await loadGruposProduto(supabase, it.produto.id, fallback);
    const { escolhidos, pendentes: gruposPendentes } = adicionaisEscolhidos(grupos, it.adicional_ids);

    if (!gruposPendentes.length) {
      carrinho.push({
        id: crypto.randomUUID(),
        produto_id: it.produto.id,
        produto_nome: it.produto.nome,
        quantidade: it.quantidade,
        preco_unitario: it.produto.preco,
        observacao: it.observacao,
        adicionais: escolhidos,
      });
      adicionadosTxt.push(`${it.quantidade}x ${it.produto.nome}`);
      continue;
    }

    pendentes.push({
      produto_id: it.produto.id,
      nome: it.produto.nome,
      preco: it.produto.preco,
      quantidade: it.quantidade,
      adicionais: escolhidos,
      grupo_index: 0,
      grupos: gruposPendentes,
      categoria_id: it.produto.categoria_id,
      categoria_nome: it.produto.categoria_nome,
      fallback_all_groups: fallback,
      ia: true,
      observacao_ia: it.observacao,
    });
  }

  const intro: string[] = [];
  if (saudacao) intro.push(saudacao);
  intro.push("🤖 Entendi seu pedido!");
  if (pedido.nao_encontrados.length) {
    intro.push(`⚠️ Não encontrei no cardápio: ${pedido.nao_encontrados.join(", ")}.`);
  }

  const base: SessionDados = { ...dados, carrinho, bot_ativo: true };
  delete base.produto_temp;
  delete base.ia_pendentes;
  delete base.invalidas;

  if (pendentes.length) {
    const [primeiro, ...resto] = pendentes;
    if (resto.length) base.ia_pendentes = resto;
    if (adicionadosTxt.length) intro.push(`Já coloquei no carrinho: ${adicionadosTxt.join(", ")}.`);
    intro.push(`Falta escolher algumas opções de *${primeiro.quantidade}x ${primeiro.nome}*:`);
    const next = showAdicionalGrupo({ ...base, produto_temp: primeiro });
    return { ...next, messages: [textMsg(intro.join("\n")), ...next.messages] };
  }

  return showCarrinho(base, intro.join("\n"));
}

export async function processMessage(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  session: WhatsappSession | null,
  telefone: string,
  rawText: string,
  selectedId: string | null,
  senderName?: string,
): Promise<FlowResult> {
  const text = normalizeText(rawText);
  const selected = selectedId || text;

  let etapa: Etapa = session?.etapa || "inicio";
  let dados: SessionDados = session?.dados || emptyDados(senderName);
  if (senderName && !dados.sender_name) dados.sender_name = senderName;

  // Comandos globais
  if (["ajuda", "help", "comandos"].includes(text)) {
    return { messages: [textMsg(AJUDA_TEXTO)], etapa, dados };
  }

  if (["cancelar", "sair", "desistir"].includes(text) && isBotFlowActive(etapa, dados)) {
    return showMenuPrincipal(
      { ...emptyDados(senderName), boas_vindas_em: dados.boas_vindas_em },
      "Pedido cancelado. 👋 Posso ajudar em algo mais?",
    );
  }

  if (BOT_START_COMMANDS.includes(text)) {
    const cat = await showCategorias(supabase, cfg, { ...dados, bot_ativo: true });
    return cat;
  }

  if (["link", "site", "cardapio online", "cardápio online", "web"].includes(text)) {
    return {
      messages: [textMsg(formatCardapioLinkMsg(cfg))],
      etapa,
      dados,
    };
  }

  if (["carrinho", "ver carrinho"].includes(text)) {
    if (!dados.carrinho.length) {
      return {
        messages: [textMsg("Você não tem pedido em andamento.")],
        etapa: "inicio",
        dados,
      };
    }
    return showCarrinho(dados);
  }

  if (!isBotFlowActive(etapa, dados)) {
    // Boas-vindas + menu numerado só no primeiro contato (ou depois de muitas horas).
    const ultima = dados.boas_vindas_em ? Date.parse(dados.boas_vindas_em) : 0;
    if (Date.now() - ultima > BOAS_VINDAS_INTERVALO_MS) {
      // Primeiro contato já com o pedido escrito: a IA monta o carrinho direto.
      const ia = await tentarPedidoIa(
        supabase,
        cfg,
        { ...dados, boas_vindas_em: new Date().toISOString() },
        rawText,
        `Olá! 👋 Aqui é o atendimento do *${cfg.nome_loja}*.`,
      );
      if (ia) return ia;
      return showMenuPrincipal(
        { ...dados, boas_vindas_em: new Date().toISOString() },
        formatBoasVindas(cfg),
      );
    }
    // Conversa livre → não responde (atendimento humano)
    return { messages: [], etapa: "inicio", dados, noReply: true };
  }

  // Fluxo por etapa
  switch (etapa) {
    case "inicio": {
      return { messages: [], etapa: "inicio", dados, noReply: true };
    }

    case "menu_principal": {
      if (selected === "1") return showCategorias(supabase, cfg, dados);
      if (selected === "2") {
        return {
          messages: [textMsg(`${formatCardapioLinkMsg(cfg)}\n\nOu digite *1* para pedir por aqui.`)],
          etapa: "menu_principal",
          dados,
        };
      }
      if (selected === "3") {
        return {
          messages: [textMsg("👍 Certo! Um atendente vai te responder por aqui em instantes.")],
          etapa: "inicio",
          dados: { ...dados, bot_ativo: false },
        };
      }
      // Pedido escrito por extenso: a IA tenta entender antes de sair do bot.
      const ia = await tentarPedidoIa(supabase, cfg, dados, rawText);
      if (ia) return ia;
      // Qualquer outra mensagem: conversa livre com o atendente, sem insistir.
      return silentExit(dados);
    }

    case "menu_categoria": {
      if (text === "0") return showMenuPrincipal(dados);
      const categorias = await loadCategorias(supabase, cfg.owner_id);
      const cat = pickOption(categorias, selected);
      if (!cat) {
        const ia = await tentarPedidoIa(supabase, cfg, dados, rawText);
        if (ia) return ia;
        return invalidInput(etapa, dados, "Não encontrei essa opção. Digite o *número* da categoria ou *0* para voltar.");
      }
      return showProdutos(supabase, cfg, dados, cat.id, cat.nome);
    }

    case "menu_produto": {
      if (text === "0") return showCategorias(supabase, cfg, dados);

      const pagina = dados.pagina_produtos || 0;
      const produtos = await loadProdutos(supabase, cfg.owner_id, dados.categoria_id!);
      const hasMore = produtos.length > (pagina + 1) * PRODUTOS_POR_PAGINA;
      if ((text === "9" || text === "mais") && hasMore) {
        return showProdutos(
          supabase,
          cfg,
          dados,
          dados.categoria_id!,
          dados.categoria_nome || "Produtos",
          pagina + 1,
        );
      }

      const slice = produtos.slice(pagina * PRODUTOS_POR_PAGINA, (pagina + 1) * PRODUTOS_POR_PAGINA);
      const produto = produtos.find((p) => p.id === selected) ||
        slice[parseInt(selected, 10) - 1];
      if (!produto) {
        const ia = await tentarPedidoIa(supabase, cfg, dados, rawText);
        if (ia) return ia;
        return invalidInput(etapa, dados, "Não encontrei esse produto. Digite o *número* do produto ou *0* para voltar.");
      }
      return startProdutoConfig(supabase, cfg, dados, produto.id);
    }

    case "produto_quantidade": {
      if (text === "0") {
        delete dados.produto_temp;
        return showProdutos(
          supabase,
          cfg,
          dados,
          dados.categoria_id!,
          dados.categoria_nome || "Produtos",
          dados.pagina_produtos || 0,
        );
      }
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty < 1 || qty > 9) {
        return invalidInput(etapa, dados, "Digite a quantidade de *1* a *9*, ou *0* para voltar.");
      }
      dados.produto_temp!.quantidade = qty;
      if (dados.produto_temp!.grupos.length === 0) {
        return {
          messages: [observacaoMsg(dados.produto_temp!.nome)],
          etapa: "produto_observacao",
          dados,
        };
      }
      return showAdicionalGrupo(dados);
    }

    case "produto_adicional": {
      const temp = dados.produto_temp!;
      const grupo = temp.grupos[temp.grupo_index];

      if (text === "pular" || text === "0") {
        if (grupo.obrigatorio || grupo.min_escolhas > 0) {
          return invalidInput(etapa, dados, `Este item é obrigatório. Escolha pelo menos ${grupo.min_escolhas || 1} opção.`);
        }
      } else {
        const nums = parseNumbers(text);
        if (!nums.length) {
          return invalidInput(etapa, dados, "Digite o *número* da opção (ou vários separados por vírgula).");
        }

        const selecionados: CartAdicionalWa[] = [];
        for (const n of nums) {
          const ad = grupo.adicionais[n - 1];
          if (!ad) {
            return invalidInput(etapa, dados, `A opção *${n}* não existe. Tente novamente.`);
          }
          selecionados.push({
            adicional_id: ad.id,
            nome: ad.nome,
            quantidade: 1,
            preco_unitario: ad.preco,
          });
        }

        if (selecionados.length > grupo.max_escolhas) {
          return invalidInput(etapa, dados, `Você pode escolher no máximo *${grupo.max_escolhas}* opção(ões) aqui.`);
        }
        if (selecionados.length < (grupo.min_escolhas || (grupo.obrigatorio ? 1 : 0))) {
          return invalidInput(etapa, dados, `Escolha pelo menos *${grupo.min_escolhas || 1}* opção(ões).`);
        }

        temp.adicionais.push(...selecionados);
      }

      temp.grupo_index += 1;
      if (temp.grupo_index < temp.grupos.length || temp.ia) {
        return showAdicionalGrupo(dados);
      }

      return {
        messages: [observacaoMsg(temp.nome)],
        etapa: "produto_observacao",
        dados,
      };
    }

    case "produto_observacao": {
      const obs = text === "pular" || text === "0" ? undefined : rawText.trim();
      return addToCart(dados, obs);
    }

    case "carrinho": {
      if (selected === "1" || text === "1") {
        return showCategorias(supabase, cfg, dados);
      }
      if (selected === "3" || text === "3") {
        return showMenuPrincipal({ ...dados, carrinho: [] }, "🗑️ Carrinho limpo.");
      }
      if (selected === "2" || text === "2" || text === "finalizar") {
        if (!dados.carrinho.length) {
          return showMenuPrincipal(dados, "Seu carrinho está vazio.");
        }

        if (!isLojaAberta(cfg)) {
          return {
            messages: [textMsg("🕐 Estamos fechados no momento. Você pode montar o carrinho, mas não é possível finalizar agora.")],
            etapa: "carrinho",
            dados,
          };
        }

        return {
          messages: [
            listMsg("Como deseja receber?", "Tipo de entrega", "Escolher", opcoesEntrega(cfg)),
          ],
          etapa: "tipo_entrega",
          dados,
        };
      }
      const ia = await tentarPedidoIa(supabase, cfg, dados, rawText);
      if (ia) return ia;
      return invalidInput(etapa, dados, "Digite *1* para adicionar mais itens, *2* para finalizar ou *3* para limpar o carrinho.");
    }

    case "tipo_entrega": {
      const opcoes = opcoesEntrega(cfg);
      const escolha = pickOption(opcoes, selected);
      if (!escolha) {
        const hint = opcoes.length > 1
          ? "Digite *1* para Delivery ou *2* para Retirada."
          : "Digite *1* para Delivery.";
        return invalidInput(etapa, dados, hint);
      }
      dados.tipo_entrega = escolha.id as "delivery" | "retirada";

      const cliente = await loadClienteByPhone(supabase, telefone, cfg.owner_id);
      if (cliente) {
        dados.cliente = {
          nome: cliente.nome,
          endereco: cliente.endereco || undefined,
          numero: cliente.numero || undefined,
          complemento: cliente.complemento || undefined,
          bairro_nome: cliente.bairro || undefined,
        };
      }

      const nomeSug = dados.cliente?.nome || dados.sender_name || "";
      return {
        messages: [
          textMsg(
            nomeSug
              ? `Qual seu nome?\n\n*1* — ${nomeSug}\n\nOu digite seu nome.`
              : "Qual seu nome completo?",
          ),
        ],
        etapa: "cliente_nome",
        dados,
      };
    }

    case "cliente_nome": {
      const nomeSug = dados.cliente?.nome || dados.sender_name || "";
      const nome = (text === "1" || text === "ok") && nomeSug ? nomeSug : rawText.trim();
      if (nome.length < 2) {
        return { messages: [textMsg("Informe seu nome (mínimo 2 letras).")], etapa, dados };
      }
      dados.cliente = { ...dados.cliente, nome };

      if (dados.tipo_entrega === "retirada") {
        return { messages: [pagamentoMsg()], etapa: "forma_pagamento", dados };
      }

      const c = dados.cliente;
      if (c.endereco && c.numero && c.bairro_nome) {
        const endereco = `${c.endereco}, ${c.numero}${c.complemento ? ` — ${c.complemento}` : ""} — ${c.bairro_nome}`;
        return {
          messages: [
            textMsg(`📍 Entregar no mesmo endereço da última vez?\n${endereco}\n\n*1* — Sim\n*2* — Outro endereço`),
          ],
          etapa: "endereco_salvo",
          dados,
        };
      }

      return {
        messages: [textMsg("Qual o endereço (rua/avenida)?")],
        etapa: "cliente_endereco",
        dados,
      };
    }

    case "endereco_salvo": {
      if (text === "1") {
        const bairros = await loadBairros(supabase, cfg.owner_id);
        const nomeBairro = normalizeText(dados.cliente?.bairro_nome || "");
        const bairro = bairros.find((b) => normalizeText(b.nome) === nomeBairro);
        if (bairro) {
          dados.cliente = { ...dados.cliente, bairro_id: bairro.id, bairro_nome: bairro.nome };
          return { messages: [pagamentoMsg()], etapa: "forma_pagamento", dados };
        }
        // Bairro antigo não existe mais: mantém rua/número e pede só o bairro.
        return showBairros(supabase, cfg, dados, "Não encontrei seu bairro na lista atual.");
      }
      if (text === "2") {
        dados.cliente = { nome: dados.cliente?.nome };
        return {
          messages: [textMsg("Qual o endereço (rua/avenida)?")],
          etapa: "cliente_endereco",
          dados,
        };
      }
      return invalidInput(etapa, dados, "Digite *1* para usar o mesmo endereço ou *2* para informar outro.");
    }

    case "cliente_endereco": {
      const endereco = rawText.trim();
      if (endereco.length < 3) {
        return { messages: [textMsg("Informe o endereço completo.")], etapa, dados };
      }
      dados.cliente = { ...dados.cliente, endereco };

      return {
        messages: [textMsg("Qual o número da casa/prédio?")],
        etapa: "cliente_numero",
        dados,
      };
    }

    case "cliente_numero": {
      const numero = rawText.trim();
      if (!numero) {
        return { messages: [textMsg("Informe o número do endereço.")], etapa, dados };
      }
      dados.cliente = { ...dados.cliente, numero };

      return {
        messages: [
          textMsg("Tem complemento? (apto, bloco, referência...)\n\nDigite o complemento ou *0* se não tiver."),
        ],
        etapa: "cliente_complemento",
        dados,
      };
    }

    case "cliente_complemento": {
      const semComplemento = text === "0" || text === "pular" || text === "nao" || text === "não";
      dados.cliente = { ...dados.cliente, complemento: semComplemento ? undefined : rawText.trim() };
      return showBairros(supabase, cfg, dados);
    }

    case "cliente_bairro": {
      const bairros = await loadBairros(supabase, cfg.owner_id);
      const bairro = pickOption(bairros, selected);
      if (!bairro) {
        return invalidInput(etapa, dados, "Não encontrei esse bairro. Digite o *número* do bairro na lista.");
      }
      dados.cliente = { ...dados.cliente, bairro_id: bairro.id, bairro_nome: bairro.nome };
      return { messages: [pagamentoMsg()], etapa: "forma_pagamento", dados };
    }

    case "forma_pagamento": {
      const forma = pickOption(FORMAS_PAGAMENTO, selected);
      if (!forma) {
        return invalidInput(etapa, dados, "Digite *1* para PIX, *2* para Cartão ou *3* para Dinheiro.");
      }
      dados.forma_pagamento = forma.id;

      if (forma.id === "dinheiro") {
        return {
          messages: [textMsg("Precisa de troco? Digite para quanto (ex: *50*).\n*0* — Não preciso de troco")],
          etapa: "troco",
          dados,
        };
      }

      return buildConfirmacao(supabase, cfg, dados);
    }

    case "troco": {
      if (["0", "nao", "não", "n"].includes(text)) {
        dados.troco_para = undefined;
      } else {
        const val = parseFloat(text.replace(/[^\d,.]/g, "").replace(",", "."));
        if (isNaN(val) || val <= 0) {
          return invalidInput(etapa, dados, "Digite o valor para o troco (ex: *50*) ou *0* se não precisar.");
        }
        dados.troco_para = val;
      }
      return buildConfirmacao(supabase, cfg, dados);
    }

    case "confirmacao": {
      if (["1", "sim", "s", "confirmar", "ok"].includes(text)) {
        return finalizeOrder(supabase, cfg, dados, telefone);
      }
      if (["2", "nao", "não", "n", "voltar"].includes(text)) {
        return showCarrinho(dados, "Sem problemas, o pedido ainda não foi enviado.");
      }
      return invalidInput(etapa, dados, "Digite *1* para confirmar o pedido ou *2* para voltar ao carrinho.");
    }

    case "finalizado": {
      const cat = await showCategorias(supabase, cfg, emptyDados(senderName));
      return {
        messages: [textMsg("Quer fazer outro pedido? 😊"), ...cat.messages],
        etapa: cat.etapa,
        dados: cat.dados,
      };
    }

    default:
      return showCategorias(supabase, cfg, dados);
  }
}

function showCarrinho(dados: SessionDados, intro?: string): FlowResult {
  const cart = `${formatCart(dados.carrinho)}\n\n*1* — Adicionar mais itens\n*2* — Finalizar pedido\n*3* — Limpar carrinho`;
  return {
    messages: [textMsg(intro ? `${intro}\n\n${cart}` : cart)],
    etapa: "carrinho",
    dados: { ...dados, bot_ativo: true },
  };
}

function opcoesEntrega(cfg: LojaConfig) {
  const delivery = { id: "delivery", title: "🛵 Delivery", description: "Entrega no endereço" };
  if (cfg.retirada_ativa === false) return [delivery];
  return [delivery, { id: "retirada", title: "🏪 Retirada", description: "Buscar no balcão" }];
}

async function showBairros(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  dados: SessionDados,
  intro?: string,
): Promise<FlowResult> {
  const bairros = await loadBairros(supabase, cfg.owner_id);
  if (!bairros.length) {
    return {
      messages: [textMsg("Nenhum bairro cadastrado. Entre em contato com a loja.")],
      etapa: "carrinho",
      dados,
    };
  }

  const options = bairros.map((b) => ({
    id: b.id,
    title: b.nome,
    description: Number(b.taxa) > 0 ? `Taxa: ${brl(Number(b.taxa))}` : "Sem taxa",
  }));
  const text = intro ? `${intro}\n\nSelecione seu bairro:` : "Selecione seu bairro:";

  return {
    messages: [listMsg(text, "Bairros", "Ver bairros", options)],
    etapa: "cliente_bairro",
    dados,
  };
}

async function buildConfirmacao(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  dados: SessionDados,
): Promise<FlowResult> {
  const subtotal = cartSubtotal(dados.carrinho);
  let taxaBairro = 0;
  let bairroFrete: { frete_gratis_ativo?: boolean; frete_gratis_minimo?: number | null } | null = null;
  if (dados.tipo_entrega === "delivery" && dados.cliente?.bairro_id) {
    const bairros = await loadBairros(supabase, cfg.owner_id);
    const bairro = bairros.find((b) => b.id === dados.cliente!.bairro_id);
    taxaBairro = bairro ? Number(bairro.taxa) : 0;
    bairroFrete = bairro;
  }
  const bloqueiaFreteGratis = await carrinhoBloqueiaFreteGratis(
    supabase,
    cfg.owner_id,
    dados.carrinho.map((item) => item.produto_id),
  );
  const taxa = calcularTaxaEntregaWhatsapp({
    tipoEntrega: dados.tipo_entrega || "delivery",
    taxaBairro,
    subtotal,
    cfg,
    bairro: bairroFrete,
    bloqueiaFreteGratis,
  });
  const total = subtotal + taxa;

  return {
    messages: [
      textMsg(
        `${formatResumoConfirmacao(dados, taxa, total)}\n\n✅ Confirma o pedido?\n*1* — Confirmar\n*2* — Voltar ao carrinho`,
      ),
    ],
    etapa: "confirmacao",
    dados,
  };
}

async function finalizeOrder(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  dados: SessionDados,
  telefone: string,
): Promise<FlowResult> {
  const subtotal = cartSubtotal(dados.carrinho);
  let taxaBairro = 0;
  let bairroFrete: { frete_gratis_ativo?: boolean; frete_gratis_minimo?: number | null } | null = null;
  if (dados.tipo_entrega === "delivery" && dados.cliente?.bairro_id) {
    const bairros = await loadBairros(supabase, cfg.owner_id);
    const bairro = bairros.find((b) => b.id === dados.cliente!.bairro_id);
    taxaBairro = bairro ? Number(bairro.taxa) : 0;
    bairroFrete = bairro;
  }
  const bloqueiaFreteGratis = await carrinhoBloqueiaFreteGratis(
    supabase,
    cfg.owner_id,
    dados.carrinho.map((item) => item.produto_id),
  );
  const taxa = calcularTaxaEntregaWhatsapp({
    tipoEntrega: dados.tipo_entrega || "delivery",
    taxaBairro,
    subtotal,
    cfg,
    bairro: bairroFrete,
    bloqueiaFreteGratis,
  });
  const total = subtotal + taxa;

  const items = dados.carrinho.map((item) => ({
    ...item,
    observacao: item.observacao
      ? encodeKdsObservation(item.produto_nome, item.observacao)
      : encodeKdsObservation(item.produto_nome),
  }));

  try {
    const telefoneNormalizado = formatPhoneZapi(telefone);

    const result = await createWhatsappOrder(supabase, cfg.owner_id, {
      tipo_entrega: dados.tipo_entrega!,
      cliente_nome: dados.cliente!.nome!,
      cliente_telefone: telefoneNormalizado,
      endereco: dados.tipo_entrega === "delivery"
        ? dados.cliente!.endereco!
        : "Retirada no balcão",
      numero: dados.tipo_entrega === "delivery" ? dados.cliente!.numero! : null,
      complemento: dados.tipo_entrega === "delivery"
        ? dados.cliente!.complemento || null
        : null,
      bairro: dados.tipo_entrega === "delivery" ? dados.cliente!.bairro_nome! : null,
      taxa_entrega: taxa,
      forma_pagamento: dados.forma_pagamento!,
      troco_para: dados.troco_para ?? null,
      subtotal,
      total,
      items,
    });

    const tempo = cfg.tempo_entrega_min || "30-45 min";
    let resumo = dados.carrinho.map((i) => {
      const lines = [`${i.quantidade}x ${i.produto_nome} — ${brl(i.preco_unitario * i.quantidade)}`];
      for (const ad of i.adicionais) {
        const qty = ad.quantidade > 1 ? ` x${ad.quantidade}` : "";
        lines.push(`  + ${ad.nome}${qty}`);
      }
      if (i.observacao?.trim()) lines.push(`  Obs: ${i.observacao.trim()}`);
      return lines.join("\n");
    }).join("\n");

    if (taxa > 0) {
      resumo += `\n\nTaxa de entrega: ${brl(taxa)}`;
    }

    // Confirmação via template configurável (send-whatsapp)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let confirmMsg = `🎉 Pedido confirmado! Total: ${brl(total)}. Obrigado, ${dados.cliente!.nome}! 🍔`;

    if (supabaseUrl && serviceKey) {
      try {
        const wppRes = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            pedido_id: result.pedido_id,
            tipo_mensagem: "confirmado",
            telefone: telefoneNormalizado,
            dados_pedido: {
              nome: dados.cliente!.nome,
              itens: resumo,
              total: brl(total),
              tempo_estimado: tempo,
            },
          }),
        });
        const wppData = await wppRes.json().catch(() => null);
        if (wppData?.status === "enviado") {
          confirmMsg = "";
        }
      } catch {
        // fallback message below
      }
    }

    const messages = confirmMsg ? [textMsg(confirmMsg)] : [];
    if (dados.tipo_entrega === "retirada" && cfg.endereco_estabelecimento) {
      messages.push(textMsg(`📍 Retire em: ${cfg.endereco_estabelecimento}`));
    }
    messages.push(textMsg("Obrigado! 😊 Para fazer outro pedido, é só digitar *1*."));

    return {
      messages,
      etapa: "menu_principal",
      dados: emptyDados(dados.sender_name),
    };
  } catch (err) {
    return {
      messages: [
        textMsg(
          `❌ Não foi possível criar o pedido: ${err instanceof Error ? err.message : "erro desconhecido"}\n\nDigite *1* para tentar de novo ou *2* para voltar ao carrinho.`,
        ),
      ],
      etapa: "confirmacao",
      dados,
    };
  }
}

export async function handleIncomingMessage(
  supabase: SupabaseClient,
  cfg: LojaConfig,
  telefone: string,
  rawText: string,
  selectedId: string | null,
  messageId: string | undefined,
  senderName?: string,
): Promise<void> {
  const { getSession } = await import("./db.ts");
  const { sendWhatsappMessage } = await import("./sender.ts");
  const isEvolution = cfg.whatsapp_provider === "evolution";

  const session = await getSession(supabase, cfg.owner_id, telefone);

  if (messageId && session?.ultimo_message_id === messageId) {
    return;
  }

  // Evolution envia listas como texto numerado: traduz "2" para o id da 2ª opção.
  const opcoes = session?.dados.opcoes_numeradas;
  if (isEvolution && !selectedId && opcoes?.length) {
    const n = Number(rawText.trim());
    if (Number.isInteger(n) && n >= 1 && n <= opcoes.length) {
      selectedId = opcoes[n - 1];
    }
  }

  const result = await processMessage(
    supabase,
    cfg,
    session,
    telefone,
    rawText,
    selectedId,
    senderName,
  );

  let etapa = result.etapa;
  let dados: SessionDados = { ...result.dados };
  if (result.clearSession) {
    etapa = "inicio";
    dados = { carrinho: [], sender_name: dados.sender_name ?? session?.dados.sender_name };
  }
  // A sessão nunca é apagada: guarda quando a boas-vindas foi enviada para não repetir.
  dados.boas_vindas_em ??= session?.dados.boas_vindas_em;
  if (!result.invalid) delete dados.invalidas;

  if (isEvolution) {
    const lista = [...result.messages].reverse().find((m) => m.optionList?.options.length);
    dados.opcoes_numeradas = lista?.optionList?.options.map((o) => o.id);
  }

  await upsertSession(supabase, cfg.owner_id, telefone, etapa, dados, messageId);

  if (result.noReply) return;

  for (const msg of result.messages) {
    await sendWhatsappMessage(cfg, telefone, msg);
    await new Promise((r) => setTimeout(r, 800));
  }
}
