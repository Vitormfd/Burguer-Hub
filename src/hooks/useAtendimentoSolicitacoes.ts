import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playNewOrderAlert, showNewOrderDesktopNotification } from "@/lib/sound";

// Tabela nova ainda não está nos tipos gerados do Supabase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface AtendimentoSolicitacao {
  id: string;
  telefone: string;
  cliente_nome: string | null;
  status: "pendente" | "atendido";
  criado_em: string;
}

/** Link para abrir a conversa com o cliente no WhatsApp da loja. */
export const whatsappChatUrl = (telefone: string): string => {
  const digits = telefone.replace(/\D/g, "");
  return `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}`;
};

export const formatTelefone = (telefone: string): string => {
  const d = telefone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return telefone;
};

/** Clientes que pediram atendente no robô do WhatsApp (tempo real, com som e notificação). */
export function useAtendimentoSolicitacoes(enabled: boolean) {
  const [pendentes, setPendentes] = useState<AtendimentoSolicitacao[]>([]);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("atendimento_solicitacoes")
      .select("id, telefone, cliente_nome, status, criado_em")
      .eq("status", "pendente")
      .order("criado_em", { ascending: false })
      .limit(50);
    setPendentes((data as AtendimentoSolicitacao[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();

    const channel = supabase
      .channel("atendimento-solicitacoes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "atendimento_solicitacoes" },
        (payload) => {
          const row = payload.new as Partial<AtendimentoSolicitacao> | undefined;
          if (row?.status === "pendente" && payload.eventType !== "DELETE") {
            const quem = row.cliente_nome || formatTelefone(row.telefone ?? "");
            void playNewOrderAlert(true);
            showNewOrderDesktopNotification(`${quem} quer falar com um atendente no WhatsApp`, "easy-food-hub-atendimento");
            toast.info(`💬 ${quem} quer falar com um atendente`, {
              duration: 15000,
              action: row.telefone
                ? { label: "Abrir WhatsApp", onClick: () => window.open(whatsappChatUrl(row.telefone!), "_blank") }
                : undefined,
            });
          }
          void load();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, load]);

  const marcarAtendido = useCallback(async (id: string) => {
    setPendentes((cur) => cur.filter((p) => p.id !== id));
    const { error } = await sb
      .from("atendimento_solicitacoes")
      .update({ status: "atendido", atendido_em: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      void load();
    }
  }, [load]);

  return { pendentes, marcarAtendido };
}
