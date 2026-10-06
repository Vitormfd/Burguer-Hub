import { Outlet, Navigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AtendimentoBanner, AtendimentoBell } from "./AtendimentoBell";
import { useAuth } from "@/hooks/useAuth";
import { useDeliveryOrderAlerts } from "@/hooks/useDeliveryOrderAlerts";
import { useAtendimentoSolicitacoes } from "@/hooks/useAtendimentoSolicitacoes";

export default function AppLayout() {
  const { session, loading } = useAuth();
  useDeliveryOrderAlerts(!!session);
  const atendimento = useAtendimentoSolicitacoes(!!session);

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
            <AtendimentoBanner {...atendimento} />
          </div>
          <main className="flex-1 p-6 md:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
