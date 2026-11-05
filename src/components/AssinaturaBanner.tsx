import { Clock, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { diasRestantesTeste, linkAssinar, PRECO_ASSINATURA, type MinhaAssinatura } from "@/lib/assinatura";

/** Aviso fixo no topo: teste grátis em andamento, modo demonstração ou pagamento em confirmação. */
export function AssinaturaBanner({ assinatura, aguardandoPagamento }: { assinatura: MinhaAssinatura | null; aguardandoPagamento: boolean }) {
  const { user } = useAuth();
  if (!assinatura) return null;

  const emTeste = Boolean(assinatura.em_teste) && !assinatura.paga && !assinatura.liberado_manual;
  if (assinatura.liberada && !emTeste && !aguardandoPagamento) return null;

  const cancelada = assinatura.status === "canceled" || assinatura.status === "unpaid";
  const dias = diasRestantesTeste(assinatura.teste_ate);
  const Icone = aguardandoPagamento ? Loader2 : emTeste ? Clock : Lock;

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex flex-wrap items-center gap-3">
        <Icone className={`h-5 w-5 shrink-0 ${aguardandoPagamento ? "animate-spin" : ""}`} />
        <p className="min-w-0 flex-1 text-sm">
          {aguardandoPagamento ? (
            <>
              <strong>Confirmando seu pagamento...</strong> Em instantes a conta é liberada.
            </>
          ) : emTeste ? (
            <>
              <strong>
                Teste grátis: {dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`}.
              </strong>{" "}
              {/* O aviso é fixo no topo: no celular precisa ocupar pouco espaço. */}
              <span className="sm:hidden">WhatsApp automático só na assinatura, cobrada ao assinar.</span>
              <span className="hidden sm:inline">
                Pedidos, mesas e cardápio online já funcionam. WhatsApp automático, IA e marketing entram com a assinatura
                ({PRECO_ASSINATURA}). A cobrança começa quando você assinar.
              </span>
            </>
          ) : (
            <>
              <strong>{cancelada ? "Sua assinatura foi encerrada." : "Modo demonstração."}</strong> Você pode explorar o
              sistema e montar seu cardápio, mas pedidos, mesas, WhatsApp e o cardápio público só funcionam com a
              assinatura ({PRECO_ASSINATURA}).
            </>
          )}
        </p>
        {!aguardandoPagamento && (
          <Button asChild size="sm">
            <a href={linkAssinar(user)} target="_blank" rel="noopener noreferrer">
              {cancelada ? "Reativar assinatura" : "Assinar agora"}
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
