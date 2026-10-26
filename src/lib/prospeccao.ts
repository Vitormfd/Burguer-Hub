// Tipos, rótulos e utilidades do painel de prospecção (as regras do agente ficam em
// supabase/functions/_shared/prospeccao/core.ts).
import { supabase } from "@/integrations/supabase/client";

// Tabelas da prospecção ainda não estão nos tipos gerados do Supabase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sb = supabase as any;

export type StatusProspect =
  | "novo"
  | "qualificado"
  | "contatado"
  | "respondeu"
  | "interessado"
  | "demonstracao"
  | "cliente"
  | "sem_interesse"
  | "nao_contatar"
  | "desqualificado";

export interface Evidencia {
  tipo: string;
  url: string;
  trecho: string;
}

export interface Prospect {
  id: string;
  nome: string;
  categoria: string | null;
  instagram: string | null;
  facebook: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  link_cardapio: string | null;
  sistema: string;
  sistema_confianca: string;
  evidencias: Evidencia[];
  sinais: Record<string, unknown>;
  pontuacao: number;
  pontuacao_detalhes: Record<string, number>;
  prioridade: "alta" | "media" | "baixa";
  publico: string | null;
  status: StatusProspect;
  canal_contato: string | null;
  interesse: string;
  proxima_acao: string | null;
  motivo_desqualificacao: string | null;
  mensagem_sugerida: string | null;
  resumo_conversa: string | null;
  observacoes: string | null;
  valor_concorrente: number | null;
  bloqueado: boolean;
  atendimento_humano: boolean;
  followups: number;
  fonte: string | null;
  consulta_origem: string | null;
  descoberto_em: string;
  verificado_em: string;
  contatado_em: string | null;
  respondeu_em: string | null;
  convertido_em: string | null;
}

export interface Mensagem {
  id: string;
  direcao: "saida" | "entrada";
  canal: string;
  autor: string;
  texto: string;
  intencao: string | null;
  erro: string | null;
  criado_em: string;
}

export const STATUS_LABEL: Record<StatusProspect, string> = {
  novo: "Novo",
  qualificado: "Aguardando contato",
  contatado: "Contatado",
  respondeu: "Respondeu",
  interessado: "Interessado",
  demonstracao: "Demonstração",
  cliente: "Cliente",
  sem_interesse: "Sem interesse",
  nao_contatar: "Não contatar",
  desqualificado: "Desqualificado",
};

export const SISTEMA_LABEL: Record<string, string> = {
  anota_ai: "Anota AI",
  sem_sistema: "Sem sistema",
  concorrente: "Outro sistema",
  sistema_proprio: "Sistema próprio",
  indeterminado: "Indeterminado",
};

export const ESTADO_AGENTE_LABEL: Record<string, string> = {
  pausado: "Pausado",
  ativo: "Ativo",
  executando: "Pesquisando agora",
  aguardando_agenda: "Aguardando o horário",
  tempo_diario_esgotado: "Tempo do dia esgotado",
  limite_gasto_diario: "Limite de gasto diário",
  limite_gasto_mensal: "Limite de gasto mensal",
  limite_buscas_web: "Limite de buscas do dia",
  meta_atingida: "Meta do dia atingida",
  sem_novas_buscas: "Sem novas buscas",
  erro: "Com erro",
};

export const MOTIVO_LABEL: Record<string, string> = {
  rede_ou_franquia: "Rede ou franquia",
  fechado_ou_inativo: "Fechado ou inativo",
  fora_do_perfil: "Fora do perfil",
  ja_e_cliente: "Já usa o Easy Food Hub",
  sem_interesse: "Sem interesse",
  pediu_para_nao_contatar: "Pediu para não contatar",
  nao_contatar: "Não contatar",
  manual: "Desqualificado manualmente",
};

export const statusVariant = (s: StatusProspect): "default" | "secondary" | "destructive" | "outline" =>
  s === "cliente" || s === "interessado" || s === "demonstracao"
    ? "default"
    : s === "sem_interesse" || s === "nao_contatar" || s === "desqualificado"
      ? "destructive"
      : s === "qualificado"
        ? "secondary"
        : "outline";

/** 55 + DDD + número, ou null se não for celular BR. */
export function whatsappDe(tel: string | null | undefined): string | null {
  let d = String(tel ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length === 11 && d[2] === "9" ? `55${d}` : null;
}

export const formatarTelefone = (tel: string | null | undefined): string => {
  const d = String(tel ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel || "";
};

export async function chamarAgente<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { ok?: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke("prospeccao-agente", { body });
  if (error) {
    // Erros HTTP da função chegam aqui; tenta ler a mensagem do corpo.
    const ctx = (error as { context?: Response }).context;
    const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    return { ok: false, error: corpo?.error || error.message } as T & { ok: boolean; error: string };
  }
  return data;
}

const csvCampo = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function prospectsParaCsv(lista: Prospect[]): string {
  const colunas: (keyof Prospect)[] = [
    "nome", "categoria", "cidade", "uf", "bairro", "telefone", "instagram", "facebook", "site", "email", "link_cardapio",
    "sistema", "sistema_confianca", "pontuacao", "prioridade", "status", "canal_contato", "interesse", "proxima_acao",
    "motivo_desqualificacao", "valor_concorrente", "descoberto_em", "verificado_em", "contatado_em", "respondeu_em", "evidencias",
  ];
  const linhas = [colunas.join(";"), ...lista.map((p) => colunas.map((c) => csvCampo(p[c])).join(";"))];
  return "﻿" + linhas.join("\n");
}

export function baixarArquivo(nome: string, conteudo: string, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export const instagramUrl = (h: string | null) => (h ? `https://instagram.com/${h.replace(/^@/, "")}` : null);
