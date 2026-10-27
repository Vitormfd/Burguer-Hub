import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dataHora, sb } from "@/lib/prospeccao";

interface Execucao {
  id: string;
  tipo: string;
  status: "rodando" | "ok" | "erro" | "pulada";
  iniciada_em: string;
  duracao_ms: number;
  consulta: string | null;
  encontrados: number;
  novos: number;
  qualificados: number;
  buscas_web: number;
  chamadas_places: number;
  custo_usd: number;
  erro: string | null;
}

const TIPO_LABEL: Record<string, string> = { descoberta: "Agenda", manual: "Manual", conversa: "Conversa", mensagem: "Mensagem" };

export function ProspeccaoExecucoes({ versao }: { versao: number }) {
  const [linhas, setLinhas] = useState<Execucao[]>([]);
  const [buscas, setBuscas] = useState(0);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    void (async () => {
      setCarregando(true);
      const [{ data }, { count }] = await Promise.all([
        sb.from("prospeccao_execucoes").select("*").order("iniciada_em", { ascending: false }).limit(100),
        sb.from("prospeccao_buscas").select("id", { count: "exact", head: true }),
      ]);
      setLinhas(data || []);
      setBuscas(count || 0);
      setCarregando(false);
    })();
  }, [versao]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Últimas 100 execuções. {buscas} pesquisas diferentes já feitas (cada combinação cidade + especialidade + público só se repete depois de 90 dias).
      </p>
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pesquisa</TableHead>
              <TableHead className="text-right">Achados / novos / qualif.</TableHead>
              <TableHead className="text-right">Buscas</TableHead>
              <TableHead className="text-right">Custo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {dataHora(e.iniciada_em)}
                  <div className="text-muted-foreground">{e.duracao_ms ? `${Math.round(e.duracao_ms / 1000)}s` : ""}</div>
                </TableCell>
                <TableCell className="text-xs">{TIPO_LABEL[e.tipo] ?? e.tipo}</TableCell>
                <TableCell>
                  <Badge variant={e.status === "erro" ? "destructive" : e.status === "ok" ? "secondary" : "outline"}>{e.status}</Badge>
                </TableCell>
                <TableCell className="text-xs max-w-[340px]">
                  {e.consulta ?? "—"}
                  {e.erro && <div className="text-destructive mt-1 break-words">{e.erro}</div>}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {e.encontrados} / {e.novos} / {e.qualificados}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {e.buscas_web}
                  {e.chamadas_places ? ` + ${e.chamadas_places} Maps` : ""}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">US$ {Number(e.custo_usd).toFixed(3)}</TableCell>
              </TableRow>
            ))}
            {!linhas.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {carregando ? "Carregando..." : "Nenhuma execução ainda."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
