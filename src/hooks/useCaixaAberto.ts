import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CaixaAbertoInfo = {
  id: string;
  valor_inicial: number;
  aberto_em: string;
  observacoes: string | null;
};

export function formatCaixaMoneyInput(value: number) {
  return String(value ?? 0).replace(".", ",");
}

export function parseCaixaMoney(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const asNumber = Number(normalized);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

export function useCaixaAberto() {
  const [caixaAberto, setCaixaAberto] = useState<CaixaAbertoInfo | null>(null);
  const [sugestaoValorInicial, setSugestaoValorInicial] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    const [{ data: aberto }, { data: ultimo }] = await Promise.all([
      supabase
        .from("caixas")
        .select("id, valor_inicial, aberto_em, observacoes")
        .eq("status", "aberto")
        .maybeSingle(),
      supabase
        .from("caixas")
        .select("valor_inicial, valor_final, status")
        .order("aberto_em", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    setCaixaAberto((aberto as CaixaAbertoInfo | null) || null);

    if (ultimo) {
      const sugestao =
        ultimo.status === "fechado" && ultimo.valor_final != null
          ? Number(ultimo.valor_final)
          : Number(ultimo.valor_inicial || 0);
      setSugestaoValorInicial(Number.isFinite(sugestao) ? sugestao : null);
    } else {
      setSugestaoValorInicial(null);
    }

    setLoading(false);
    return !!aberto;
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel(`caixa-status-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "caixas" }, () => {
        void refresh();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const openAbrirCaixa = useCallback((afterOpen?: () => void) => {
    pendingActionRef.current = afterOpen ?? null;
    setDialogOpen(true);
  }, []);

  const requireCaixa = useCallback(
    (action: () => void) => {
      void (async () => {
        if (caixaAberto) {
          action();
          return;
        }

        const aberto = await refresh();
        if (aberto) {
          action();
          return;
        }

        pendingActionRef.current = action;
        setDialogOpen(true);
      })();
    },
    [caixaAberto, refresh],
  );

  const closeDialog = useCallback(() => {
    pendingActionRef.current = null;
    setDialogOpen(false);
  }, []);

  const handleOpened = useCallback(async () => {
    await refresh();
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    setDialogOpen(false);
    pending?.();
  }, [refresh]);

  return {
    caixaAberto,
    isAberto: !!caixaAberto,
    loading,
    sugestaoValorInicial,
    refresh,
    requireCaixa,
    openAbrirCaixa,
    dialogOpen,
    closeDialog,
    handleOpened,
  };
}
