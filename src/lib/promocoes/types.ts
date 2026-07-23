import { z } from "zod";

/** Tipos de promoção suportados pelo motor. */
export const PROMOCAO_TIPOS = [
  "desconto_percentual",
  "desconto_fixo",
  "frete_gratis",
  "compre_x_leve_y",
  "brinde",
  "combo",
  "desconto_categoria",
  "desconto_produto",
  "leve_mais_pague_menos",
  "pontos",
  "cupom",
] as const;

export type PromocaoTipo = (typeof PROMOCAO_TIPOS)[number];

export const PROMOCAO_TIPO_LABELS: Record<PromocaoTipo, string> = {
  desconto_percentual: "Desconto percentual",
  desconto_fixo: "Desconto fixo",
  frete_gratis: "Frete grátis",
  compre_x_leve_y: "Compre X leve Y",
  brinde: "Brinde",
  combo: "Combo",
  desconto_categoria: "Desconto em categoria",
  desconto_produto: "Desconto em produto",
  leve_mais_pague_menos: "Leve mais e pague menos",
  pontos: "Pontos extras",
  cupom: "Cupom (campanha)",
};

export const CONDICAO_TIPOS = [
  "valor_minimo",
  "valor_maximo",
  "qtd_min_itens",
  "qtd_max_itens",
  "categoria",
  "produto",
  "excluir_produto",
  "tipo_entrega",
  "forma_pagamento",
  "primeiro_pedido",
  "cliente_novo",
  "cliente_vip",
  "cidade",
  "bairro",
  "contem_produto",
  "nao_contem_produto",
  "qtd_pedidos_anteriores",
  "pedido_acima",
] as const;

export type CondicaoTipo = (typeof CONDICAO_TIPOS)[number];

export const CONDICAO_TIPO_LABELS: Record<CondicaoTipo, string> = {
  valor_minimo: "Valor mínimo do pedido",
  valor_maximo: "Valor máximo do pedido",
  qtd_min_itens: "Quantidade mínima de itens",
  qtd_max_itens: "Quantidade máxima de itens",
  categoria: "Categoria específica",
  produto: "Produto específico",
  excluir_produto: "Excluir produtos",
  tipo_entrega: "Tipo de entrega",
  forma_pagamento: "Forma de pagamento",
  primeiro_pedido: "Primeiro pedido",
  cliente_novo: "Cliente novo (0 pedidos)",
  cliente_vip: "Cliente VIP (> N pedidos)",
  cidade: "Cidade",
  bairro: "Bairro",
  contem_produto: "Pedido contendo produto",
  nao_contem_produto: "Pedido NÃO contendo produto",
  qtd_pedidos_anteriores: "Quantidade de pedidos anteriores",
  pedido_acima: "Pedido acima de X reais",
};

export const escopoProdutosSchema = z.object({
  modo: z.enum(["todos", "categorias", "produtos"]).default("todos"),
  categoria_ids: z.array(z.string()).default([]),
  produto_ids: z.array(z.string()).default([]),
  excluir_produto_ids: z.array(z.string()).default([]),
});

export type EscopoProdutos = z.infer<typeof escopoProdutosSchema>;

export const condicaoSchema = z.object({
  tipo: z.enum(CONDICAO_TIPOS),
  params: z.record(z.unknown()).default({}),
});

export type PromocaoCondicao = z.infer<typeof condicaoSchema>;

export const acaoSchema = z
  .object({
    percentual: z.number().optional(),
    teto: z.number().optional(),
    valor_fixo: z.number().optional(),
    frete: z
      .object({
        modo: z.enum(["gratis", "ate_valor"]).default("gratis"),
        valor_max: z.number().optional(),
      })
      .optional(),
    compre_x_leve_y: z
      .object({
        produto_id: z.string(),
        qtd_compra: z.number().int().positive(),
        produto_bonus_id: z.string(),
        qtd_bonus: z.number().int().positive(),
      })
      .optional(),
    brinde: z
      .object({
        produto_ids: z.array(z.string()).min(1),
        qtd: z.number().int().positive().default(1),
      })
      .optional(),
    combo: z
      .object({
        itens: z
          .array(
            z.object({
              produto_id: z.string(),
              qtd: z.number().int().positive().default(1),
            }),
          )
          .min(1),
        preco: z.number().nonnegative(),
      })
      .optional(),
    desconto_categoria: z
      .object({
        categoria_ids: z.array(z.string()).min(1),
        percentual: z.number().positive(),
      })
      .optional(),
    desconto_produto: z
      .object({
        produto_ids: z.array(z.string()).min(1),
        percentual: z.number().optional(),
        valor_fixo: z.number().optional(),
      })
      .optional(),
    leve_mais: z
      .object({
        produto_ids: z.array(z.string()).default([]),
        categoria_ids: z.array(z.string()).default([]),
        faixas: z
          .array(
            z.object({
              qtd: z.number().int().positive(),
              preco: z.number().nonnegative(),
            }),
          )
          .min(1),
      })
      .optional(),
    pontos: z
      .object({
        extra: z.number().int().positive(),
      })
      .optional(),
    /** Usado quando tipo = cupom (espelha percentual/fixo/frete/brinde). */
    cupom_modo: z.enum(["percentual", "fixo", "frete_gratis", "brinde"]).optional(),
  })
  .passthrough();

