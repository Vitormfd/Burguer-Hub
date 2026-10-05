import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bike, CheckCircle2, ChefHat, ClipboardCheck, Star, Store, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { brl } from "@/lib/format";
import { buildCardapioUrl } from "@/lib/publicAppUrl";
import { cn } from "@/lib/utils";

interface PedidoPublico {
  id: string;
  codigo: string;
  status: "pendente" | "em_preparo" | "pronto" | "entregue" | "cancelado";
  entrega_status: "aguardando" | "saiu_para_entrega" | "entregue" | null;
  tipo_entrega: "delivery" | "retirada";
  criado_em: string;
  cliente_nome: string;
  itens: { nome: string; quantidade: number; total: number; cancelado: boolean; adicionais: string[] }[];
  subtotal: number | null;
  taxa_entrega: number | null;
  total: number | null;
  forma_pagamento: string | null;
  pago: boolean;
  avaliacao: { nota: number; comentario: string | null } | null;
  loja: {
    nome: string | null;
    logo_url: string | null;
    cor_primaria: string | null;
    referencia: string | null;
    tempo_entrega: string | null;
    tempo_retirada: number | null;
    endereco: string | null;
    avaliacao_ativa: boolean;
  };
}

const POLL_MS = 15000;

function etapaAtual(p: PedidoPublico): number {
  const entregue = p.status === "entregue" || p.entrega_status === "entregue";
  if (entregue) return 3;
  if (p.tipo_entrega === "retirada") {
    if (p.status === "pronto" || p.entrega_status === "saiu_para_entrega") return 2;
    return p.status === "em_preparo" ? 1 : 0;
  }
  if (p.entrega_status === "saiu_para_entrega") return 2;
  return p.status === "em_preparo" || p.status === "pronto" ? 1 : 0;
}

