import { useEffect, useState } from "react";
import { Utensils, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Mesa } from "@/types/db";
import MesaCard from "@/components/mesas/MesaCard";
import AbrirContaDialog from "@/components/mesas/AbrirContaDialog";
import ContaSheet from "@/components/mesas/ContaSheet";
import NovaMesaDialog from "@/components/mesas/NovaMesaDialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Mesas() {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesaAbrir, setMesaAbrir] = useState<Mesa | null>(null);
  const [mesaConta, setMesaConta] = useState<Mesa | null>(null);
  const [showNovaMesa, setShowNovaMesa] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("mesas").select("*").order("numero");
    if (error) toast.error(error.message);
    else setMesas((data || []) as Mesa[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("mesas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "mesas" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleClick = (m: Mesa) => {
    if (m.status === "livre") setMesaAbrir(m);
    else setMesaConta(m);
  };

  const counts = {
    livre: mesas.filter((m) => m.status === "livre").length,
    ocupada: mesas.filter((m) => m.status === "ocupada").length,
    pagamento: mesas.filter((m) => m.status === "aguardando_pagamento").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-foreground flex items-center gap-3">
            <Utensils className="w-8 h-8 text-primary" /> Mesas
          </h1>
          <p className="text-muted-foreground mt-1">Visão em tempo real do salão</p>
        </div>
        <div className="flex gap-3 flex-col sm:flex-row sm:items-center">
          <div className="flex gap-3 text-sm">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-status-livre" />{counts.livre} livres</span>
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-status-ocupada" />{counts.ocupada} ocupadas</span>
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-status-pagamento" />{counts.pagamento} pagamento</span>
          </div>
          <Button onClick={() => setShowNovaMesa(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Nova Mesa
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : mesas.length === 0 ? (
        <div className="text-muted-foreground">Nenhuma mesa cadastrada.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {mesas.map((m) => (
            <MesaCard key={m.id} mesa={m} onClick={() => handleClick(m)} />
          ))}
        </div>
      )}

      <AbrirContaDialog
        mesa={mesaAbrir}
        onClose={() => setMesaAbrir(null)}
        onOpened={() => { const m = mesaAbrir; setMesaAbrir(null); if (m) setMesaConta({ ...m, status: "ocupada" }); }}
        onMesaUpdated={() => load()}
      />
      <ContaSheet 
        mesa={mesaConta} 
        onClose={() => setMesaConta(null)}
        onClosed={() => { setMesaConta(null); load(); }}
      />
      <NovaMesaDialog 
        open={showNovaMesa}
        onClose={() => setShowNovaMesa(false)}
        onCreated={() => load()}
      />
    </div>
  );
}
