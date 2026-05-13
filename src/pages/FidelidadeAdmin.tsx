import { useEffect, useMemo, useState } from "react";
import { Gift, Search, Settings2, Users, Pencil, Plus, Trash2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Configuracao, Produto, Recompensa } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl } from "@/lib/format";
import { toast } from "sonner";

interface ClienteRow {
  id: string;
  nome: string;
  telefone: string;
  total_pedidos: number;
  pontos: number;
  resgates_realizados: number;
  ultimo_pedido: string | null;
}

interface ClienteDetalhe {
  cliente: ClienteRow | null;
  pedidos: Array<{
    pedido_id: string;
    tipo: string;
    status: string;
    subtotal: number;
    desconto: number;
    total: number;
    criado_em: string;
  }>;
  resgates: Array<{
    id: string;
    status: string;
    resgatado_em: string;
    pedido_id: string | null;
    recompensa_nome: string;
    tipo: string;
    valor: number;
  }>;
}

const emptyRewardForm = {
  nome: "",
  descricao: "",
  tipo: "desconto_percentual" as Recompensa["tipo"],
  valor: "10",
  produto_id: "none",
  pedidos_necessarios: "10",
  ativo: true,
  imagem_url: "",
  ordem: "0",
};

const normalizeHexColor = (value?: string | null) => {
  if (!value) return "#16a34a";
  const normalized = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : "#16a34a";
};

