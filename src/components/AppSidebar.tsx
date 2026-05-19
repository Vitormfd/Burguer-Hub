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
  const previousPendingRef = useRef<number | null>(null);

  const playNewOrderSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 0.06;
      master.connect(ctx.destination);

      const makeBeep = (frequency: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.9, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + duration);
      };

      const now = ctx.currentTime;
      makeBeep(880, now, 0.13);
      makeBeep(1046, now + 0.17, 0.16);

      setTimeout(() => {
        void ctx.close();
      }, 800);
    } catch {
      // Silencioso: em alguns navegadores autoplay pode bloquear áudio.
    }
  };

  useEffect(() => {
    if (!user) return;

    const syncPendingCount = async () => {
      const { count } = await supabase
        .from("pedidos")
        .select("id", { head: true, count: "exact" })
        .eq("status", "pendente");

      const nextCount = count ?? 0;
      const prevCount = previousPendingRef.current;

      if (prevCount !== null && nextCount > prevCount) {
        playNewOrderSound();
      }

      previousPendingRef.current = nextCount;
      setPendingCount(nextCount);
    };

    void syncPendingCount();

    const channel = supabase
      .channel("sidebar-pedidos-pendentes")
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, () => {
        void syncPendingCount();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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
              <span className="font-display text-xl text-sidebar-foreground">BURGER OS</span>
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