export type PromocaoAcao = z.infer<typeof acaoSchema>;

export interface Promocao {
  id: string;
  owner_id: string;
  nome: string;
  descricao: string | null;
  tipo: PromocaoTipo;
  ativo: boolean;
  prioridade: number;
  aplica_automaticamente: boolean;
  necessita_cupom: boolean;
  codigo_cupom: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  dias_semana: number[];
  limite_usos_total: number | null;
  usos_realizados: number;
  limite_por_cliente: number | null;
  condicoes: PromocaoCondicao[];
  acao: PromocaoAcao;
  escopo_produtos: EscopoProdutos;
  criado_em?: string;
  atualizado_em?: string;
}

export interface PromoCartItem {
  produtoId: string;
  categoriaId: string | null;
  nome: string;
  quantidade: number;
  precoUnit: number;
}

export interface PromoClienteCtx {
  id?: string | null;
  telefone?: string | null;
  totalPedidos: number;
  usosPorPromocao?: Record<string, number>;
}

export interface PromoContext {
  tipoEntrega: "delivery" | "retirada";
  subtotal: number;
  taxaEntrega: number;
  formaPagamento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  /** Agora em America/Sao_Paulo — ISO ou Date. */
  agora?: Date;
  itens: PromoCartItem[];
  cliente?: PromoClienteCtx | null;
  /** Código digitado no checkout (campanha com cupom). */
  codigoCupomDigitado?: string | null;
}

export interface PromoItemBonus {
  produtoId: string;
  quantidade: number;
  motivo: string;
}

export interface PromoEffect {
  promocaoId: string;
  nome: string;
  tipo: PromocaoTipo;
  desconto: number;
  freteGratis: boolean;
  descontoFrete: number;
  pontosExtra: number;
  itensBonus: PromoItemBonus[];
  economiaTotal: number;
  resumo: string;
  meta: Record<string, unknown>;
}

export interface AvaliarPromocoesResult {
  aplicada: PromoEffect | null;
  candidatas: string[];
  motivoSemAplicacao?: string;
}

export const emptyEscopo = (): EscopoProdutos => ({
  modo: "todos",
  categoria_ids: [],
  produto_ids: [],
  excluir_produto_ids: [],
});

export const emptyAcaoForTipo = (tipo: PromocaoTipo): PromocaoAcao => {
  switch (tipo) {
    case "desconto_percentual":
    case "cupom":
      return { percentual: 10, cupom_modo: tipo === "cupom" ? "percentual" : undefined };
    case "desconto_fixo":
      return { valor_fixo: 10 };
    case "frete_gratis":
      return { frete: { modo: "gratis" } };
    case "compre_x_leve_y":
      return {
        compre_x_leve_y: {
          produto_id: "",
          qtd_compra: 2,
          produto_bonus_id: "",
          qtd_bonus: 1,
        },
      };
    case "brinde":
      return { brinde: { produto_ids: [], qtd: 1 } };
    case "combo":
      return { combo: { itens: [], preco: 0 } };
    case "desconto_categoria":
      return { desconto_categoria: { categoria_ids: [], percentual: 20 } };
    case "desconto_produto":
      return { desconto_produto: { produto_ids: [], percentual: 15 } };
    case "leve_mais_pague_menos":
      return { leve_mais: { produto_ids: [], categoria_ids: [], faixas: [{ qtd: 2, preco: 50 }] } };
    case "pontos":
      return { pontos: { extra: 10 } };
    default:
      return {};
  }
};
