import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Circle, Copy, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { formatScheduleRange, getTodaySchedule, lojaAbertaAgora } from "@/lib/horarioLoja";
import { passosPrimeiroPedido, type SituacaoLoja } from "@/lib/primeirosPassos";
import { buildCardapioUrl } from "@/lib/publicAppUrl";
import type { Configuracao } from "@/types/db";

type ConfigGuia = Pick<
  Configuracao,
  "referencia" | "site_url" | "retirada_ativa" | "hora_abertura" | "hora_fechamento" | "horario_funcionamento"
>;

// Tabelas com owner_id ainda fora dos tipos gerados do Supabase (mesmo padrão de AssinaturasAdmin).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const chaveOculto = (contaId: string) => `efh_guia_oculto_${contaId}`;

function lerOculto(contaId: string): boolean {
  try {
    return window.localStorage.getItem(chaveOculto(contaId)) === "1";
  } catch {
    return false;
  }
}

/** Guia da conta em teste até o primeiro pedido chegar. Some sozinho depois disso. */
export function PrimeirosPassos({ contaId }: { contaId: string }) {
  const { pathname } = useLocation();
  const [cfg, setCfg] = useState<ConfigGuia | null>(null);
  const [situacao, setSituacao] = useState<SituacaoLoja | null>(null);
  const [oculto, setOculto] = useState(() => lerOculto(contaId));
  const [ligando, setLigando] = useState(false);

  const carregar = useCallback(async () => {
    // Cada consulta pede uma linha só: basta saber se existe.
    const [config, produto, bairro, pedido] = await Promise.all([
      sb
        .from("configuracoes")
        .select("referencia, site_url, retirada_ativa, hora_abertura, hora_fechamento, horario_funcionamento")
        .eq("owner_id", contaId)
        .limit(1)
        .maybeSingle(),
      sb.from("produtos").select("id").eq("owner_id", contaId).limit(1),
      sb.from("bairros_taxas").select("id").eq("owner_id", contaId).eq("ativo", true).limit(1),
      sb.from("pedidos").select("id").eq("owner_id", contaId).limit(1),
    ]);
    if (config.error || !config.data) return;
    const c = config.data as unknown as ConfigGuia;
    setCfg(c);
    setSituacao({
      temProduto: Boolean(produto.data?.length),
      temBairro: Boolean(bairro.data?.length),
      retiradaAtiva: Boolean(c.retirada_ativa),
      abertaAgora: lojaAbertaAgora(c),
      horarioHoje: formatScheduleRange(getTodaySchedule(c), c),
      temPedido: Boolean(pedido.data?.length),
    });
  }, [contaId]);

  // Atualiza ao trocar de tela (a pessoa volta das Configurações) e ao voltar para a aba.
  useEffect(() => {
    if (oculto) return;
    void carregar();
    const onFocus = () => void carregar();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [carregar, oculto, pathname]);

  if (oculto || !cfg || !situacao || situacao.temPedido) return null;

  const passos = passosPrimeiroPedido(situacao);
  const feitos = passos.filter((p) => p.feito).length;
  // Só o próximo passo aparece aberto: no celular o guia não pode tomar a tela inteira.
  const proximo = passos.find((p) => !p.feito)?.id;
  const linkCardapio = buildCardapioUrl({ site_url: cfg.site_url, referencia: cfg.referencia });

  const ocultar = () => {
    try {
      window.localStorage.setItem(chaveOculto(contaId), "1");
    } catch {
      // Sem armazenamento: some só até recarregar.
    }
    setOculto(true);
  };

  const ligarRetirada = async () => {
    setLigando(true);
    const { error } = await sb.from("configuracoes").update({ retirada_ativa: true }).eq("owner_id", contaId);
    setLigando(false);
    if (error) return toast.error(error.message);
    toast.success("Retirada no balcão ligada. Dá para mudar depois em Configurações.");
    void carregar();
  };

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(linkCardapio);
      toast.success("Link do cardápio copiado");
    } catch {
      toast.error("Não foi possível copiar. Use o botão Abrir cardápio.");
    }
  };

  return (
    <Card className="mb-6 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Receba seu primeiro pedido</h2>
          <p className="text-sm text-muted-foreground">
            {feitos} de {passos.length} passos. Faça um pedido de teste para ver tudo funcionando.
          </p>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-2 shrink-0" onClick={ocultar} aria-label="Ocultar guia">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ol className="mt-4 space-y-2">
        {passos.map((p) => (
          <li key={p.id} className="flex gap-3">
            {p.feito ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-label="Feito" />
            ) : (
              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-label="A fazer" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${p.feito ? "text-muted-foreground line-through" : ""}`}>{p.titulo}</p>
              {p.id === proximo && <p className="text-sm text-muted-foreground">{p.detalhe}</p>}
              {p.id === proximo && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.id === "produto" && (
                    <Button asChild size="sm" variant="outline"><Link to="/admin/cardapio">Ir para o cardápio</Link></Button>
                  )}
                  {p.id === "entrega" && (
                    <>
                      <Button size="sm" variant="outline" disabled={ligando} onClick={() => void ligarRetirada()}>
                        Ligar retirada no balcão
                      </Button>
                      <Button asChild size="sm" variant="ghost"><Link to="/configuracoes">Cadastrar bairros</Link></Button>
                    </>
                  )}
                  {p.id === "horario" && (
                    <Button asChild size="sm" variant="outline"><Link to="/configuracoes">Ajustar horário</Link></Button>
                  )}
                  {p.id === "pedido" && (
                    <>
                      <Button asChild size="sm" variant="outline">
                        <a href={linkCardapio} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" /> Abrir cardápio
                        </a>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void copiarLink()}>
                        <Copy className="h-4 w-4" /> Copiar link
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
