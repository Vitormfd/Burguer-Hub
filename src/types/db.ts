export type MesaStatus = "livre" | "ocupada" | "aguardando_pagamento";
export type ContaStatus = "aberta" | "fechada";
export type PedidoTipo = "mesa" | "delivery";
export type PedidoStatus = "pendente" | "em_preparo" | "pronto" | "entregue";

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
}

export interface Produto {
  id: string;
  categoria_id: string | null;
  nome: string;
  descricao: string | null;
  preco: number;
  disponivel: boolean;
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
  tipo: PedidoTipo;
  status: PedidoStatus;
  criado_em: string;
}

export interface PedidoItem {
  id: string;
  pedido_id: string;
  produto_id: string | null;
  quantidade: number;
  preco_unitario: number;
  observacao: string | null;
}

export interface Configuracao {
  id: string;
  nome_loja: string;
  logo_url: string | null;
  banner_url: string | null;
  cor_primaria: string;
  ativo: boolean;
  hora_abertura: string;
  hora_fechamento: string;
  seo_titulo: string;
  seo_descricao: string;
  tempo_entrega_min?: string;
}

export interface BairroTaxa {
  id: string;
  nome: string;
  taxa: number;
  ativo: boolean;
}
