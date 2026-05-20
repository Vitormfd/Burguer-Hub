import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Utensils, Truck, BookOpen, ChefHat, BarChart3, Flame, LogOut, Settings, ListChecks, Trophy, Wallet, TicketPercent } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { bindAudioUnlock, playNewOrderAlert } from "@/lib/sound";

const items = [
  { title: "Mesas", url: "/mesas", icon: Utensils },
  { title: "Delivery", url: "/delivery", icon: Truck },
  { title: "Cardápio", url: "/admin/cardapio", icon: BookOpen },
  { title: "Adicionais", url: "/admin/adicionais", icon: ListChecks },
  { title: "Fidelidade", url: "/admin/fidelidade", icon: Trophy },
  { title: "Cupons", url: "/admin/cupons", icon: TicketPercent },
  { title: "Financeiro", url: "/admin/financeiro", icon: Wallet },
  { title: "Cozinha", url: "/cozinha", icon: ChefHat },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { signOut, user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [storeName, setStoreName] = useState("Minha loja");
  const previousPendingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user) return;
    bindAudioUnlock();
    let isActive = true;

    const syncPendingCount = async () => {
      const { count } = await supabase
        .from("pedidos")
        .select("id", { head: true, count: "exact" })
        .eq("status", "pendente");

      if (!isActive) return;

      const nextCount = count ?? 0;
      const prevCount = previousPendingRef.current;

      if (prevCount !== null && nextCount > prevCount) {
        playNewOrderAlert();
      }

      previousPendingRef.current = nextCount;
      setPendingCount(nextCount);
    };

    void syncPendingCount();

    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void syncPendingCount();
      }
    }, 15000);

    const channel = supabase
      .channel("sidebar-pedidos-pendentes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pedidos", filter: "status=eq.pendente" },
        () => {
          playNewOrderAlert();
          void syncPendingCount();
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, () => {
        void syncPendingCount();
      })
      .subscribe();

    return () => {
      isActive = false;
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let active = true;

    const loadStoreName = async () => {
      const { data } = await supabase
        .from("configuracoes")
        .select("nome_loja")
        .limit(1)
        .maybeSingle();

      if (active && data?.nome_loja?.trim()) {
        setStoreName(data.nome_loja.trim());
      }
    };

    void loadStoreName();

    return () => {
      active = false;
    };
  }, [user]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 p-2">
          <div className="bg-gradient-primary p-2 rounded-lg shrink-0 shadow-elegant">
            <Flame className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display text-xl text-sidebar-foreground truncate max-w-[150px]">{storeName}</span>
              <span className="text-[10px] text-sidebar-foreground/60 uppercase tracking-wider">Painel</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = pathname === item.url || (item.url === "/mesas" && pathname === "/");
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={active}>
                      <NavLink to={item.url} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                    {item.url === "/cozinha" && pendingCount > 0 && (
                      <SidebarMenuBadge className="bg-destructive text-destructive-foreground rounded-full min-w-5 h-5 px-1.5">
                        {pendingCount}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && user && (
          <p className="text-xs text-sidebar-foreground/60 px-2 truncate">{user.email}</p>
        )}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          onClick={signOut}
          className="text-sidebar-foreground hover:bg-sidebar-accent justify-start"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
