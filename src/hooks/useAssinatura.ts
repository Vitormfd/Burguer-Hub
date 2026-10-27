import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { MinhaAssinatura } from "@/lib/assinatura";

/**
 * Situação da assinatura da conta logada. Volta a consultar quando a aba ganha foco
 * (a pessoa paga na Stripe em outra aba e volta) e, logo após o retorno do pagamento
 * (?assinatura=ok), a cada 5 s por até 2 minutos, até o webhook liberar a conta.
 */
export function useAssinatura(ativo: boolean) {
  const [assinatura, setAssinatura] = useState<MinhaAssinatura | null>(null);

  const carregar = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- função ainda fora dos tipos gerados
    const { data, error } = await (supabase as any).rpc("minha_assinatura");
    // Antes da migration existir (ou erro de rede) não trava ninguém.
    if (error) return setAssinatura({ liberada: true, liberado_manual: false, status: null, periodo_fim: null, cancela_no_fim: false });
    setAssinatura(data as MinhaAssinatura);
  }, []);

  useEffect(() => {
    if (!ativo) return;
    void carregar();
    const onFocus = () => void carregar();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ativo, carregar]);

  const voltouDoPagamento = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("assinatura") === "ok";
  useEffect(() => {
    if (!ativo || !voltouDoPagamento || assinatura?.liberada) return;
    const inicio = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - inicio > 120_000) return window.clearInterval(t);
      void carregar();
    }, 5000);
    return () => window.clearInterval(t);
  }, [ativo, voltouDoPagamento, assinatura?.liberada, carregar]);

  return { assinatura, recarregar: carregar, aguardandoPagamento: voltouDoPagamento && assinatura?.liberada === false };
}
