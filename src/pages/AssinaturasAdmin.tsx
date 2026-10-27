import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { STATUS_ASSINATURA } from "@/lib/assinatura";

// Tabelas e funções da assinatura ainda não estão nos tipos gerados do Supabase.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface Conta {
  owner_id: string;
  email: string;
  nome: string | null;
  nome_loja: string | null;
  criado_em: string;
  pedidos_30d: number;
  liberada: boolean;
  liberado_manual: boolean;
  stripe_status: string | null;
  periodo_fim: string | null;
  observacao: string | null;
}

interface EventoSemConta {
  id: string;
  email: string | null;
  recebido_em: string;
  erro: string | null;
}

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

/** Contas da plataforma: quem paga pela Stripe, quem foi liberado à mão e quem está em demonstração. */
export default function AssinaturasAdmin() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [contas, setContas] = useState<Conta[]>([]);
  const [semConta, setSemConta] = useState<EventoSemConta[]>([]);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [{ data: lista, error }, { data: eventos }] = await Promise.all([
      sb.rpc("admin_assinaturas"),
      sb.from("stripe_eventos").select("id, email, recebido_em, erro").eq("processado", false).like("erro", "Pagamento sem conta%").order("recebido_em", { ascending: false }).limit(20),
    ]);
    if (error) toast.error(error.message);
    setContas(lista || []);
    setSemConta(eventos || []);
  }, []);

  useEffect(() => {
    void sb.rpc("is_prospeccao_admin").then(({ data: ok }: { data: boolean | null }) => {
      setAdmin(Boolean(ok));
      if (ok) void carregar();
    });
  }, [carregar]);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return contas;
    return contas.filter((c) => [c.email, c.nome, c.nome_loja].some((v) => (v || "").toLowerCase().includes(t)));
  }, [contas, busca]);

  const liberar = async (c: Conta, liberado: boolean) => {
    setSalvando(c.owner_id);
    const { error } = await sb.rpc("admin_definir_liberacao", {
      p_owner: c.owner_id,
      p_liberado: liberado,
      p_observacao: liberado ? "Liberada manualmente pelo administrador." : "Liberação manual removida pelo administrador.",
    });
    setSalvando(null);
    if (error) return toast.error(error.message);
    toast.success(liberado ? `${c.email} liberada` : `${c.email} voltou para o modo demonstração`);
    void carregar();
  };

  if (admin === null) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!admin) return <Card className="p-6 text-sm text-muted-foreground">Esta área é só para o administrador do Easy Food Hub.</Card>;

  const pagantes = contas.filter((c) => c.stripe_status && ["active", "trialing", "past_due"].includes(c.stripe_status)).length;
  const manuais = contas.filter((c) => c.liberado_manual).length;
  const demo = contas.filter((c) => !c.liberada).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl text-foreground">Assinaturas</h1>
        <p className="text-muted-foreground mt-1">
          Conta sem assinatura fica em modo demonstração: monta a loja, mas não registra pedidos, não abre mesas, não usa
          WhatsApp e o cardápio público fica indisponível. “Liberada à mão” deixa operar sem Stripe (clientes antigos,
          pagamento por fora, cortesia).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-sm text-muted-foreground">Pagando pela Stripe</p><p className="text-2xl font-bold">{pagantes}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted-foreground">Liberadas à mão</p><p className="text-2xl font-bold">{manuais}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted-foreground">Em demonstração</p><p className="text-2xl font-bold">{demo}</p></Card>
      </div>

      {semConta.length > 0 && (
        <Card className="border-amber-300 p-4 text-sm">
          <p className="font-semibold">Pagamentos sem conta vinculada</p>
          <p className="text-muted-foreground">
            A pessoa pagou com um e-mail que não tem conta no sistema. Peça para ela se cadastrar com esse e-mail e libere a
            conta à mão aqui.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {semConta.map((e) => (
              <li key={e.id}>{e.email || "sem e-mail"} · {data(e.recebido_em)}</li>
            ))}
          </ul>
        </Card>
      )}

      <Input placeholder="Buscar por e-mail, nome ou loja" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-sm" />

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead className="text-right">Pedidos 30 dias</TableHead>
              <TableHead>Stripe</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Liberada à mão</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((c) => (
              <TableRow key={c.owner_id}>
                <TableCell>
                  <div className="font-medium">{c.nome_loja || c.nome || "—"}</div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                  {c.observacao && <div className="text-xs text-muted-foreground mt-1 max-w-xs">{c.observacao}</div>}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">{data(c.criado_em)}</TableCell>
                <TableCell className="text-right tabular-nums">{c.pedidos_30d}</TableCell>
                <TableCell className="text-sm">
                  {c.stripe_status ? STATUS_ASSINATURA[c.stripe_status] ?? c.stripe_status : "—"}
                  {c.periodo_fim && <div className="text-xs text-muted-foreground">até {data(c.periodo_fim)}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant={c.liberada ? "secondary" : "outline"}>{c.liberada ? "Operando" : "Demonstração"}</Badge>
                </TableCell>
                <TableCell>
                  <Switch checked={c.liberado_manual} disabled={salvando === c.owner_id} onCheckedChange={(v) => void liberar(c, v)} />
                </TableCell>
              </TableRow>
            ))}
            {!filtradas.length && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhuma conta.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
