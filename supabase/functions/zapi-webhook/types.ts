export type Etapa =
  | "inicio"
  | "menu_categoria"
  | "menu_produto"
  | "produto_quantidade"
  | "produto_adicional"
  | "produto_observacao"
  | "carrinho"
  | "tipo_entrega"
  | "cliente_nome"
  | "cliente_endereco"
  | "cliente_numero"
  | "cliente_complemento"
  | "cliente_bairro"
  | "forma_pagamento"
  | "troco"
  | "confirmacao"
  | "finalizado";

export interface CartAdicionalWa {
  adicional_id: string;
  nome: string;
  quantidade: number;
  preco_unitario: number;
}

export interface CartItemWa {
  id: string;
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao?: string;
  adicionais: CartAdicionalWa[];
}

export interface GrupoAdicionalWa {
  id: string;
  nome: string;
  obrigatorio: boolean;
  min_escolhas: number;
  max_escolhas: number;
  adicionais: { id: string; nome: string; preco: number; disponivel: boolean }[];
}

export interface ProdutoTempWa {
  produto_id: string;
  nome: string;
  preco: number;
  quantidade: number;
  adicionais: CartAdicionalWa[];
  grupo_index: number;
  grupos: GrupoAdicionalWa[];
  categoria_id: string;
  categoria_nome: string;
  fallback_all_groups: boolean;
}

export interface ClienteTempWa {
  nome?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro_id?: string;
  bairro_nome?: string;
}

export interface SessionDados {
  /** true quando o cliente iniciou o fluxo de pedido (menu/pedido) */
  bot_ativo?: boolean;
  carrinho: CartItemWa[];
  produto_temp?: ProdutoTempWa;
  cliente?: ClienteTempWa;
  tipo_entrega?: "delivery" | "retirada";
  forma_pagamento?: string;
  troco_para?: number;
  sender_name?: string;
  categoria_id?: string;
  categoria_nome?: string;
  pagina_produtos?: number;
}

export interface WhatsappSession {
  id: string;
  owner_id: string;
  telefone: string;
  etapa: Etapa;
  dados: SessionDados;
  ultimo_message_id: string | null;
  atualizado_em: string;
}

export interface LojaConfig {
  id: string;
  owner_id: string;
  nome_loja: string;
  referencia?: string | null;
  site_url?: string | null;
  zapi_instance_id: string;
  zapi_token: string;
  zapi_client_token: string;
  zapi_ativo: boolean;
  whatsapp_pedido_ativo: boolean;
  whatsapp_msg_boas_vindas: string;
  tempo_entrega_min?: string;
  retirada_ativa?: boolean;
  hora_abertura?: string;
  hora_fechamento?: string;
  horario_funcionamento?: unknown;
  endereco_estabelecimento?: string | null;
}

export interface ZapiIncomingMessage {
  instanceId?: string;
  messageId?: string;
  phone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  senderName?: string;
  text?: { message?: string };
  listResponseMessage?: {
    selectedRowId?: string;
    title?: string;
    message?: string;
  };
  buttonsResponseMessage?: {
    buttonId?: string;
    message?: string;
  };
}

export interface OutboundMessage {
  text: string;
  optionList?: {
    title: string;
    buttonLabel: string;
    options: { id: string; title: string; description: string }[];
  };
}
