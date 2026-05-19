export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bairros_taxas: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          taxa: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          taxa?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          taxa?: number
        }
        Relationships: []
      }
      adicionais: {
        Row: {
          created_at: string
          disponivel: boolean
          grupo_id: string
          id: string
          imagem_url: string | null
          nome: string
          ordem: number
          preco: number
        }
        Insert: {
          created_at?: string
          disponivel?: boolean
          grupo_id: string
          id?: string
          imagem_url?: string | null
          nome: string
          ordem?: number
          preco?: number
        }
        Update: {
          created_at?: string
          disponivel?: boolean
          grupo_id?: string
          id?: string
          imagem_url?: string | null
          nome?: string
          ordem?: number
          preco?: number
        }
        Relationships: [
          {
            foreignKeyName: "adicionais_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_adicionais"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias: {
        Row: {
          ativo: boolean
          created_at: string
          destaque: boolean
          emoji: string | null
          icone: string | null
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          destaque?: boolean
          emoji?: string | null
          icone?: string | null
          id?: string
          nome: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          destaque?: boolean
          emoji?: string | null
          icone?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      configuracoes: {
        Row: {
          ativo: boolean
          banner_url: string | null
          carrossel_imagens: string[]
          cor_primaria: string
          created_at: string
          fidelidade_ativa: boolean
          fidelidade_cor: string
          fidelidade_texto: string
          hora_abertura: string
          hora_fechamento: string
          horario_funcionamento: Json
          id: string
          logo_url: string | null
          nome_loja: string
          referencia: string | null
          endereco_estabelecimento: string | null
          retirada_ativa: boolean
          seo_descricao: string
          seo_titulo: string
          tempo_estimado_retirada: number
          tempo_entrega_min: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          banner_url?: string | null
          carrossel_imagens?: string[]
          cor_primaria?: string
          created_at?: string
          fidelidade_ativa?: boolean
          fidelidade_cor?: string
          fidelidade_texto?: string
          hora_abertura?: string
          hora_fechamento?: string
          horario_funcionamento?: Json
          id?: string
          logo_url?: string | null
          nome_loja?: string
          referencia?: string | null
          retirada_ativa?: boolean
          endereco_estabelecimento?: string | null
          seo_descricao?: string
          seo_titulo?: string
          tempo_estimado_retirada?: number
          tempo_entrega_min?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          banner_url?: string | null
          carrossel_imagens?: string[]
          cor_primaria?: string
          created_at?: string
          fidelidade_ativa?: boolean
          fidelidade_cor?: string
          fidelidade_texto?: string
          hora_abertura?: string
          hora_fechamento?: string
          horario_funcionamento?: Json
          id?: string
          logo_url?: string | null
          nome_loja?: string
          referencia?: string | null
          retirada_ativa?: boolean
          endereco_estabelecimento?: string | null
          seo_descricao?: string
          seo_titulo?: string
          tempo_estimado_retirada?: number
          tempo_entrega_min?: string
          updated_at?: string
        }
        Relationships: []
      }
      cliente_pedidos: {
        Row: {
          cliente_id: string
          criado_em: string
          id: string
          pedido_id: string
        }
        Insert: {
          cliente_id: string
          criado_em?: string
          id?: string
          pedido_id: string
        }
        Update: {
          cliente_id?: string
          criado_em?: string
          id?: string
          pedido_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_pedidos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_pedidos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      cupom_usos: {
        Row: {
          cliente_id: string | null
          cupom_id: string
          id: string
          pedido_id: string
          telefone_cliente: string | null
          usado_em: string
          valor_desconto_aplicado: number
        }
        Insert: {
          cliente_id?: string | null
          cupom_id: string
          id?: string
          pedido_id: string
          telefone_cliente?: string | null
          usado_em?: string
          valor_desconto_aplicado?: number
        }
        Update: {
          cliente_id?: string | null
          cupom_id?: string
          id?: string
          pedido_id?: string
          telefone_cliente?: string | null
          usado_em?: string
          valor_desconto_aplicado?: number
        }
        Relationships: [
          {
            foreignKeyName: "cupom_usos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cupom_usos_cupom_id_fkey"
            columns: ["cupom_id"]
            isOneToOne: false
            referencedRelation: "cupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cupom_usos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          criado_em: string
          id: string
          nome: string
          pontos: number
          telefone: string
          total_pedidos: number
        }
        Insert: {
      cupons: {
        Row: {
          ativo: boolean
          codigo: string
          criado_em: string
          data_expiracao: string | null
          data_inicio: string | null
          descricao: string | null
          id: string
          limite_usos_total: number | null
          tipo: Database["public"]["Enums"]["cupom_tipo"]
          uso_unico_por_cliente: boolean
          usos_realizados: number
          valor: number | null
          valor_minimo_pedido: number
        }
        Insert: {
          ativo?: boolean
          codigo: string
          criado_em?: string
          data_expiracao?: string | null
          data_inicio?: string | null
          descricao?: string | null
          id?: string
          limite_usos_total?: number | null
          tipo: Database["public"]["Enums"]["cupom_tipo"]
          uso_unico_por_cliente?: boolean
          usos_realizados?: number
          valor?: number | null
          valor_minimo_pedido?: number
        }
        Update: {
          ativo?: boolean
          codigo?: string
          criado_em?: string
          data_expiracao?: string | null
          data_inicio?: string | null
          descricao?: string | null
          id?: string
          limite_usos_total?: number | null
          tipo?: Database["public"]["Enums"]["cupom_tipo"]
          uso_unico_por_cliente?: boolean
          usos_realizados?: number
          valor?: number | null
          valor_minimo_pedido?: number
        }
        Relationships: []
      }
          criado_em?: string
          id?: string
          nome: string
          pontos?: number
          telefone: string
          total_pedidos?: number
        }
        Update: {
          criado_em?: string
          id?: string
          nome?: string
          pontos?: number
          telefone?: string
          total_pedidos?: number
        }
        Relationships: []
      }
      contas: {
        Row: {
          aberta_em: string
          fechada_em: string | null
          id: string
          mesa_id: string | null
          status: Database["public"]["Enums"]["conta_status"]
          total: number
        }
        Insert: {
          aberta_em?: string
          fechada_em?: string | null
          id?: string
          mesa_id?: string | null
          status?: Database["public"]["Enums"]["conta_status"]
          total?: number
        }
        Update: {
          aberta_em?: string
          fechada_em?: string | null
          id?: string
          mesa_id?: string | null
          status?: Database["public"]["Enums"]["conta_status"]
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "contas_mesa_id_fkey"
            columns: ["mesa_id"]
            isOneToOne: false
            referencedRelation: "mesas"
            referencedColumns: ["id"]
          },
        ]
      }
      entregas: {
        Row: {
          bairro: string | null
          cliente_nome: string
          cliente_telefone: string
          complemento: string | null
          endereco: string
          forma_pagamento: string | null
          id: string
          numero: string | null
          origem: string
          pedido_id: string
          status: Database["public"]["Enums"]["entrega_status"]
          taxa_entrega: number
          troco_para: number | null
        }
        Insert: {
          bairro?: string | null
          cliente_nome: string
          cliente_telefone: string
          complemento?: string | null
          endereco: string
          forma_pagamento?: string | null
          id?: string
          numero?: string | null
          origem?: string
          pedido_id: string
          status?: Database["public"]["Enums"]["entrega_status"]
          taxa_entrega?: number
          troco_para?: number | null
        }
        Update: {
          bairro?: string | null
          cliente_nome?: string
          cliente_telefone?: string
          complemento?: string | null
          endereco?: string
          forma_pagamento?: string | null
          id?: string
          numero?: string | null
          origem?: string
          pedido_id?: string
          status?: Database["public"]["Enums"]["entrega_status"]
          taxa_entrega?: number
          troco_para?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "entregas_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_adicionais: {
        Row: {
          created_at: string
          descricao: string | null
          disponivel: boolean
          id: string
          max_escolhas: number
          min_escolhas: number
          nome: string
          obrigatorio: boolean
          ordem: number
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          disponivel?: boolean
          id?: string
          max_escolhas?: number
          min_escolhas?: number
          nome: string
          obrigatorio?: boolean
          ordem?: number
        }
        Update: {
          created_at?: string
          descricao?: string | null
          disponivel?: boolean
          id?: string
          max_escolhas?: number
          min_escolhas?: number
          nome?: string
          obrigatorio?: boolean
          ordem?: number
        }
        Relationships: []
      }
      mesas: {
        Row: {
          created_at: string
          id: string
          numero: number
          status: Database["public"]["Enums"]["mesa_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          numero: number
          status?: Database["public"]["Enums"]["mesa_status"]
        }
        Update: {
          created_at?: string
          id?: string
          numero?: number
          status?: Database["public"]["Enums"]["mesa_status"]
        }
        Relationships: []
      }
      pedido_item_adicionais: {
        Row: {
          adicional_id: string
          created_at: string
          id: string
          pedido_item_id: string
          preco_unitario: number
          quantidade: number
        }
        Insert: {
          adicional_id: string
          created_at?: string
          id?: string
          pedido_item_id: string
          preco_unitario?: number
          quantidade?: number
        }
        Update: {
          adicional_id?: string
          created_at?: string
          id?: string
          pedido_item_id?: string
          preco_unitario?: number
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedido_item_adicionais_adicional_id_fkey"
            columns: ["adicional_id"]
            isOneToOne: false
            referencedRelation: "adicionais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_item_adicionais_pedido_item_id_fkey"
            columns: ["pedido_item_id"]
            isOneToOne: false
            referencedRelation: "pedido_itens"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_itens: {
        Row: {
          cancelado: boolean
          cancelado_em: string | null
          id: string
          motivo_cancelamento: string | null
          observacao: string | null
          pedido_id: string
          preco_unitario: number
          produto_id: string | null
          quantidade: number
        }
        Insert: {
          cancelado?: boolean
          cancelado_em?: string | null
          id?: string
          motivo_cancelamento?: string | null
          observacao?: string | null
          pedido_id: string
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
        }
        Update: {
          cancelado?: boolean
          cancelado_em?: string | null
          id?: string
          motivo_cancelamento?: string | null
          observacao?: string | null
          pedido_id?: string
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedido_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          cancelado_em: string | null
          cancelado_por: string | null
          cliente_id: string | null
          conta_id: string | null
          cupom_id: string | null
          criado_em: string
          desconto: number
          id: string
          motivo_cancelamento: string | null
          observacoes_internas: string | null
          recompensa_resgatada_id: string | null
          status: Database["public"]["Enums"]["pedido_status"]
          subtotal: number
          tipo_entrega: Database["public"]["Enums"]["tipo_entrega"]
          valor_desconto: number
          total: number
          tipo: Database["public"]["Enums"]["pedido_tipo"]
        }
        Insert: {
          cancelado_em?: string | null
          cancelado_por?: string | null
          cliente_id?: string | null
          conta_id?: string | null
          cupom_id?: string | null
          criado_em?: string
          desconto?: number
          id?: string
          motivo_cancelamento?: string | null
          observacoes_internas?: string | null
          recompensa_resgatada_id?: string | null
          status?: Database["public"]["Enums"]["pedido_status"]
          subtotal?: number
          tipo_entrega?: Database["public"]["Enums"]["tipo_entrega"]
          valor_desconto?: number
          total?: number
          tipo: Database["public"]["Enums"]["pedido_tipo"]
        }
        Update: {
          cancelado_em?: string | null
          cancelado_por?: string | null
          cliente_id?: string | null
          conta_id?: string | null
          cupom_id?: string | null
          criado_em?: string
          desconto?: number
          id?: string
          motivo_cancelamento?: string | null
          observacoes_internas?: string | null
          recompensa_resgatada_id?: string | null
          status?: Database["public"]["Enums"]["pedido_status"]
          subtotal?: number
          tipo_entrega?: Database["public"]["Enums"]["tipo_entrega"]
          valor_desconto?: number
          total?: number
          tipo?: Database["public"]["Enums"]["pedido_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "contas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_recompensa_resgatada_id_fkey"
            columns: ["recompensa_resgatada_id"]
            isOneToOne: false
            referencedRelation: "resgates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_cupom_id_fkey"
            columns: ["cupom_id"]
            isOneToOne: false
            referencedRelation: "cupons"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_grupos_adicionais: {
        Row: {
          created_at: string
          grupo_id: string
          id: string
          ordem: number
          produto_id: string
        }
        Insert: {
          created_at?: string
          grupo_id: string
          id?: string
          ordem?: number
          produto_id: string
        }
        Update: {
          created_at?: string
          grupo_id?: string
          id?: string
          ordem?: number
          produto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_grupos_adicionais_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_adicionais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_grupos_adicionais_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          categoria_id: string | null
          created_at: string
          destaque: boolean
          descricao: string | null
          disponivel: boolean
          id: string
          imagem_url: string | null
          nome: string
          preco: number
          preco_promocional: number | null
          promocao: boolean
        }
        Insert: {
          categoria_id?: string | null
          created_at?: string
          destaque?: boolean
          descricao?: string | null
          disponivel?: boolean
          id?: string
          imagem_url?: string | null
          nome: string
          preco?: number
          preco_promocional?: number | null
          promocao?: boolean
        }
        Update: {
          categoria_id?: string | null
          created_at?: string
          destaque?: boolean
          descricao?: string | null
          disponivel?: boolean
          id?: string
          imagem_url?: string | null
          nome?: string
          preco?: number
          preco_promocional?: number | null
          promocao?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      recompensas: {
        Row: {
          ativo: boolean
          criado_em: string
          descricao: string | null
          id: string
          imagem_url: string | null
          nome: string
          ordem: number
          pedidos_necessarios: number
          produto_id: string | null
          tipo: Database["public"]["Enums"]["recompensa_tipo"]
          valor: number
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          nome: string
          ordem?: number
          pedidos_necessarios: number
          produto_id?: string | null
          tipo: Database["public"]["Enums"]["recompensa_tipo"]
          valor?: number
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          nome?: string
          ordem?: number
          pedidos_necessarios?: number
          produto_id?: string | null
          tipo?: Database["public"]["Enums"]["recompensa_tipo"]
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "recompensas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      resgates: {
        Row: {
          cliente_id: string
          id: string
          pedido_id: string | null
          recompensa_id: string
          resgatado_em: string
          status: Database["public"]["Enums"]["resgate_status"]
        }
        Insert: {
          cliente_id: string
          id?: string
          pedido_id?: string | null
          recompensa_id: string
          resgatado_em?: string
          status?: Database["public"]["Enums"]["resgate_status"]
        }
        Update: {
          cliente_id?: string
          id?: string
          pedido_id?: string | null
          recompensa_id?: string
          resgatado_em?: string
          status?: Database["public"]["Enums"]["resgate_status"]
        }
        Relationships: [
          {
            foreignKeyName: "resgates_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resgates_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resgates_recompensa_id_fkey"
            columns: ["recompensa_id"]
            isOneToOne: false
            referencedRelation: "recompensas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          nome?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_cliente_fidelidade: {
        Args: {
          p_telefone: string
        }
        Returns: Json
      }
      get_cliente_fidelidade_detalhe: {
        Args: {
          p_cliente_id: string
        }
        Returns: Json
      }
      list_clientes_fidelidade: {
        Args: {
          search_term?: string | null
        }
        Returns: {
          id: string
          nome: string
          telefone: string
          total_pedidos: number
          pontos: number
          resgates_realizados: number
          ultimo_pedido: string | null
        }[]
      }
      register_cliente_pedido: {
        Args: {
          p_nome: string
          p_pedido_id: string
          p_telefone: string
        }
        Returns: string | null
      }
    }
    Enums: {
      conta_status: "aberta" | "fechada"
      entrega_status: "aguardando" | "saiu_para_entrega" | "entregue"
      cupom_tipo: "percentual" | "fixo" | "frete_gratis"
      mesa_status: "livre" | "ocupada" | "aguardando_pagamento"
      pedido_status: "pendente" | "em_preparo" | "pronto" | "entregue" | "cancelado"
      pedido_tipo: "mesa" | "delivery"
      tipo_entrega: "delivery" | "retirada"
      recompensa_tipo: "item_gratis" | "desconto_percentual" | "desconto_fixo"
      resgate_status: "pendente" | "aplicado" | "cancelado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      conta_status: ["aberta", "fechada"],
      entrega_status: ["aguardando", "saiu_para_entrega", "entregue"],
      cupom_tipo: ["percentual", "fixo", "frete_gratis"],
      mesa_status: ["livre", "ocupada", "aguardando_pagamento"],
      pedido_status: ["pendente", "em_preparo", "pronto", "entregue", "cancelado"],
      pedido_tipo: ["mesa", "delivery"],
      tipo_entrega: ["delivery", "retirada"],
      recompensa_tipo: ["item_gratis", "desconto_percentual", "desconto_fixo"],
      resgate_status: ["pendente", "aplicado", "cancelado"],
    },
  },
} as const
