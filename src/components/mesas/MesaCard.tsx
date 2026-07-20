import { Mesa, MesaStatus, ModalidadeConsumo } from "@/types/db";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const statusConfig: Record<MesaStatus, { label: string; dot: string; ring: string; bg: string }> = {
  livre: {
    label: "Livre",
    dot: "bg-status-livre",
    ring: "hover:ring-status-livre/40",
    bg: "from-status-livre/10 to-transparent",
  },
  ocupada: {
    label: "Ocupada",
    dot: "bg-status-ocupada",
    ring: "hover:ring-status-ocupada/40",
    bg: "from-status-ocupada/10 to-transparent",
  },
  aguardando_pagamento: {
    label: "Aguard. pagamento",
    dot: "bg-status-pagamento",
    ring: "hover:ring-status-pagamento/40",
    bg: "from-status-pagamento/15 to-transparent",
  },
};

const modalidadeLabel: Record<ModalidadeConsumo, string> = {
  local: "Consumir no local",
  levar: "Levar",
};

export default function MesaCard({
  mesa,
  modalidade,
  nome,
  onClick,
}: {
  mesa: Mesa;
  modalidade?: ModalidadeConsumo | null;
  nome?: string | null;
  onClick: () => void;
}) {
  const cfg = statusConfig[mesa.status];
  const showModalidade = mesa.status !== "livre" && modalidade;
  const showNome = mesa.status !== "livre" && !!nome?.trim();

  return (
    <button onClick={onClick} className="text-left group">
      <Card
        className={cn(
          "relative overflow-hidden p-6 aspect-square flex flex-col justify-between transition-all duration-300 cursor-pointer",
          "hover:-translate-y-1 hover:shadow-elegant ring-1 ring-transparent",
          cfg.ring
        )}
      >
        <div className={cn("absolute inset-0 bg-gradient-to-br opacity-60", cfg.bg)} />
        <div className="relative flex justify-between items-start">
          <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Mesa</span>
          <span className={cn("h-3 w-3 rounded-full shadow-sm animate-pulse", cfg.dot)} />
        </div>
        <div className="relative min-w-0">
          <div className="font-display text-6xl text-foreground leading-none">
            {String(mesa.numero).padStart(2, "0")}
          </div>
          {showNome && (
            <div className="mt-2 text-sm font-semibold text-foreground truncate" title={nome!.trim()}>
              {nome!.trim()}
            </div>
          )}
          <div className={cn("text-sm font-medium text-foreground/80", showNome ? "mt-0.5" : "mt-2")}>
            {cfg.label}
          </div>
          {showModalidade && (
            <div className="mt-1 text-xs font-semibold text-primary">
              {modalidadeLabel[modalidade]}
            </div>
          )}
        </div>
      </Card>
    </button>
  );
}
