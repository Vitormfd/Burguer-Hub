import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createWhatsappOrder,
  deleteSession,
  isLojaAberta,
  loadBairros,
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
  formatPagamento,
  calcularTaxaEntregaWhatsapp,
  formatResumoConfirmacao,
  normalizeText,
} from "./format.ts";
import type {
  CartAdicionalWa,
  CartItemWa,
  Etapa,
  LojaConfig,
  OutboundMessage,
  SessionDados,
  WhatsappSession,
} from "./format.ts";

const PRODUTOS_POR_PAGINA = 8;

interface FlowResult {
  messages: OutboundMessage[];
  etapa: Etapa;
  dados: SessionDados;
  clearSession?: boolean;
  /** Não envia resposta — deixa a conversa livre para atendimento humano */
  noReply?: boolean;
}

const BOT_START_COMMANDS = ["menu", "cardapio", "cardápio", "pedido"];
const GREETING_COMMANDS = ["oi", "olá", "ola", "bom dia", "boa tarde", "boa noite"];
const GLOBAL_COMMANDS = [
  ...BOT_START_COMMANDS,
  ...GREETING_COMMANDS,
  "ajuda", "help", "comandos",
  "cancelar", "sair", "desistir",
  "link", "site", "cardapio online", "cardápio online", "web",
  "carrinho", "ver carrinho",
  "inicio", "início",
];

