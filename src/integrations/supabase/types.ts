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
          hora_abertura: string
          hora_fechamento: string
          id: string
          logo_url: string | null
          nome_loja: string
          seo_descricao: string
          seo_titulo: string
          tempo_entrega_min: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          banner_url?: string | null
          carrossel_imagens?: string[]
          cor_primaria?: string
          created_at?: string
          hora_abertura?: string
          hora_fechamento?: string
          id?: string
          logo_url?: string | null
          nome_loja?: string
          seo_descricao?: string
          seo_titulo?: string
          tempo_entrega_min?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          banner_url?: string | null
          carrossel_imagens?: string[]
          cor_primaria?: string
          created_at?: string
          hora_abertura?: string
          hora_fechamento?: string
          id?: string
          logo_url?: string | null
          nome_loja?: string
          seo_descricao?: string
          seo_titulo?: string
          tempo_entrega_min?: string
          updated_at?: string
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
          id: string
          observacao: string | null
          pedido_id: string
          preco_unitario: number
          produto_id: string | null
          quantidade: number
        }
        Insert: {
          id?: string
          observacao?: string | null
          pedido_id: string
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
        }
        Update: {
          id?: string
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
          conta_id: string | null
          criado_em: string
          id: string
          status: Database["public"]["Enums"]["pedido_status"]
          tipo: Database["public"]["Enums"]["pedido_tipo"]
        }
        Insert: {
          conta_id?: string | null
          criado_em?: string
          id?: string
          status?: Database["public"]["Enums"]["pedido_status"]
          tipo: Database["public"]["Enums"]["pedido_tipo"]
        }
        Update: {
          conta_id?: string | null
          criado_em?: string
          id?: string
          status?: Database["public"]["Enums"]["pedido_status"]
          tipo?: Database["public"]["Enums"]["pedido_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_conta_id_fkey"
            columns: ["conta_id"]
            isOneToOne: false
            referencedRelation: "contas"
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
      [_ in never]: never
    }
    Enums: {
      conta_status: "aberta" | "fechada"
      entrega_status: "aguardando" | "saiu_para_entrega" | "entregue"
      mesa_status: "livre" | "ocupada" | "aguardando_pagamento"
      pedido_status: "pendente" | "em_preparo" | "pronto" | "entregue"
      pedido_tipo: "mesa" | "delivery"
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
      mesa_status: ["livre", "ocupada", "aguardando_pagamento"],
      pedido_status: ["pendente", "em_preparo", "pronto", "entregue"],
      pedido_tipo: ["mesa", "delivery"],
    },
  },
} as const
