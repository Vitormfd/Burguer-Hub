import { useEffect } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AtendimentoBanner, AtendimentoBell } from "./AtendimentoBell";
import { useAuth } from "@/hooks/useAuth";
import { useDeliveryOrderAlerts } from "@/hooks/useDeliveryOrderAlerts";
import { useAtendimentoSolicitacoes } from "@/hooks/useAtendimentoSolicitacoes";
import { useAssinatura } from "@/hooks/useAssinatura";
import { AssinaturaBanner } from "./AssinaturaBanner";
import { PrimeirosPassos } from "./PrimeirosPassos";
import { VALOR_ASSINATURA } from "@/lib/assinatura";
import { registrarEventoUnico } from "@/lib/metaPixel";

export default function AppLayout() {
  const { session, loading } = useAuth();
  useDeliveryOrderAlerts(!!session);
  const atendimento = useAtendimentoSolicitacoes(!!session);
  const { assinatura, aguardandoPagamento, pagamentoConfirmado } = useAssinatura(!!session);
  const contaId = session?.user.id;

  // Assinatura confirmada pelo webhook, não pelo simples retorno da Stripe.
  useEffect(() => {
    if (!pagamentoConfirmado || !contaId) return;
    registrarEventoUnico("Subscribe", contaId, { value: VALOR_ASSINATURA, currency: "BRL" });
    const url = new URL(window.location.href);
    url.searchParams.delete("assinatura");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [pagamentoConfirmado, contaId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse font-display text-2xl text-primary">Carregando...</div>
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" replace />;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 flex items-center border-b bg-card px-4 shadow-soft">
            <SidebarTrigger />
            <div className="ml-auto">
              <AtendimentoBell {...atendimento} />
            </div>
          </header>
          <div className="sticky top-0 z-30">
            <AssinaturaBanner assinatura={assinatura} aguardandoPagamento={aguardandoPagamento} />
            <AtendimentoBanner {...atendimento} />
          </div>
          <main className="flex-1 p-6 md:p-8">
            {contaId && assinatura?.em_teste && !assinatura.paga && !assinatura.liberado_manual && (
              <PrimeirosPassos contaId={contaId} />
            )}
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
