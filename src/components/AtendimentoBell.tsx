import { Bell, Check, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  formatTelefone,
  useAtendimentoSolicitacoes,
  whatsappChatUrl,
} from "@/hooks/useAtendimentoSolicitacoes";

const tempoDesde = (iso: string): string => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
};

/** Sino do topo: clientes do WhatsApp esperando atendimento humano. */
export function AtendimentoBell() {
  const { pendentes, marcarAtendido } = useAtendimentoSolicitacoes(true);
  const total = pendentes.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={total ? `${total} cliente(s) aguardando atendimento` : "Atendimentos do WhatsApp"}
        >
          <Bell className="w-5 h-5" />
          {total > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-semibold flex items-center justify-center animate-pulse">
              {total > 9 ? "9+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="px-4 py-3 border-b">
          <p className="font-medium text-sm">Atendimento no WhatsApp</p>
          <p className="text-xs text-muted-foreground">
            {total ? "Clientes que pediram para falar com alguém" : "Nenhum cliente aguardando"}
          </p>
        </div>
        {total > 0 && (
          <ul className="max-h-80 overflow-y-auto divide-y">
            {pendentes.map((p) => (
              <li key={p.id} className="px-4 py-3 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium truncate">{p.cliente_nome || formatTelefone(p.telefone)}</p>
                  <span className="text-xs text-muted-foreground shrink-0">{tempoDesde(p.criado_em)}</span>
                </div>
                {p.cliente_nome && <p className="text-xs text-muted-foreground">{formatTelefone(p.telefone)}</p>}
                <div className="flex gap-2">
                  <Button asChild size="sm" className="flex-1">
                    <a href={whatsappChatUrl(p.telefone)} target="_blank" rel="noreferrer">
                      <MessageCircle className="w-4 h-4 mr-1" /> Responder
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => marcarAtendido(p.id)}>
                    <Check className="w-4 h-4 mr-1" /> Atendido
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