function isBotFlowActive(etapa: Etapa, dados: SessionDados): boolean {
  if (dados.bot_ativo) return true;
  if (dados.carrinho.length > 0) return true;
  if (dados.produto_temp) return true;
  const midFlow: Etapa[] = [
    "menu_categoria", "menu_produto",
    "produto_quantidade", "produto_adicional", "produto_observacao",
    "carrinho", "tipo_entrega", "cliente_nome", "cliente_endereco",
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
): OutboundMessage {
  if (options.length <= 10) {
    return { text, optionList: { title, buttonLabel, options } };
  }
  const numbered = options
    .map((o, i) => `*${i + 1}.* ${o.title}${o.description ? ` — ${o.description}` : ""}`)
    .join("\n");
  return { text: `${text}\n\n${numbered}\n\n_Digite o número da opção._` };
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
    description: "Ver produtos",
  }));

  return {
    messages: [
      listMsg("🍔 *Cardápio* — Escolha uma categoria:", "Categorias", "Ver categorias", options),
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
      messages: [textMsg("Nenhum produto disponível nesta categoria. Digite *menu* para voltar.")],
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
  const msgs: OutboundMessage[] = [
    listMsg(
      `📋 *${categoriaNome}* — Escolha um produto:`,
      categoriaNome,
      "Ver produtos",
      options,
    ),
  ];

  if (hasMore) {
    msgs.push(textMsg(`_Há mais produtos. Digite *mais* para ver a próxima página._`));
  }

  return {
    messages: msgs,
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
      messages: [textMsg("Produto não encontrado. Digite *menu* para recomeçar.")],
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
        `✅ *${produto.nome}* — ${brl(preco)}\n\nQuantas unidades? (digite um número de 1 a 9)`,
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
    return {
      messages: [
        textMsg(
          `Alguma observação para *${temp.nome}*?\n\nDigite a observação ou *pular* para continuar.`,
        ),
      ],
      etapa: "produto_observacao",
      dados,
    };
  }

  const obrig = grupo.obrigatorio || grupo.min_escolhas > 0;
  const max = grupo.max_escolhas;
  const lines = [
    `🧀 *${grupo.nome}*`,
    obrig ? `_Escolha ${grupo.min_escolhas || 1} a ${max} opção(ões):_` : `_Opcional — escolha até ${max} ou digite *pular*:_`,
    "",
  ];

  grupo.adicionais.forEach((a, i) => {
    const preco = a.preco > 0 ? ` (+${brl(a.preco)})` : "";
    lines.push(`*${i + 1}.* ${a.nome}${preco}`);
  });

  if (!obrig) lines.push("\n_Digite *pular* para não adicionar nada._");
  lines.push("\n_Digite o(s) número(s) separados por vírgula._");

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

  return {
    messages: [
      textMsg(`✅ *${temp.nome}* adicionado ao carrinho!\n\n${formatCart(carrinho)}\n\n*1* — Adicionar mais itens\n*2* — Finalizar pedido\n*3* — Limpar carrinho`),
    ],
    etapa: "carrinho",
    dados: { ...dados, carrinho },
  };
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

  if (["cancelar", "sair", "desistir"].includes(text)) {
    return {
      messages: [textMsg("Pedido cancelado. Quando quiser, é só mandar *menu*! 👋")],
      etapa: "inicio",
      dados: emptyDados(senderName),
      clearSession: true,
    };
  }

  if (BOT_START_COMMANDS.includes(text)) {
    const cat = await showCategorias(supabase, cfg, { ...dados, bot_ativo: true });
    return cat;
  }

  if (GREETING_COMMANDS.includes(text) || ["inicio", "início"].includes(text)) {
    return {
      messages: [textMsg(formatBoasVindas(cfg))],
      etapa: "inicio",
      dados,
    };
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
        messages: [textMsg("Você não tem pedido em andamento. Digite *menu* para começar.")],
        etapa: "inicio",
        dados,
      };
    }
    return {
      messages: [
        textMsg(
          `${formatCart(dados.carrinho)}\n\n*1* — Adicionar mais\n*2* — Finalizar\n*3* — Limpar`,
        ),
      ],
      etapa: "carrinho",
      dados: { ...dados, bot_ativo: true },
    };
  }

  // Mensagem livre fora do fluxo do bot → não responde (atendimento humano)
  if (!isBotFlowActive(etapa, dados) && !GLOBAL_COMMANDS.includes(text)) {
    if (!session) {
      return {
        messages: [textMsg(formatBoasVindas(cfg))],
        etapa: "inicio",
        dados,
      };
    }
    return { messages: [], etapa: "inicio", dados, noReply: true };
  }

  // Fluxo por etapa
  switch (etapa) {
    case "inicio": {
      return { messages: [], etapa: "inicio", dados, noReply: true };
    }

    case "menu_categoria": {
      const categorias = await loadCategorias(supabase, cfg.owner_id);
      const cat = categorias.find((c) => c.id === selected) ||
        categorias[parseInt(selected, 10) - 1];
      if (!cat) {
        return silentExit(dados);
      }
      return showProdutos(supabase, cfg, dados, cat.id, cat.nome);
    }

    case "menu_produto": {
      if (text === "mais" && dados.pagina_produtos != null) {
        return showProdutos(
          supabase,
          cfg,
          dados,
          dados.categoria_id!,
          dados.categoria_nome || "Produtos",
          dados.pagina_produtos + 1,
        );
      }

      const produtos = await loadProdutos(supabase, cfg.owner_id, dados.categoria_id!);
      const slice = produtos.slice(
        (dados.pagina_produtos || 0) * PRODUTOS_POR_PAGINA,
        ((dados.pagina_produtos || 0) + 1) * PRODUTOS_POR_PAGINA,
      );
      const produto = produtos.find((p) => p.id === selected) ||
        slice[parseInt(selected, 10) - 1];
      if (!produto) {
        if (!selectedId && isNaN(parseInt(selected, 10))) {
          return silentExit(dados);
        }
        return {
          messages: [textMsg("Produto inválido. Escolha um da lista ou digite *menu*.")],
          etapa,
          dados,
        };
      }
      return startProdutoConfig(supabase, cfg, dados, produto.id);
    }

    case "produto_quantidade": {
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty < 1 || qty > 9) {
        return {
          messages: [textMsg("Digite um número de *1* a *9*.")],
          etapa,
          dados,
        };
      }
      dados.produto_temp!.quantidade = qty;
      if (dados.produto_temp!.grupos.length === 0) {
        return {
          messages: [
            textMsg(
              `Alguma observação para *${dados.produto_temp!.nome}*?\n\nDigite ou *pular*.`,
            ),
          ],
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
          return {
            messages: [textMsg(`Este grupo é obrigatório. Escolha pelo menos ${grupo.min_escolhas || 1} opção.`)],
            etapa,
            dados,
          };
        }
      } else {
        const nums = parseNumbers(text);
        if (!nums.length) {
          return {
            messages: [textMsg("Digite o(s) número(s) da lista ou *pular*.")],
            etapa,
            dados,
          };
        }

        const selecionados: CartAdicionalWa[] = [];
        for (const n of nums) {
          const ad = grupo.adicionais[n - 1];
          if (!ad) {
            return {
              messages: [textMsg(`Opção *${n}* inválida. Tente novamente.`)],
              etapa,
              dados,
            };
          }
          selecionados.push({
            adicional_id: ad.id,
            nome: ad.nome,
            quantidade: 1,
            preco_unitario: ad.preco,
          });
        }

        if (selecionados.length > grupo.max_escolhas) {
          return {
            messages: [textMsg(`Máximo de *${grupo.max_escolhas}* opção(ões) neste grupo.`)],
            etapa,
            dados,
          };
        }
        if (selecionados.length < (grupo.min_escolhas || (grupo.obrigatorio ? 1 : 0))) {
          return {
            messages: [textMsg(`Escolha pelo menos *${grupo.min_escolhas || 1}* opção(ões).`)],
            etapa,
            dados,
          };
        }

        temp.adicionais.push(...selecionados);
      }

      temp.grupo_index += 1;
      if (temp.grupo_index < temp.grupos.length) {
        return showAdicionalGrupo(dados);
      }

      return {
        messages: [
          textMsg(
            `Alguma observação para *${temp.nome}*?\n\nDigite ou *pular*.`,
          ),
        ],
        etapa: "produto_observacao",
        dados,
      };
    }

    case "produto_observacao": {
      const obs = text === "pular" ? undefined : rawText.trim();
      return addToCart(dados, obs);
    }

    case "carrinho": {
      if (selected === "1" || text === "1") {
        return showCategorias(supabase, cfg, dados);
      }
      if (selected === "3" || text === "3") {
        return {
          messages: [textMsg("Carrinho limpo. Digite *menu* para adicionar itens.")],
          etapa: "inicio",
          dados: { ...dados, carrinho: [] },
        };
      }
      if (selected === "2" || text === "2" || text === "finalizar") {
        if (!dados.carrinho.length) {
          return {
            messages: [textMsg("Seu carrinho está vazio. Digite *menu* para adicionar itens.")],
            etapa: "inicio",
            dados,
          };
        }

        if (!isLojaAberta(cfg)) {
          return {
            messages: [textMsg("🕐 Estamos fechados no momento. Você pode montar o carrinho, mas não é possível finalizar agora.")],
            etapa: "carrinho",
            dados,
          };
        }

        const opcoes = cfg.retirada_ativa === false
          ? [{ id: "delivery", title: "🛵 Delivery", description: "Entrega no endereço" }]
          : [
            { id: "delivery", title: "🛵 Delivery", description: "Entrega no endereço" },
            { id: "retirada", title: "🏪 Retirada", description: "Buscar no balcão" },
          ];

        return {
          messages: [
            listMsg("Como deseja receber?", "Tipo de entrega", "Escolher", opcoes),
          ],
          etapa: "tipo_entrega",
          dados,
        };
      }
      return {
        messages: [textMsg("Digite *1*, *2* ou *3*, ou use os comandos *menu* / *cancelar*.")],
        etapa,
        dados,
      };
    }

    case "tipo_entrega": {
      if (!["delivery", "retirada"].includes(selected)) {
        return {
          messages: [textMsg("Escolha *Delivery* ou *Retirada* na lista.")],
          etapa,
          dados,
        };
      }
      dados.tipo_entrega = selected as "delivery" | "retirada";

      const cliente = await loadClienteByPhone(supabase, telefone);
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
              ? `Qual seu nome?\n\n_Sugestão: ${nomeSug} — digite *ok* para confirmar_`
              : "Qual seu nome completo?",
          ),
        ],
        etapa: "cliente_nome",
        dados,
      };
    }

    case "cliente_nome": {
      const nome = text === "ok" && dados.cliente?.nome
        ? dados.cliente.nome
        : rawText.trim();
      if (nome.length < 2) {
        return { messages: [textMsg("Informe seu nome (mínimo 2 caracteres).")], etapa, dados };
      }
      dados.cliente = { ...dados.cliente, nome };

      if (dados.tipo_entrega === "retirada") {
        return {
          messages: [
            listMsg("Forma de pagamento:", "Pagamento", "Escolher", [
              { id: "pix", title: "PIX", description: "" },
              { id: "cartao", title: "Cartão", description: "Débito ou crédito" },
              { id: "dinheiro", title: "Dinheiro", description: "" },
            ]),
          ],
          etapa: "forma_pagamento",
          dados,
        };
      }

      const endSug = dados.cliente?.endereco;
      return {
        messages: [
          textMsg(
            endSug
              ? `Qual o endereço (rua/avenida)?\n\n_Sugestão: ${endSug} — digite *ok* para confirmar_`
              : "Qual o endereço (rua/avenida)?",
          ),
        ],
        etapa: "cliente_endereco",
        dados,
      };
    }

    case "cliente_endereco": {
      const endereco = text === "ok" && dados.cliente?.endereco
        ? dados.cliente.endereco
        : rawText.trim();
      if (endereco.length < 3) {
        return { messages: [textMsg("Informe o endereço completo.")], etapa, dados };
      }
      dados.cliente = { ...dados.cliente, endereco };

      const numSug = dados.cliente?.numero;
      return {
        messages: [
          textMsg(
            numSug
              ? `Qual o número?\n\n_Sugestão: ${numSug} — digite *ok*_`
              : "Qual o número?",
          ),
        ],
        etapa: "cliente_numero",
        dados,
      };
    }

    case "cliente_numero": {
      const numero = text === "ok" && dados.cliente?.numero
        ? dados.cliente.numero
        : rawText.trim();
      if (!numero) {
        return { messages: [textMsg("Informe o número do endereço.")], etapa, dados };
      }
      dados.cliente = { ...dados.cliente, numero };

      return {
        messages: [
          textMsg("Tem complemento? (apto, bloco...)\n\nDigite ou *pular*."),
        ],
        etapa: "cliente_complemento",
        dados,
      };
    }

    case "cliente_complemento": {
      if (text !== "pular") {
        dados.cliente = { ...dados.cliente, complemento: rawText.trim() };
      }

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

      return {
        messages: [
          listMsg("Selecione seu bairro:", "Bairros", "Ver bairros", options),
        ],
        etapa: "cliente_bairro",
        dados,
      };
    }

    case "cliente_bairro": {
      const bairros = await loadBairros(supabase, cfg.owner_id);
      const bairro = bairros.find((b) => b.id === selected) ||
        bairros[parseInt(selected, 10) - 1];
      if (!bairro) {
        return { messages: [textMsg("Bairro inválido. Escolha da lista.")], etapa, dados };
      }
      dados.cliente = { ...dados.cliente, bairro_id: bairro.id, bairro_nome: bairro.nome };

      return {
        messages: [
          listMsg("Forma de pagamento:", "Pagamento", "Escolher", [
            { id: "pix", title: "PIX", description: "" },
            { id: "cartao", title: "Cartão", description: "Débito ou crédito" },
            { id: "dinheiro", title: "Dinheiro", description: "" },
          ]),
        ],
        etapa: "forma_pagamento",
        dados,
      };
    }

    case "forma_pagamento": {
      if (!["pix", "cartao", "dinheiro"].includes(selected)) {
        return { messages: [textMsg("Escolha uma forma de pagamento da lista.")], etapa, dados };
      }
      dados.forma_pagamento = selected;

      if (selected === "dinheiro") {
        return {
          messages: [textMsg("Precisa de troco? Digite o valor (ex: 50) ou *nao*.")],
          etapa: "troco",
          dados,
        };
      }

      return buildConfirmacao(supabase, cfg, dados);
    }

    case "troco": {
      if (text === "nao" || text === "não" || text === "n") {
        dados.troco_para = undefined;
      } else {
        const val = parseFloat(text.replace(",", "."));
        if (isNaN(val) || val <= 0) {
          return { messages: [textMsg("Valor inválido. Digite o valor ou *nao*.")], etapa, dados };
        }
        dados.troco_para = val;
      }
      return buildConfirmacao(supabase, cfg, dados);
    }

    case "confirmacao": {
      if (["sim", "s", "confirmar", "ok", "1"].includes(text)) {
        return finalizeOrder(supabase, cfg, dados, telefone);
      }
      if (["nao", "não", "n", "2", "voltar"].includes(text)) {
        return {
          messages: [textMsg("Pedido não confirmado. Digite *carrinho* para revisar ou *menu* para adicionar itens.")],
          etapa: "carrinho",
          dados,
        };
      }
      return {
        messages: [textMsg("Responda *sim* para confirmar ou *não* para voltar.")],
        etapa,
        dados,
      };
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
  const taxa = calcularTaxaEntregaWhatsapp({
    tipoEntrega: dados.tipo_entrega || "delivery",
    taxaBairro,
    subtotal,
    cfg,
    bairro: bairroFrete,
  });
  const total = subtotal + taxa;

  return {
    messages: [
      textMsg(
        `${formatResumoConfirmacao(dados, taxa, total)}\n\n✅ Confirma o pedido?\n*sim* ou *não*`,
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
  const taxa = calcularTaxaEntregaWhatsapp({
    tipoEntrega: dados.tipo_entrega || "delivery",
    taxaBairro,
    subtotal,
    cfg,
    bairro: bairroFrete,
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
    messages.push(textMsg("Digite *menu* para fazer outro pedido."));

    return {
      messages,
      etapa: "finalizado",
      dados: emptyDados(dados.sender_name),
      clearSession: true,
    };
  } catch (err) {
    return {
      messages: [
        textMsg(
          `❌ Não foi possível criar o pedido: ${err instanceof Error ? err.message : "erro desconhecido"}\n\nTente novamente ou digite *carrinho*.`,
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
  const { sendZapiMessage } = await import("./zapi.ts");

  const session = await getSession(supabase, cfg.owner_id, telefone);

  if (messageId && session?.ultimo_message_id === messageId) {
    return;
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

  if (result.noReply) {
    if (result.clearSession) {
      await deleteSession(supabase, cfg.owner_id, telefone);
    }
    return;
  }

  if (result.clearSession) {
    await deleteSession(supabase, cfg.owner_id, telefone);
  } else {
    await upsertSession(
      supabase,
      cfg.owner_id,
      telefone,
      result.etapa,
      result.dados,
      messageId,
    );
  }

  for (const msg of result.messages) {
    await sendZapiMessage(cfg, telefone, msg);
    await new Promise((r) => setTimeout(r, 800));
  }
}
