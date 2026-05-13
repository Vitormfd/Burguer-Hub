import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Auth from "./pages/Auth";
import Mesas from "./pages/Mesas";
import Delivery from "./pages/Delivery";
import Cardapio from "./pages/Cardapio";
import AdicionaisAdmin from "./pages/AdicionaisAdmin";
import Cozinha from "./pages/Cozinha";
import Relatorios from "./pages/Relatorios";
import Configuracoes from "./pages/Configuracoes";
import CardapioPublico from "./pages/CardapioPublico";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/:referencia/cardapio" element={<CardapioPublico />} />
            <Route path="/cardapio" element={<CardapioPublico />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/cozinha" element={<Cozinha />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/mesas" replace />} />
              <Route path="/mesas" element={<Mesas />} />
              <Route path="/delivery" element={<Delivery />} />
              <Route path="/admin/cardapio" element={<Cardapio />} />
              <Route path="/admin/adicionais" element={<AdicionaisAdmin />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
