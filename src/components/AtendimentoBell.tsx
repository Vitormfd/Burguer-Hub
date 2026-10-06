import { Bell, Check, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  formatTelefone,
  whatsappChatUrl,
  type AtendimentoSolicitacao,
} from "@/hooks/useAtendimentoSolicitacoes";

interface AtendimentoProps {
  pendentes: AtendimentoSolicitacao[];
  marcarAtendido: (id: string) => void;
}

const tempoDesde = (iso: string): string => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
};

/** Sino do topo: clientes do WhatsApp esperando atendimento humano. */
export function AtendimentoBell({ pendentes, marcarAtendido }: AtendimentoProps) {
  const total = pendentes.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={total ? "default" : "ghost"}
          size={total ? "sm" : "icon"}
          className={cn("relative", total > 0 && "bg-red-600 hover:bg-red-700 text-white gap-1.5")}
          aria-label={total ? `${total} cliente(s) aguardando atendimento` : "Atendimentos do WhatsApp"}
        >
          <Bell className={cn("w-5 h-5", total > 0 && "animate-bounce")} />
          {total > 0 && <span className="font-semibold">{total > 9 ? "9+" : total} esperando</span>}
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

/** Faixa fixa no topo de todas as telas enquanto houver cliente esperando atendimento. */
export function AtendimentoBanner({ pendentes, marcarAtendido }: AtendimentoProps) {
  const [primeiro] = pendentes;
  if (!primeiro) return null;
  const outros = pendentes.length - 1;
  const quem = primeiro.cliente_nome || formatTelefone(primeiro.telefone);

  return (
    <div role="alert" className="bg-red-600 text-white px-4 py-3 shadow-md">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
          </span>
          <p className="font-semibold leading-tight">
            💬 {quem} quer falar com um atendente no WhatsApp
            <span className="font-normal opacity-90"> · {tempoDesde(primeiro.criado_em)}</span>
            {outros > 0 && (
              <span className="font-normal opacity-90">
                {" "}+ {outros} {outros === 1 ? "outro cliente" : "outros clientes"} (veja no sino)
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" className="bg-white text-red-700 hover:bg-red-50">
            <a href={whatsappChatUrl(primeiro.telefone)} target="_blank" rel="noreferrer">
              <MessageCircle className="w-4 h-4 mr-1" /> Responder
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-transparent border-white/70 text-white hover:bg-white/15 hover:text-white"
            onClick={() => marcarAtendido(primeiro.id)}
          >
            <Check className="w-4 h-4 mr-1" /> Atendido
          </Button>
        </div>
      </div>
    </div>
  );
}
