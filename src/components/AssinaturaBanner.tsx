import { Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { linkAssinar, PRECO_ASSINATURA, type MinhaAssinatura } from "@/lib/assinatura";

/** Aviso do modo demonstração, fixo no topo enquanto a conta não tem assinatura ativa. */
export function AssinaturaBanner({ assinatura, aguardandoPagamento }: { assinatura: MinhaAssinatura | null; aguardandoPagamento: boolean }) {
  const { user } = useAuth();
  if (!assinatura || assinatura.liberada) return null;

  const cancelada = assinatura.status === "canceled" || assinatura.status === "unpaid";
  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex flex-wrap items-center gap-3">
        {aguardandoPagamento ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Lock className="h-5 w-5 shrink-0" />}
        <p className="min-w-0 flex-1 text-sm">
          {aguardandoPagamento ? (
            <>
              <strong>Confirmando seu pagamento...</strong> Em instantes a conta é liberada.
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
