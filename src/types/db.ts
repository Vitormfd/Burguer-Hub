export type MesaStatus = "livre" | "ocupada" | "aguardando_pagamento";
export type ContaStatus = "aberta" | "fechada";
export type PedidoTipo = "mesa" | "delivery";
export type TipoEntrega = "delivery" | "retirada";
export type PedidoStatus = "pendente" | "em_preparo" | "pronto" | "entregue" | "cancelado";
export type RecompensaTipo = "item_gratis" | "desconto_percentual" | "desconto_fixo";
export type CupomTipo = "percentual" | "fixo" | "frete_gratis";
export type ResgateStatus = "pendente" | "aplicado" | "cancelado";

export interface Mesa {
  id: string;
  numero: number;
  status: MesaStatus;
}

export interface Categoria {
  id: string;
  nome: string;
  ativo: boolean;
  icone?: string | null;
  destaque?: boolean;
  emoji?: string | null;
}

export interface Produto {
  id: string;
  categoria_id: string | null;
  nome: string;
  descricao: string | null;
  preco: number;
  disponivel: boolean;
  destaque?: boolean;
  imagem_url: string | null;
  promocao?: boolean;
  preco_promocional?: number | null;
}

export interface Conta {
  id: string;
  mesa_id: string | null;
  aberta_em: string;
  fechada_em: string | null;
  status: ContaStatus;
  total: number;
}

export interface Pedido {
  id: string;
  conta_id: string | null;
  cliente_id?: string | null;
  cupom_id?: string | null;
  tipo: PedidoTipo;
  status: PedidoStatus;
  criado_em: string;
  subtotal?: number;
  desconto?: number;
  valor_desconto?: number;
  total?: number;
  recompensa_resgatada_id?: string | null;
  observacoes_internas?: string | null;
  tipo_entrega?: TipoEntrega;
  cancelado_em?: string | null;
  motivo_cancelamento?: string | null;
  cancelado_por?: string | null;
}

export interface PedidoItem {
  id: string;
  pedido_id: string;
  produto_id: string | null;
  quantidade: number;
  preco_unitario: number;
  observacao: string | null;
  cancelado?: boolean;
  cancelado_em?: string | null;
  motivo_cancelamento?: string | null;
}

export interface GrupoAdicional {
  id: string;
  nome: string;
  descricao: string | null;
  obrigatorio: boolean;
  min_escolhas: number;
  max_escolhas: number;
  ordem: number;
  disponivel: boolean;
}

export interface Adicional {
  id: string;
  grupo_id: string;
  nome: string;
  preco: number;
  disponivel: boolean;
  imagem_url: string | null;
  ordem: number;
}

export interface ProdutoGrupoAdicional {
  id: string;
  produto_id: string;
  grupo_id: string;
  ordem: number;
}

export interface PedidoItemAdicional {
  id: string;
  pedido_item_id: string;
  adicional_id: string;
  quantidade: number;
  preco_unitario: number;
}

export interface Configuracao {
  id: string;
  nome_loja: string;
  referencia: string | null;
  logo_url: string | null;
  banner_url: string | null;
  carrossel_imagens: string[];
  cor_primaria: string;
  ativo: boolean;
  hora_abertura: string;
  hora_fechamento: string;
  seo_titulo: string;
  seo_descricao: string;
  tempo_entrega_min?: string;
  retirada_ativa?: boolean;
  tempo_estimado_retirada?: number;
  endereco_estabelecimento?: string | null;
  fidelidade_ativa?: boolean;
  fidelidade_texto?: string;
  fidelidade_cor?: string;
}

export interface Cliente {
  id: string;
  nome: string;
  telefone: string;
  total_pedidos: number;
  pontos: number;
  criado_em: string;
}

export interface Recompensa {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: RecompensaTipo;
  valor: number;
  produto_id: string | null;
  pedidos_necessarios: number;
  ativo: boolean;
  imagem_url: string | null;
  ordem: number;
  criado_em?: string;
}

export interface Cupom {
  id: string;
  codigo: string;
  descricao: string | null;
  tipo: CupomTipo;
  valor: number | null;
  valor_minimo_pedido: number;
  limite_usos_total: number | null;
  usos_realizados: number;
  uso_unico_por_cliente: boolean;
  data_inicio: string | null;
  data_expiracao: string | null;
  ativo: boolean;
  criado_em: string;
}

export interface CupomUso {
  id: string;
  cupom_id: string;
  cliente_id: string | null;
  pedido_id: string;
  telefone_cliente: string | null;
  valor_desconto_aplicado: number;
  usado_em: string;
  cupom?: Cupom;
  cliente?: Cliente | null;
  pedido?: Pedido | null;
}

export interface Resgate {
  id: string;
  cliente_id: string;
  recompensa_id: string;
  pedido_id: string | null;
  resgatado_em: string;
  status: ResgateStatus;
}

export interface ClientePedido {
  id: string;
  cliente_id: string;
  pedido_id: string;
  criado_em?: string;
}

export interface BairroTaxa {
  id: string;
  nome: string;
  taxa: number;
  ativo: boolean;
}