export default function AcompanharPedido() {
  const { pedidoId } = useParams<{ pedidoId: string }>();
  const [pedido, setPedido] = useState<PedidoPublico | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "nao_encontrado">("carregando");

  const carregar = useCallback(async () => {
    if (!pedidoId || !/^[0-9a-f-]{36}$/i.test(pedidoId)) {
      setEstado("nao_encontrado");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("get_pedido_acompanhamento", { p_pedido_id: pedidoId });
    if (error || !data) {
      setEstado((prev) => (prev === "ok" ? prev : "nao_encontrado"));
      return;
    }
    setPedido(data as PedidoPublico);
    setEstado("ok");
  }, [pedidoId]);

  useEffect(() => {
    void carregar();
    const t = window.setInterval(() => void carregar(), POLL_MS);
    return () => window.clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    if (pedido?.loja.nome) document.title = `Pedido #${pedido.codigo} · ${pedido.loja.nome}`;
  }, [pedido?.codigo, pedido?.loja.nome]);

  if (estado === "carregando") {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Carregando pedido...</div>;
  }

  if (estado === "nao_encontrado" || !pedido) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <Card className="p-6 max-w-sm text-center space-y-2">
          <XCircle className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">Pedido não encontrado</h1>
          <p className="text-sm text-muted-foreground">O link pode ter expirado. Fale com a loja pelo WhatsApp.</p>
        </Card>
      </div>
    );
  }

  const cor = pedido.loja.cor_primaria || "#ea580c";
  const cancelado = pedido.status === "cancelado";
  const etapa = etapaAtual(pedido);
  const retirada = pedido.tipo_entrega === "retirada";
  const etapas = [
    { label: "Pedido recebido", icon: ClipboardCheck },
    { label: "Em preparo", icon: ChefHat },
    retirada ? { label: "Pronto para retirada", icon: Store } : { label: "Saiu para entrega", icon: Bike },
    { label: retirada ? "Retirado" : "Entregue", icon: CheckCircle2 },
  ];
  const cardapioUrl = buildCardapioUrl({ referencia: pedido.loja.referencia });
  const previsao = retirada
    ? pedido.loja.tempo_retirada ? `~${pedido.loja.tempo_retirada} min` : null
    : pedido.loja.tempo_entrega;

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="text-white" style={{ background: cor }}>
        <div className="max-w-lg mx-auto px-4 py-5 flex items-center gap-3">
          {pedido.loja.logo_url && (
            <img src={pedido.loja.logo_url} alt="" className="w-12 h-12 rounded-full object-cover bg-white" />
          )}
          <div className="min-w-0">
            <div className="text-sm opacity-90 truncate">{pedido.loja.nome}</div>
            <h1 className="text-xl font-bold">Pedido #{pedido.codigo}</h1>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-4">
        <Card className="p-5">
          {cancelado ? (
            <div className="text-center space-y-2">
              <XCircle className="w-12 h-12 mx-auto text-destructive" />
              <div className="text-lg font-semibold">Pedido cancelado</div>
              <p className="text-sm text-muted-foreground">Em caso de dúvida, fale com a loja.</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <div className="text-lg font-semibold">
                  {pedido.cliente_nome ? `${pedido.cliente_nome}, ` : ""}
                  {etapa === 3 ? (retirada ? "pedido retirado. Bom apetite! 😋" : "seu pedido foi entregue. Bom apetite! 😋") : etapas[etapa].label.toLowerCase() + "…"}
                </div>
                {etapa < 3 && previsao && (
                  <div className="text-sm text-muted-foreground">Previsão: {previsao}</div>
                )}
                {retirada && etapa === 2 && pedido.loja.endereco && (
                  <div className="text-sm text-muted-foreground mt-1">📍 {pedido.loja.endereco}</div>
                )}
              </div>
              <ol className="space-y-0">
                {etapas.map((e, i) => {
                  const feito = i <= etapa;
                  const Icon = e.icon;
                  return (
                    <li key={e.label} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className={cn("w-9 h-9 rounded-full grid place-items-center border-2", !feito && "border-muted bg-background text-muted-foreground")}
                          style={feito ? { background: cor, borderColor: cor, color: "white" } : undefined}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        {i < etapas.length - 1 && (
                          <div className="w-0.5 h-6" style={{ background: i < etapa ? cor : "hsl(var(--muted))" }} />
                        )}
                      </div>
                      <div className={cn("pt-1.5 text-sm", feito ? "font-medium" : "text-muted-foreground", i === etapa && "font-semibold")}>
                        {e.label}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {etapa < 3 && <p className="text-[11px] text-muted-foreground mt-3">Esta página atualiza sozinha.</p>}
            </>
          )}
        </Card>

        {etapa === 3 && !cancelado && pedido.loja.avaliacao_ativa && (
          <AvaliacaoCard pedido={pedido} cor={cor} cardapioUrl={cardapioUrl} onDone={carregar} />
        )}

        <Card className="p-5 space-y-3">
          <div className="font-semibold">Resumo</div>
          <ul className="space-y-2 text-sm">
            {pedido.itens.map((it, idx) => (
              <li key={idx} className={cn("flex justify-between gap-3", it.cancelado && "line-through text-muted-foreground")}>
                <div className="min-w-0">
                  <div>{it.quantidade}x {it.nome}</div>
                  {it.adicionais.length > 0 && (
                    <div className="text-xs text-muted-foreground">+ {it.adicionais.join(", ")}</div>
                  )}
                </div>
                <div className="shrink-0">{brl(Number(it.total))}</div>
              </li>
            ))}
          </ul>
          <div className="border-t pt-3 space-y-1 text-sm">
            {Number(pedido.taxa_entrega) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Taxa de entrega</span>
                <span>{brl(Number(pedido.taxa_entrega))}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base">
              <span>Total</span>
              <span>{brl(Number(pedido.total))}</span>
            </div>
            {pedido.forma_pagamento && (
              <div className="text-xs text-muted-foreground">
                Pagamento: {pedido.forma_pagamento.toUpperCase()} {pedido.pago ? "· pago ✓" : ""}
              </div>
            )}
          </div>
        </Card>

        <Button asChild variant="outline" className="w-full">
          <a href={cardapioUrl}>Ver cardápio</a>
        </Button>
      </main>
    </div>
  );
}

function AvaliacaoCard({
  pedido,
  cor,
  cardapioUrl,
  onDone,
}: {
  pedido: PedidoPublico;
  cor: string;
  cardapioUrl: string;
  onDone: () => Promise<void> | void;
}) {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  if (pedido.avaliacao) {
    return (
      <Card className="p-5 text-center space-y-2">
        <div className="flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className="w-6 h-6" style={n <= pedido.avaliacao!.nota ? { fill: cor, color: cor } : undefined} />
          ))}
        </div>
        <div className="font-semibold">Obrigado pela avaliação! 💛</div>
        {pedido.avaliacao.nota >= 4 && (
          <Button asChild className="text-white" style={{ background: cor }}>
            <a href={cardapioUrl}>Pedir de novo</a>
          </Button>
        )}
      </Card>
    );
  }

  const enviar = async () => {
    if (!nota) return;
    setEnviando(true);
    setErro("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("avaliar_pedido", {
      p_pedido_id: pedido.id,
      p_nota: nota,
      p_comentario: comentario.trim() || null,
    });
    setEnviando(false);
    if (error || data !== true) {
      setErro("Não foi possível enviar agora. Tente novamente.");
      return;
    }
    await onDone();
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="font-semibold text-center">Como foi seu pedido?</div>
      <div className="flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setNota(n)} aria-label={`${n} estrela${n > 1 ? "s" : ""}`} className="p-1">
            <Star className="w-9 h-9 transition-transform hover:scale-110" style={n <= nota ? { fill: cor, color: cor } : { color: "hsl(var(--muted-foreground))" }} />
          </button>
        ))}
      </div>
      {nota > 0 && (
        <>
          <Textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value.slice(0, 600))}
            placeholder={nota <= 3 ? "Conta pra gente o que podemos melhorar" : "Quer deixar um comentário? (opcional)"}
            rows={3}
          />
          {erro && <div className="text-sm text-destructive">{erro}</div>}
          <Button onClick={enviar} disabled={enviando} className="w-full text-white" style={{ background: cor }}>
            {enviando ? "Enviando..." : "Enviar avaliação"}
          </Button>
        </>
      )}
    </Card>
  );
}
