import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, QrCode, RefreshCw, Unplug, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type EvoState = "open" | "close" | "connecting" | "unknown";

interface EvolutionResponse {
  ok: boolean;
  error?: string;
  instance?: string;
  state?: string;
  phone?: string;
  qr?: string | null;
}

const invokeEvolution = async (
  action: "evolution_connect" | "evolution_status" | "evolution_disconnect",
  configuracaoId: string,
): Promise<EvolutionResponse> => {
  const { data, error } = await supabase.functions.invoke("send-whatsapp", {
    body: { action, configuracao_id: configuracaoId },
  });
  if (error) return { ok: false, error: error.message };
  return data as EvolutionResponse;
};

const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

/** Conexão do WhatsApp via Evolution API: gera QR Code e acompanha o status. */
export function EvolutionConnect({
  configuracaoId,
  instance,
  onConnected,
}: {
  configuracaoId: string;
  instance: string | null | undefined;
  onConnected: (instance: string) => void;
}) {
  const [state, setState] = useState<EvoState>("unknown");
  const [phone, setPhone] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);
  const instanceRef = useRef(instance);
  instanceRef.current = instance;

  const stopPolling = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const refreshStatus = async () => {
    const res = await invokeEvolution("evolution_status", configuracaoId);
    if (!res.ok) return res;
    setState((res.state as EvoState) || "close");
    setPhone(res.phone || "");
    return res;
  };

  useEffect(() => {
    if (instance) refreshStatus();
    return stopPolling;
  }, [configuracaoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPolling = (connectedInstance: string) => {
    stopPolling();
    const startedAt = Date.now();
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        stopPolling();
        setQr(null);
        setState("close");
        toast.error("QR Code expirou. Clique em Conectar para gerar outro.");
        return;
      }
      const res = await refreshStatus();
      if (res.ok && res.state === "open") {
        stopPolling();
        setQr(null);
        onConnected(connectedInstance);
        toast.success("WhatsApp conectado!");
      }
    }, POLL_MS);
  };

  const connect = async () => {
    setBusy(true);
    try {
      const res = await invokeEvolution("evolution_connect", configuracaoId);
      if (!res.ok || !res.instance) {
        toast.error(res.error || "Falha ao conectar");
        return;
      }
      if (res.state === "open") {
        setState("open");
        setPhone(res.phone || "");
        setQr(null);
        onConnected(res.instance);
        toast.success("WhatsApp já está conectado");
        return;
      }
      if (!res.qr) {
        toast.error("O servidor não devolveu o QR Code. Tente novamente.");
        return;
      }
      setQr(res.qr);
      setState("connecting");
      startPolling(res.instance);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Desconectar este WhatsApp do sistema?")) return;
    setBusy(true);
    try {
      const res = await invokeEvolution("evolution_disconnect", configuracaoId);
      if (!res.ok) {
        toast.error(res.error || "Falha ao desconectar");
        return;
      }
      stopPolling();
      setQr(null);
      setState("close");
      setPhone("");
      toast.success("WhatsApp desconectado");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {state === "open" ? (
          <>
            <Badge className="bg-green-100 text-green-700 border-green-300">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Conectado
            </Badge>
            {phone && <span className="text-sm text-muted-foreground">Numero: {phone}</span>}
            <Button variant="outline" size="sm" onClick={disconnect} disabled={busy} className="ml-auto">
              <Unplug className="w-4 h-4 mr-1" /> Desconectar
            </Button>
          </>
        ) : (
          <>
            {state === "close" && instanceRef.current && (
              <Badge className="bg-red-100 text-red-700 border-red-300">
                <XCircle className="w-3 h-3 mr-1" /> Desconectado
              </Badge>
            )}
            <Button onClick={connect} disabled={busy}>
              {busy
                ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Gerando QR Code...</>
                : <><QrCode className="w-4 h-4 mr-1" /> {qr ? "Gerar novo QR Code" : "Conectar WhatsApp"}</>}
            </Button>
          </>
        )}
      </div>

      {qr && state !== "open" && (
        <div className="flex flex-col sm:flex-row gap-4 items-start rounded-lg border bg-muted/40 p-4">
          <img src={qr} alt="QR Code para conectar o WhatsApp" className="w-56 h-56 rounded bg-white p-2" />
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal pl-4">
            <li>Abra o WhatsApp da loja no celular</li>
            <li>Toque em <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong></li>
            <li>Aponte a câmera para este QR Code</li>
            <li className="list-none -ml-4 pt-2 flex items-center gap-2">
              <RefreshCw className="w-3 h-3 animate-spin" /> Aguardando leitura...
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