export default function FidelidadeAdmin() {
  const [configuracao, setConfiguracao] = useState<Configuracao | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [recompensas, setRecompensas] = useState<Recompensa[]>([]);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [clienteBusca, setClienteBusca] = useState("");
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [rewardDialogOpen, setRewardDialogOpen] = useState(false);
  const [rewardBusy, setRewardBusy] = useState(false);
  const [rewardEdit, setRewardEdit] = useState<Recompensa | null>(null);
  const [rewardForm, setRewardForm] = useState(emptyRewardForm);
  const [clienteDetalheOpen, setClienteDetalheOpen] = useState(false);
  const [clienteDetalhe, setClienteDetalhe] = useState<ClienteDetalhe | null>(null);
  const [clienteDetalheBusy, setClienteDetalheBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);

  const produtoMap = useMemo(() => new Map(produtos.map((produto) => [produto.id, produto.nome])), [produtos]);

  const loadBase = async () => {
    const [{ data: cfg }, { data: listaProdutos }, { data: listaRecompensas }] = await Promise.all([
      supabase.from("configuracoes").select("*").limit(1).maybeSingle(),
      supabase.from("produtos").select("*").order("nome"),
      supabase.from("recompensas").select("*").order("ordem").order("pedidos_necessarios"),
    ]);

    if (cfg) setConfiguracao(cfg as Configuracao);
    setProdutos((listaProdutos || []) as Produto[]);
    setRecompensas((listaRecompensas || []) as Recompensa[]);
  };

  const loadClientes = async (termo = clienteBusca) => {
    setLoadingClientes(true);
    const { data, error } = await supabase.rpc("list_clientes_fidelidade", {
      search_term: termo.trim() || null,
    });
    setLoadingClientes(false);

    if (error) {
      return toast.error(error.message);
    }

    setClientes(((data || []) as unknown as ClienteRow[]) || []);
  };

  useEffect(() => {
    void loadBase();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadClientes();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [clienteBusca]);

  const openNewReward = () => {
    setRewardEdit(null);
    setRewardForm(emptyRewardForm);
    setRewardDialogOpen(true);
  };

  const openEditReward = (reward: Recompensa) => {
    setRewardEdit(reward);
    setRewardForm({
      nome: reward.nome,
      descricao: reward.descricao || "",
      tipo: reward.tipo,
      valor: String(reward.valor ?? 0),
      produto_id: reward.produto_id || "none",
      pedidos_necessarios: String(reward.pedidos_necessarios),
      ativo: reward.ativo,
      imagem_url: reward.imagem_url || "",
      ordem: String(reward.ordem),
    });
    setRewardDialogOpen(true);
  };

  const saveReward = async () => {
    const payload = {
      nome: rewardForm.nome.trim(),
      descricao: rewardForm.descricao.trim() || null,
      tipo: rewardForm.tipo,
      valor: rewardForm.tipo === "item_gratis" ? 0 : Number(rewardForm.valor.replace(",", ".")) || 0,
      produto_id: rewardForm.tipo === "item_gratis" ? (rewardForm.produto_id === "none" ? null : rewardForm.produto_id) : null,
      pedidos_necessarios: Number(rewardForm.pedidos_necessarios) || 0,
      ativo: rewardForm.ativo,
      imagem_url: rewardForm.imagem_url.trim() || null,
      ordem: Number(rewardForm.ordem) || 0,
    };

    if (!payload.nome) return toast.error("Informe o nome da recompensa");
    if (payload.pedidos_necessarios < 1) return toast.error("Informe quantos pedidos sao necessarios");
    if (rewardForm.tipo === "item_gratis" && !payload.produto_id) return toast.error("Selecione o produto do item gratis");

    setRewardBusy(true);
    const { error } = rewardEdit
      ? await supabase.from("recompensas").update(payload).eq("id", rewardEdit.id)
      : await supabase.from("recompensas").insert(payload);
    setRewardBusy(false);

    if (error) return toast.error(error.message);

    toast.success(rewardEdit ? "Recompensa atualizada" : "Recompensa criada");
    setRewardDialogOpen(false);
    void loadBase();
  };

  const deleteReward = async (rewardId: string) => {
    const { error } = await supabase.from("recompensas").delete().eq("id", rewardId);
    if (error) return toast.error(error.message);
    toast.success("Recompensa removida");
    void loadBase();
  };

  const toggleReward = async (reward: Recompensa) => {
    const { error } = await supabase.from("recompensas").update({ ativo: !reward.ativo }).eq("id", reward.id);
    if (error) return toast.error(error.message);
    setRecompensas((current) => current.map((item) => item.id === reward.id ? { ...item, ativo: !item.ativo } : item));
  };

  const openClienteDetalhe = async (clienteId: string) => {
    setClienteDetalheOpen(true);
    setClienteDetalheBusy(true);
    const { data, error } = await supabase.rpc("get_cliente_fidelidade_detalhe", {
      p_cliente_id: clienteId,
    });
    setClienteDetalheBusy(false);

    if (error) {
      setClienteDetalheOpen(false);
      return toast.error(error.message);
    }

    setClienteDetalhe((data || null) as unknown as ClienteDetalhe);
  };

  const saveConfig = async () => {
    if (!configuracao) return;
    setConfigBusy(true);
    const { error } = await supabase
      .from("configuracoes")
      .update({
        fidelidade_ativa: configuracao.fidelidade_ativa,
        fidelidade_texto: configuracao.fidelidade_texto,
        fidelidade_cor: normalizeHexColor(configuracao.fidelidade_cor),
      })
      .eq("id", configuracao.id);
    setConfigBusy(false);

    if (error) return toast.error(error.message);
    toast.success("Configuracoes de fidelidade salvas");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-foreground flex items-center gap-3">
            <Trophy className="w-8 h-8 text-primary" /> Fidelidade
          </h1>
          <p className="text-muted-foreground mt-1">Recompensas, clientes e configuracoes do programa de fidelidade</p>
        </div>
      </div>

      <Tabs defaultValue="recompensas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="recompensas"><Gift className="w-4 h-4 mr-2" /> Recompensas</TabsTrigger>
          <TabsTrigger value="clientes"><Users className="w-4 h-4 mr-2" /> Clientes</TabsTrigger>
          <TabsTrigger value="configuracoes"><Settings2 className="w-4 h-4 mr-2" /> Configuracoes</TabsTrigger>
        </TabsList>

        <TabsContent value="recompensas" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openNewReward}><Plus className="w-4 h-4 mr-2" /> Nova recompensa</Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {recompensas.map((reward) => (
              <Card key={reward.id} className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{reward.nome}</h3>
                      <Badge variant={reward.ativo ? "default" : "secondary"}>{reward.ativo ? "Ativa" : "Inativa"}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{reward.descricao || "Sem descricao"}</p>
                  </div>
                  <Switch checked={reward.ativo} onCheckedChange={() => toggleReward(reward)} />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Tipo</div>
                    <div className="font-medium">{reward.tipo}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Meta</div>
                    <div className="font-medium">{reward.pedidos_necessarios} pedidos</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Valor</div>
                    <div className="font-medium">{reward.tipo === "item_gratis" ? produtoMap.get(reward.produto_id || "") || "Produto nao encontrado" : brl(Number(reward.valor))}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Ordem</div>
                    <div className="font-medium">{reward.ordem}</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEditReward(reward)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => deleteReward(reward.id)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Excluir
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="clientes" className="space-y-4">
          <Card className="p-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={clienteBusca}
                onChange={(event) => setClienteBusca(event.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="pl-9"
              />
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Pedidos</TableHead>
                  <TableHead>Resgates</TableHead>
                  <TableHead>Ultimo pedido</TableHead>
                  <TableHead className="w-[120px]">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingClientes ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">Carregando clientes...</TableCell>
                  </TableRow>
                ) : clientes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum cliente encontrado.</TableCell>
                  </TableRow>
                ) : (
                  clientes.map((cliente) => (
                    <TableRow key={cliente.id}>
                      <TableCell>
                        <div className="font-medium">{cliente.nome}</div>
                        <div className="text-xs text-muted-foreground">{cliente.pontos} ponto(s)</div>
                      </TableCell>
                      <TableCell>{cliente.telefone}</TableCell>
                      <TableCell>{cliente.total_pedidos}</TableCell>
                      <TableCell>{cliente.resgates_realizados}</TableCell>
                      <TableCell>{cliente.ultimo_pedido ? new Date(cliente.ultimo_pedido).toLocaleString("pt-BR") : "-"}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => openClienteDetalhe(cliente.id)}>
                          Ver historico
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="configuracoes" className="space-y-4">
          <Card className="p-6 space-y-5 max-w-3xl">
            <div className="flex items-center justify-between gap-4 rounded-2xl border p-4">
              <div>
                <h3 className="font-semibold text-lg">Ativar programa de fidelidade</h3>
                <p className="text-sm text-muted-foreground">Quando desativado, o banner e a secao desaparecem do cardapio publico.</p>
              </div>
              <Switch
                checked={!!configuracao?.fidelidade_ativa}
                onCheckedChange={(checked) => configuracao && setConfiguracao({ ...configuracao, fidelidade_ativa: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label>Texto de apresentacao</Label>
              <Textarea
                value={configuracao?.fidelidade_texto || ""}
                onChange={(event) => configuracao && setConfiguracao({ ...configuracao, fidelidade_texto: event.target.value })}
                placeholder="A cada 10 pedidos, ganhe uma recompensa!"
              />
            </div>

            <div className="space-y-2">
              <Label>Cor da fidelidade</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="color"
                  value={normalizeHexColor(configuracao?.fidelidade_cor)}
                  onChange={(event) => configuracao && setConfiguracao({ ...configuracao, fidelidade_cor: normalizeHexColor(event.target.value) })}
                  className="h-10 w-16 cursor-pointer p-1"
                />
                <Input
                  value={configuracao?.fidelidade_cor || "#16a34a"}
                  onChange={(event) => configuracao && setConfiguracao({ ...configuracao, fidelidade_cor: event.target.value })}
                  onBlur={() => configuracao && setConfiguracao({ ...configuracao, fidelidade_cor: normalizeHexColor(configuracao.fidelidade_cor) })}
                  placeholder="#16a34a"
                  maxLength={7}
                  className="max-w-[140px]"
                />
              </div>
              <p className="text-xs text-muted-foreground">Essa cor controla o destaque visual da secao de fidelidade no cardapio publico.</p>
            </div>

            <div className="flex justify-end">
              <Button onClick={saveConfig} disabled={configBusy || !configuracao}>
                {configBusy ? "Salvando..." : "Salvar configuracoes"}
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={rewardDialogOpen} onOpenChange={setRewardDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">{rewardEdit ? "Editar recompensa" : "Nova recompensa"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Nome</Label>
              <Input value={rewardForm.nome} onChange={(event) => setRewardForm({ ...rewardForm, nome: event.target.value })} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Descricao</Label>
              <Textarea value={rewardForm.descricao} onChange={(event) => setRewardForm({ ...rewardForm, descricao: event.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={rewardForm.tipo} onValueChange={(value) => setRewardForm({ ...rewardForm, tipo: value as Recompensa["tipo"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="desconto_percentual">Desconto percentual</SelectItem>
                  <SelectItem value="desconto_fixo">Desconto fixo</SelectItem>
                  <SelectItem value="item_gratis">Item gratis</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{rewardForm.tipo === "desconto_percentual" ? "Percentual" : "Valor"}</Label>
              <Input
                value={rewardForm.valor}
                onChange={(event) => setRewardForm({ ...rewardForm, valor: event.target.value })}
                disabled={rewardForm.tipo === "item_gratis"}
              />
            </div>

            <div className="space-y-2">
              <Label>Produto vinculado</Label>
              <Select value={rewardForm.produto_id} onValueChange={(value) => setRewardForm({ ...rewardForm, produto_id: value })}>
                <SelectTrigger><SelectValue placeholder="Selecione um produto" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {produtos.map((produto) => (
                    <SelectItem key={produto.id} value={produto.id}>{produto.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Pedidos necessarios</Label>
              <Input value={rewardForm.pedidos_necessarios} onChange={(event) => setRewardForm({ ...rewardForm, pedidos_necessarios: event.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Imagem (URL)</Label>
              <Input value={rewardForm.imagem_url} onChange={(event) => setRewardForm({ ...rewardForm, imagem_url: event.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Ordem</Label>
              <Input value={rewardForm.ordem} onChange={(event) => setRewardForm({ ...rewardForm, ordem: event.target.value })} />
            </div>

            <div className="flex items-center gap-3 rounded-xl border p-3 md:col-span-2">
              <Switch checked={rewardForm.ativo} onCheckedChange={(checked) => setRewardForm({ ...rewardForm, ativo: checked })} />
              <div>
                <div className="font-medium">Recompensa ativa</div>
                <div className="text-xs text-muted-foreground">Disponivel para o cardapio publico e para selecao no pedido.</div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRewardDialogOpen(false)} disabled={rewardBusy}>Cancelar</Button>
            <Button onClick={saveReward} disabled={rewardBusy}>{rewardBusy ? "Salvando..." : "Salvar"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={clienteDetalheOpen} onOpenChange={setClienteDetalheOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">Historico do cliente</DialogTitle>
          </DialogHeader>

          {clienteDetalheBusy || !clienteDetalhe ? (
            <div className="text-muted-foreground">Carregando detalhes...</div>
          ) : (
            <div className="space-y-5">
              <Card className="p-4">
                <div className="font-semibold text-lg">{clienteDetalhe.cliente?.nome}</div>
                <div className="text-sm text-muted-foreground">{clienteDetalhe.cliente?.telefone}</div>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Pedidos</h3>
                  <div className="space-y-3 max-h-[360px] overflow-y-auto">
                    {clienteDetalhe.pedidos.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum pedido vinculado.</p>
                    ) : clienteDetalhe.pedidos.map((pedido) => (
                      <div key={pedido.pedido_id} className="rounded-2xl border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">Pedido #{pedido.pedido_id.slice(0, 8).toUpperCase()}</div>
                          <Badge variant="outline">{pedido.status}</Badge>
                        </div>
                        <div className="text-muted-foreground mt-1">{new Date(pedido.criado_em).toLocaleString("pt-BR")}</div>
                        <div className="mt-2 flex justify-between"><span>Total</span><span>{brl(Number(pedido.total || 0))}</span></div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-4">
                  <h3 className="font-semibold mb-3">Resgates</h3>
                  <div className="space-y-3 max-h-[360px] overflow-y-auto">
                    {clienteDetalhe.resgates.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum resgate realizado.</p>
                    ) : clienteDetalhe.resgates.map((resgate) => (
                      <div key={resgate.id} className="rounded-2xl border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium">{resgate.recompensa_nome}</div>
                          <Badge variant="outline">{resgate.status}</Badge>
                        </div>
                        <div className="text-muted-foreground mt-1">{new Date(resgate.resgatado_em).toLocaleString("pt-BR")}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}