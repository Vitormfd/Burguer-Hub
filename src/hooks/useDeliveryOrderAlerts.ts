import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  initOrderAlertAudio,
  showNewOrderDesktopNotification,
  stopOrderAlertLoop,
  syncOrderAlertLoop,
} from "@/lib/sound";

/** Alertas de novo pedido delivery em qualquer página do painel (som + notificação do SO). */
export function useDeliveryOrderAlerts(enabled: boolean) {
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  const previousPendingRef = useRef<number | null>(null);

  pathnameRef.current = pathname;

  useEffect(() => {
    if (!enabled) return;
    initOrderAlertAudio();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    let isActive = true;

    const syncAndAlert = async (notifyOnIncrease = false) => {
      const { count } = await supabase
        .from("pedidos")
        .select("id", { head: true, count: "exact" })
        .eq("tipo", "delivery")
        .eq("status", "pendente");

      if (!isActive) return;

      const next = count ?? 0;
      const prev = previousPendingRef.current;

      if (notifyOnIncrease && prev !== null && next > prev) {
        showNewOrderDesktopNotification("Novo pedido de delivery");
        if (pathnameRef.current === "/delivery") {
          toast.success("Novo pedido de delivery");
        }
      }

      syncOrderAlertLoop(next);
      previousPendingRef.current = next;
    };

    void syncAndAlert(false);

    const poll = window.setInterval(() => {
      void syncAndAlert(true);
    }, 15000);

    const channel = supabase
      .channel("global-delivery-order-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pedidos", filter: "tipo=eq.delivery" },
        () => {
          showNewOrderDesktopNotification("Novo pedido de delivery");
          if (pathnameRef.current === "/delivery") {
            toast.success("Novo pedido de delivery");
          }
          void syncAndAlert(false);
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: "tipo=eq.delivery" }, () => {
        void syncAndAlert(false);
      })
      .subscribe();

    return () => {
      isActive = false;
      stopOrderAlertLoop();
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
