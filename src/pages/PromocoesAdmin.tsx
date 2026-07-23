import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CopyPlus,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  CONDICAO_TIPOS,
  CONDICAO_TIPO_LABELS,
  emptyAcaoForTipo,
  emptyEscopo,
  gerarPreviewPromocao,
  invalidatePromocoesCache,
  PROMOCAO_TIPOS,
  PROMOCAO_TIPO_LABELS,
  type CondicaoTipo,
  type EscopoProdutos,
  type Promocao,
  type PromocaoAcao,
  type PromocaoCondicao,
  type PromocaoTipo,
} from "@/lib/promocoes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const sb = supabase as any;

const DIAS_SEMANA = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
] as const;

interface ProdutoOpt {
  id: string;
  nome: string;
  categoria_id: string | null;
}

interface CategoriaOpt {
  id: string;
  nome: string;
}

interface FormState {
  nome: string;
  descricao: string;
  tipo: PromocaoTipo;
  ativo: boolean;
  prioridade: string;
  data_inicio: string;
  data_fim: string;
  hora_inicio: string;
  hora_fim: string;
  dias_semana: number[];
  limite_usos_total: string;
  ilimitado: boolean;
  limite_por_cliente: string;
  aplica_automaticamente: boolean;
  necessita_cupom: boolean;
  codigo_cupom: string;
  condicoes: PromocaoCondicao[];
  acao: PromocaoAcao;
  escopo_produtos: EscopoProdutos;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): FormState => ({
  nome: "",
  descricao: "",
  tipo: "desconto_percentual",
  ativo: true,
  prioridade: "0",
  data_inicio: "",
  data_fim: "",
  hora_inicio: "",
  hora_fim: "",
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  limite_usos_total: "",
  ilimitado: true,
  limite_por_cliente: "",
  aplica_automaticamente: true,
  necessita_cupom: false,
  codigo_cupom: "",
  condicoes: [],
  acao: emptyAcaoForTipo("desconto_percentual"),
  escopo_produtos: emptyEscopo(),
});

const parseDiasSemana = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [0, 1, 2, 3, 4, 5, 6];
  const dias = value.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return dias.length ? Array.from(new Set(dias)).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6];
};

const timeInputValue = (value: string | null | undefined) => {
  if (!value) return "";
  return String(value).slice(0, 5);
};

const timePayload = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
};

const isExpired = (promo: Pick<Promocao, "data_fim">) => {
  const today = todayKey();
  return Boolean(promo.data_fim && promo.data_fim < today);
};

const statusInfo = (promo: Promocao) => {
  if (isExpired(promo)) {
    return { label: "Expirada", className: "border-red-500/30 bg-red-500/10 text-red-700" };
  }
  if (!promo.ativo) {
    return { label: "Inativa", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700" };
  }
  return { label: "Ativa", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" };
};

const emptyCondicaoParams = (tipo: CondicaoTipo): Record<string, unknown> => {
  switch (tipo) {
    case "valor_minimo":
    case "valor_maximo":
    case "pedido_acima":
      return { valor: 50 };
    case "qtd_min_itens":
    case "qtd_max_itens":
      return { quantidade: 1 };
    case "categoria":
      return { categoria_ids: [] };
    case "produto":
    case "excluir_produto":
    case "contem_produto":
    case "nao_contem_produto":
      return { produto_ids: [], qtd_min: 1 };
    case "tipo_entrega":
      return { valores: ["delivery"] };
    case "forma_pagamento":
      return { valores: [] };
    case "cliente_vip":
      return { min_pedidos: 5 };
    case "cidade":
    case "bairro":
      return { nomes: [] };
    case "qtd_pedidos_anteriores":
      return { min: 0 };
    case "primeiro_pedido":
    case "cliente_novo":
    default:
      return {};
  }
};

const toggleId = (list: string[], id: string) =>
  list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

function MultiCheckList({
  items,
  selected,
  onChange,
  emptyLabel = "Nenhum item disponível",
}: {
  items: Array<{ id: string; nome: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
}) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
      {items.map((item) => {
        const checked = selected.includes(item.id);
        return (
          <label key={item.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={checked}
              onCheckedChange={() => onChange(toggleId(selected, item.id))}
            />
            <span>{item.nome}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function PromocoesAdmin() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [promocoes, setPromocoes] = useState<Promocao[]>([]);
  const [produtos, setProdutos] = useState<ProdutoOpt[]>([]);
  const [categorias, setCategorias] = useState<CategoriaOpt[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [condicaoTipoAdd, setCondicaoTipoAdd] = useState<CondicaoTipo>("valor_minimo");

  const loadData = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [promoRes, prodRes, catRes] = await Promise.all([
      sb.from("promocoes").select("*").eq("owner_id", user.id).order("prioridade", { ascending: false }).order("criado_em", { ascending: false }),
      sb.from("produtos").select("id, nome, categoria_id").order("nome"),
      sb.from("categorias").select("id, nome").order("nome"),
    ]);
    setLoading(false);

    if (promoRes.error || prodRes.error || catRes.error) {
      return toast.error(
        promoRes.error?.message || prodRes.error?.message || catRes.error?.message || "Erro ao carregar promoções",
      );
    }

    const rows = (promoRes.data || []) as Record<string, unknown>[];
    setPromocoes(
      rows.map((row) => ({
        id: String(row.id),
        owner_id: String(row.owner_id),
        nome: String(row.nome || ""),
        descricao: (row.descricao as string | null) ?? null,
        tipo: row.tipo as PromocaoTipo,
        ativo: Boolean(row.ativo),
        prioridade: Number(row.prioridade || 0),
        aplica_automaticamente: row.aplica_automaticamente !== false,
        necessita_cupom: Boolean(row.necessita_cupom),
        codigo_cupom: (row.codigo_cupom as string | null) ?? null,
        data_inicio: (row.data_inicio as string | null) ?? null,
        data_fim: (row.data_fim as string | null) ?? null,
        hora_inicio: row.hora_inicio != null ? String(row.hora_inicio).slice(0, 8) : null,
        hora_fim: row.hora_fim != null ? String(row.hora_fim).slice(0, 8) : null,
        dias_semana: parseDiasSemana(row.dias_semana),
        limite_usos_total: row.limite_usos_total != null ? Number(row.limite_usos_total) : null,
        usos_realizados: Number(row.usos_realizados || 0),
        limite_por_cliente: row.limite_por_cliente != null ? Number(row.limite_por_cliente) : null,
        condicoes: (Array.isArray(row.condicoes) ? row.condicoes : []) as PromocaoCondicao[],
        acao: (row.acao || {}) as PromocaoAcao,
        escopo_produtos: { ...emptyEscopo(), ...((row.escopo_produtos || {}) as Partial<EscopoProdutos>) },
        criado_em: row.criado_em as string | undefined,
        atualizado_em: row.atualizado_em as string | undefined,
      })),
    );
    setProdutos((prodRes.data || []) as ProdutoOpt[]);
    setCategorias((catRes.data || []) as CategoriaOpt[]);
  }, [user?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const previewText = useMemo(
    () =>
      gerarPreviewPromocao({
        nome: form.nome,
        tipo: form.tipo,
        acao: form.acao,
        condicoes: form.condicoes,
      }),
    [form.acao, form.condicoes, form.nome, form.tipo],
  );

  const patchForm = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const patchAcao = (updater: (acao: PromocaoAcao) => PromocaoAcao) => {
    setForm((current) => ({ ...current, acao: updater(current.acao) }));
  };

  const patchEscopo = (patch: Partial<EscopoProdutos>) => {
    setForm((current) => ({
      ...current,
      escopo_produtos: { ...current.escopo_produtos, ...patch },
    }));
  };

  const onTipoChange = (tipo: PromocaoTipo) => {
    setForm((current) => ({
      ...current,
      tipo,
      acao: emptyAcaoForTipo(tipo),
      necessita_cupom: tipo === "cupom" ? true : current.necessita_cupom,
      aplica_automaticamente: tipo === "cupom" ? false : current.aplica_automaticamente,
      codigo_cupom: tipo === "cupom" && !current.codigo_cupom ? current.codigo_cupom : current.codigo_cupom,
    }));
  };

  const fillFormFromPromo = (promo: Promocao, opts?: { duplicate?: boolean }) => {
    setForm({
      nome: opts?.duplicate ? `${promo.nome} (cópia)` : promo.nome,
      descricao: promo.descricao || "",
      tipo: promo.tipo,
      ativo: promo.ativo,
      prioridade: String(promo.prioridade ?? 0),
      data_inicio: promo.data_inicio || "",
      data_fim: promo.data_fim || "",
      hora_inicio: timeInputValue(promo.hora_inicio),
      hora_fim: timeInputValue(promo.hora_fim),
      dias_semana: parseDiasSemana(promo.dias_semana),
      limite_usos_total: promo.limite_usos_total == null ? "" : String(promo.limite_usos_total),
      ilimitado: promo.limite_usos_total == null,
      limite_por_cliente: promo.limite_por_cliente == null ? "" : String(promo.limite_por_cliente),
      aplica_automaticamente: promo.aplica_automaticamente,
      necessita_cupom: promo.necessita_cupom,
      codigo_cupom: promo.codigo_cupom || "",
      condicoes: Array.isArray(promo.condicoes) ? promo.condicoes.map((c) => ({ ...c, params: { ...(c.params || {}) } })) : [],
      acao: { ...(promo.acao || emptyAcaoForTipo(promo.tipo)) },
      escopo_produtos: { ...emptyEscopo(), ...(promo.escopo_produtos || {}) },
    });
  };

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (promo: Promocao) => {
    setEditId(promo.id);
    fillFormFromPromo(promo);
    setFormOpen(true);
  };

  const openDuplicate = (promo: Promocao) => {
    setEditId(null);
    fillFormFromPromo(promo, { duplicate: true });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditId(null);
    setForm(emptyForm());
  };

  const toggleDia = (dia: number) => {
    setForm((current) => {
      const has = current.dias_semana.includes(dia);
      const next = has ? current.dias_semana.filter((d) => d !== dia) : [...current.dias_semana, dia].sort((a, b) => a - b);
      return { ...current, dias_semana: next.length ? next : [dia] };
    });
  };

  const addCondicao = () => {
    setForm((current) => ({
      ...current,
      condicoes: [
        ...current.condicoes,
        { tipo: condicaoTipoAdd, params: emptyCondicaoParams(condicaoTipoAdd) },
      ],
    }));
  };

  const removeCondicao = (index: number) => {
    setForm((current) => ({
      ...current,
      condicoes: current.condicoes.filter((_, i) => i !== index),
    }));
  };

  const updateCondicaoParams = (index: number, params: Record<string, unknown>) => {
    setForm((current) => ({
      ...current,
      condicoes: current.condicoes.map((cond, i) => (i === index ? { ...cond, params } : cond)),
    }));
  };

  const savePromocao = async () => {
    if (!user?.id) return toast.error("Faça login para salvar promoções");

    const nome = form.nome.trim();
    if (!nome) return toast.error("Informe o nome da promoção");
    if (!form.dias_semana.length) return toast.error("Selecione ao menos um dia da semana");
    if (!form.ilimitado && !form.limite_usos_total.trim()) {
      return toast.error("Informe o limite de usos ou marque ilimitado");
    }

    const necessitaCupom = form.tipo === "cupom" ? true : form.necessita_cupom;
    const codigo = necessitaCupom ? form.codigo_cupom.trim().toUpperCase() : null;
    if (necessitaCupom && !codigo) return toast.error("Informe o código do cupom");

    if (form.tipo === "compre_x_leve_y") {
      const cx = form.acao.compre_x_leve_y;
      if (!cx?.produto_id || !cx?.produto_bonus_id) {
        return toast.error("Selecione os produtos da promoção Compre X Leve Y");
      }
    }

    if (form.tipo === "brinde" || (form.tipo === "cupom" && form.acao.cupom_modo === "brinde")) {
      if (!form.acao.brinde?.produto_ids?.length) {
        return toast.error("Selecione ao menos um produto de brinde");
      }
    }

    if (form.tipo === "combo" && !form.acao.combo?.itens?.length) {
      return toast.error("Adicione itens ao combo");
    }

    if (form.tipo === "desconto_categoria" && !form.acao.desconto_categoria?.categoria_ids?.length) {
      return toast.error("Selecione ao menos uma categoria");
    }

    if (form.tipo === "desconto_produto" && !form.acao.desconto_produto?.produto_ids?.length) {
      return toast.error("Selecione ao menos um produto");
    }

    if (form.tipo === "leve_mais_pague_menos" && !form.acao.leve_mais?.faixas?.length) {
      return toast.error("Adicione ao menos uma faixa de preço");
    }

    const expired = Boolean(form.data_fim && form.data_fim < todayKey());
    const payload = {
      owner_id: user.id,
      nome,
      descricao: form.descricao.trim() || null,
      tipo: form.tipo,
      ativo: expired ? false : form.ativo,
      prioridade: Number.parseInt(form.prioridade, 10) || 0,
      aplica_automaticamente: form.tipo === "cupom" ? false : form.aplica_automaticamente,
      necessita_cupom: necessitaCupom,
      codigo_cupom: codigo,
      data_inicio: form.data_inicio || null,
      data_fim: form.data_fim || null,
      hora_inicio: timePayload(form.hora_inicio),
      hora_fim: timePayload(form.hora_fim),
      dias_semana: parseDiasSemana(form.dias_semana),
      limite_usos_total: form.ilimitado ? null : Number.parseInt(form.limite_usos_total, 10),
      limite_por_cliente: form.limite_por_cliente.trim()
        ? Number.parseInt(form.limite_por_cliente, 10)
        : null,
      condicoes: form.condicoes,
      acao: form.acao,
      escopo_produtos: form.escopo_produtos,
    };

    setBusy(true);
    const query = editId
      ? sb.from("promocoes").update(payload).eq("id", editId).eq("owner_id", user.id)
      : sb.from("promocoes").insert(payload);
    const { error } = await query;
    setBusy(false);

    if (error) return toast.error(error.message);

    invalidatePromocoesCache(user.id);
    toast.success(editId ? "Promoção atualizada" : "Promoção criada");
    closeForm();
    await loadData();
  };

  const toggleAtivo = async (promo: Promocao) => {
    if (!user?.id) return;
    if (isExpired(promo)) return toast.error("Promoção expirada não pode ser reativada");

    const { error } = await sb
      .from("promocoes")
      .update({ ativo: !promo.ativo })
      .eq("id", promo.id)
      .eq("owner_id", user.id);

    if (error) return toast.error(error.message);

    invalidatePromocoesCache(user.id);
    toast.success(promo.ativo ? "Promoção desativada" : "Promoção ativada");
    await loadData();
  };

  const removePromocao = async (promo: Promocao) => {
    if (!user?.id) return;
    if (!window.confirm(`Excluir a promoção "${promo.nome}"?`)) return;

    const { error } = await sb.from("promocoes").delete().eq("id", promo.id).eq("owner_id", user.id);
    if (error) return toast.error(error.message);

    invalidatePromocoesCache(user.id);
    toast.success("Promoção excluída");
    await loadData();
  };

  const renderCondicaoFields = (cond: PromocaoCondicao, index: number) => {
    const params = (cond.params || {}) as Record<string, unknown>;
    const setParams = (next: Record<string, unknown>) => updateCondicaoParams(index, next);

    switch (cond.tipo) {
      case "valor_minimo":
      case "valor_maximo":
      case "pedido_acima":
        return (
          <div className="space-y-1">
            <Label>Valor (R$)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={String(params.valor ?? "")}
              onChange={(e) => setParams({ ...params, valor: Number(e.target.value) || 0 })}
            />
          </div>
        );
      case "qtd_min_itens":
      case "qtd_max_itens":
        return (
          <div className="space-y-1">
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={0}
              step="1"
              value={String(params.quantidade ?? params.valor ?? "")}
              onChange={(e) => setParams({ ...params, quantidade: Number.parseInt(e.target.value, 10) || 0 })}
            />
          </div>
        );
      case "categoria":
        return (
          <div className="space-y-1">
            <Label>Categorias</Label>
            <MultiCheckList
              items={categorias}
              selected={(params.categoria_ids as string[]) || []}
              onChange={(categoria_ids) => setParams({ ...params, categoria_ids })}
            />
          </div>
        );
      case "produto":
      case "excluir_produto":
      case "contem_produto":
      case "nao_contem_produto":
        return (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Produtos</Label>
              <MultiCheckList
                items={produtos}
                selected={(params.produto_ids as string[]) || []}
                onChange={(produto_ids) => setParams({ ...params, produto_ids })}
              />
            </div>
            {cond.tipo === "contem_produto" && (
              <div className="space-y-1">
                <Label>Qtd. mínima</Label>
                <Input
                  type="number"
                  min={1}
                  value={String(params.qtd_min ?? 1)}
                  onChange={(e) => setParams({ ...params, qtd_min: Number.parseInt(e.target.value, 10) || 1 })}
                />
              </div>
            )}
          </div>
        );
      case "tipo_entrega":
        return (
          <div className="space-y-2">
            <Label>Tipos de entrega</Label>
            {(["delivery", "retirada"] as const).map((valor) => {
              const valores = ((params.valores as string[]) || []);
              const checked = valores.includes(valor);
              return (
                <label key={valor} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => setParams({ ...params, valores: toggleId(valores, valor) })}
                  />
                  {valor === "delivery" ? "Delivery" : "Retirada"}
                </label>
              );
            })}
          </div>
        );
      case "forma_pagamento":
        return (
          <div className="space-y-1">
            <Label>Formas de pagamento (separadas por vírgula)</Label>
            <Input
              value={Array.isArray(params.valores) ? (params.valores as string[]).join(", ") : ""}
              onChange={(e) =>
                setParams({
                  ...params,
                  valores: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
              placeholder="pix, dinheiro, cartao"
            />
          </div>
        );
      case "cliente_vip":
        return (
          <div className="space-y-1">
            <Label>Mínimo de pedidos</Label>
            <Input
              type="number"
              min={1}
              value={String(params.min_pedidos ?? params.n ?? 5)}
              onChange={(e) => setParams({ ...params, min_pedidos: Number.parseInt(e.target.value, 10) || 5 })}
            />
          </div>
        );
      case "cidade":
      case "bairro":
        return (
          <div className="space-y-1">
            <Label>Nomes (separados por vírgula)</Label>
            <Input
              value={Array.isArray(params.nomes) ? (params.nomes as string[]).join(", ") : String(params.nome || "")}
              onChange={(e) =>
                setParams({
                  ...params,
                  nomes: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Centro, Jardim América"
            />
          </div>
        );
      case "qtd_pedidos_anteriores":
        return (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Mínimo</Label>
              <Input
                type="number"
                min={0}
                value={params.min != null ? String(params.min) : ""}
                onChange={(e) =>
                  setParams({
                    ...params,
                    min: e.target.value === "" ? undefined : Number.parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Máximo</Label>
              <Input
                type="number"
                min={0}
                value={params.max != null ? String(params.max) : ""}
                onChange={(e) =>
                  setParams({
                    ...params,
                    max: e.target.value === "" ? undefined : Number.parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Igual a</Label>
              <Input
                type="number"
                min={0}
                value={params.igual != null ? String(params.igual) : ""}
                onChange={(e) =>
                  setParams({
                    ...params,
                    igual: e.target.value === "" ? undefined : Number.parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </div>
          </div>
        );
      case "primeiro_pedido":
      case "cliente_novo":
        return <p className="text-sm text-muted-foreground">Sem parâmetros adicionais.</p>;
      default:
        return null;
    }
  };

  const renderFreteFields = () => {
    const frete = form.acao.frete || { modo: "gratis" as const };
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Modo do frete</Label>
          <Select
            value={frete.modo || "gratis"}
            onValueChange={(modo: "gratis" | "ate_valor") =>
              patchAcao((acao) => ({ ...acao, frete: { ...frete, modo } }))
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="gratis">Frete grátis</SelectItem>
              <SelectItem value="ate_valor">Subsídio até valor</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {frete.modo === "ate_valor" && (
          <div className="space-y-2">
            <Label>Valor máximo (R$)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={String(frete.valor_max ?? "")}
              onChange={(e) =>
                patchAcao((acao) => ({
                  ...acao,
                  frete: { ...frete, valor_max: Number(e.target.value) || 0 },
                }))
              }
            />
          </div>
        )}
      </div>
    );
  };

  const renderBrindeFields = () => {
    const brinde = form.acao.brinde || { produto_ids: [], qtd: 1 };
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label>Produtos de brinde</Label>
          <MultiCheckList
            items={produtos}
            selected={brinde.produto_ids || []}
            onChange={(produto_ids) => patchAcao((acao) => ({ ...acao, brinde: { ...brinde, produto_ids } }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Quantidade</Label>
          <Input
            type="number"
            min={1}
            value={String(brinde.qtd ?? 1)}
            onChange={(e) =>
              patchAcao((acao) => ({
                ...acao,
                brinde: { ...brinde, qtd: Number.parseInt(e.target.value, 10) || 1 },
              }))
            }
          />
        </div>
      </div>
    );
  };

  const renderPercentualFields = (withTeto = true) => (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Percentual (%)</Label>
        <Input
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={String(form.acao.percentual ?? "")}
          onChange={(e) => patchAcao((acao) => ({ ...acao, percentual: Number(e.target.value) || 0 }))}
        />
      </div>
      {withTeto && (
        <div className="space-y-2">
          <Label>Teto do desconto (opcional)</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.acao.teto != null ? String(form.acao.teto) : ""}
            onChange={(e) =>
              patchAcao((acao) => ({
                ...acao,
                teto: e.target.value === "" ? undefined : Number(e.target.value) || 0,
              }))
            }
            placeholder="Sem teto"
          />
        </div>
      )}
    </div>
  );

  const renderAcaoFields = () => {
    switch (form.tipo) {
      case "desconto_percentual":
        return renderPercentualFields(true);

      case "desconto_fixo":
        return (
          <div className="space-y-2">
            <Label>Valor fixo (R$)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={String(form.acao.valor_fixo ?? "")}
              onChange={(e) => patchAcao((acao) => ({ ...acao, valor_fixo: Number(e.target.value) || 0 }))}
            />
          </div>
        );

      case "frete_gratis":
        return renderFreteFields();

      case "compre_x_leve_y": {
        const cx = form.acao.compre_x_leve_y || {
          produto_id: "",
          qtd_compra: 2,
          produto_bonus_id: "",
          qtd_bonus: 1,
        };
        return (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Produto obrigatório</Label>
              <Select
                value={cx.produto_id || "none"}
                onValueChange={(produto_id) =>
                  patchAcao((acao) => ({
                    ...acao,
                    compre_x_leve_y: { ...cx, produto_id: produto_id === "none" ? "" : produto_id },
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione</SelectItem>
                  {produtos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Qtd. compra</Label>
              <Input
                type="number"
                min={1}
                value={String(cx.qtd_compra ?? 2)}
                onChange={(e) =>
                  patchAcao((acao) => ({
                    ...acao,
                    compre_x_leve_y: { ...cx, qtd_compra: Number.parseInt(e.target.value, 10) || 1 },
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Produto bônus</Label>
              <Select
                value={cx.produto_bonus_id || "none"}
                onValueChange={(produto_bonus_id) =>
                  patchAcao((acao) => ({
                    ...acao,
                    compre_x_leve_y: {
                      ...cx,
                      produto_bonus_id: produto_bonus_id === "none" ? "" : produto_bonus_id,
                    },
                  }))
                }
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione</SelectItem>
                  {produtos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Qtd. bônus</Label>
              <Input
                type="number"
                min={1}
                value={String(cx.qtd_bonus ?? 1)}
                onChange={(e) =>
                  patchAcao((acao) => ({
                    ...acao,
                    compre_x_leve_y: { ...cx, qtd_bonus: Number.parseInt(e.target.value, 10) || 1 },
                  }))
                }
              />
            </div>
          </div>
        );
      }

      case "brinde":
        return renderBrindeFields();

      case "combo": {
        const combo = form.acao.combo || { itens: [], preco: 0 };
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Itens do combo</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchAcao((acao) => ({
                      ...acao,
                      combo: {
                        ...combo,
                        itens: [...(combo.itens || []), { produto_id: produtos[0]?.id || "", qtd: 1 }],
                      },
                    }))
                  }
                >
                  <Plus className="mr-1 h-3 w-3" /> Item
                </Button>
              </div>
              <div className="space-y-2">
                {(combo.itens || []).map((item, index) => (
                  <div key={`${item.produto_id}-${index}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_100px_auto]">
                    <Select
                      value={item.produto_id || "none"}
                      onValueChange={(produto_id) =>
                        patchAcao((acao) => {
                          const itens = [...(combo.itens || [])];
                          itens[index] = { ...itens[index], produto_id: produto_id === "none" ? "" : produto_id };
                          return { ...acao, combo: { ...combo, itens } };
                        })
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Produto" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Selecione</SelectItem>
                        {produtos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={1}
                      value={String(item.qtd ?? 1)}
                      onChange={(e) =>
                        patchAcao((acao) => {
                          const itens = [...(combo.itens || [])];
                          itens[index] = { ...itens[index], qtd: Number.parseInt(e.target.value, 10) || 1 };
                          return { ...acao, combo: { ...combo, itens } };
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        patchAcao((acao) => ({
                          ...acao,
                          combo: { ...combo, itens: (combo.itens || []).filter((_, i) => i !== index) },
                        }))
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Preço do combo (R$)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={String(combo.preco ?? 0)}
                onChange={(e) =>
                  patchAcao((acao) => ({
                    ...acao,
                    combo: { ...combo, preco: Number(e.target.value) || 0 },
                  }))
                }
              />
            </div>
          </div>
        );
      }

      case "desconto_categoria": {
        const dc = form.acao.desconto_categoria || { categoria_ids: [], percentual: 20 };
        return (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Categorias</Label>
              <MultiCheckList
                items={categorias}
                selected={dc.categoria_ids || []}
                onChange={(categoria_ids) =>
                  patchAcao((acao) => ({ ...acao, desconto_categoria: { ...dc, categoria_ids } }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Percentual (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={String(dc.percentual ?? 20)}
                onChange={(e) =>
                  patchAcao((acao) => ({
                    ...acao,
                    desconto_categoria: { ...dc, percentual: Number(e.target.value) || 0 },
                  }))
                }
              />
            </div>
          </div>
        );
      }

      case "desconto_produto": {
        const dp = form.acao.desconto_produto || { produto_ids: [], percentual: 15 };
        const modo = dp.valor_fixo != null && dp.percentual == null ? "fixo" : "percentual";
        return (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Produtos</Label>
              <MultiCheckList
                items={produtos}
                selected={dp.produto_ids || []}
                onChange={(produto_ids) =>
                  patchAcao((acao) => ({ ...acao, desconto_produto: { ...dp, produto_ids } }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo de desconto</Label>
                <Select
                  value={modo}
                  onValueChange={(value) =>
                    patchAcao((acao) => ({
                      ...acao,
                      desconto_produto: {
                        ...dp,
                        percentual: value === "percentual" ? (dp.percentual ?? 15) : undefined,
                        valor_fixo: value === "fixo" ? (dp.valor_fixo ?? 5) : undefined,
                      },
                    }))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentual">Percentual</SelectItem>
                    <SelectItem value="fixo">Valor fixo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {modo === "percentual" ? (
                <div className="space-y-2">
                  <Label>Percentual (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={String(dp.percentual ?? "")}
                    onChange={(e) =>
                      patchAcao((acao) => ({
                        ...acao,
                        desconto_produto: {
                          ...dp,
                          percentual: Number(e.target.value) || 0,
                          valor_fixo: undefined,
                        },
                      }))
                    }
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Valor fixo (R$)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={String(dp.valor_fixo ?? "")}
                    onChange={(e) =>
                      patchAcao((acao) => ({
                        ...acao,
                        desconto_produto: {
                          ...dp,
                          valor_fixo: Number(e.target.value) || 0,
                          percentual: undefined,
                        },
                      }))
                    }
                  />
                </div>
              )}
            </div>
          </div>
        );
      }

      case "leve_mais_pague_menos": {
        const lm = form.acao.leve_mais || { produto_ids: [], categoria_ids: [], faixas: [{ qtd: 2, preco: 50 }] };
        return (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Filtrar produtos (opcional)</Label>
                <MultiCheckList
                  items={produtos}
                  selected={lm.produto_ids || []}
                  onChange={(produto_ids) =>
                    patchAcao((acao) => ({ ...acao, leve_mais: { ...lm, produto_ids } }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Filtrar categorias (opcional)</Label>
                <MultiCheckList
                  items={categorias}
                  selected={lm.categoria_ids || []}
                  onChange={(categoria_ids) =>
                    patchAcao((acao) => ({ ...acao, leve_mais: { ...lm, categoria_ids } }))
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Faixas</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchAcao((acao) => ({
                      ...acao,
                      leve_mais: {
                        ...lm,
                        faixas: [...(lm.faixas || []), { qtd: 3, preco: 70 }],
                      },
                    }))
                  }
                >
                  <Plus className="mr-1 h-3 w-3" /> Faixa
                </Button>
              </div>
              {(lm.faixas || []).map((faixa, index) => (
                <div key={index} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1">
                    <Label>Quantidade</Label>
                    <Input
                      type="number"
                      min={1}
                      value={String(faixa.qtd)}
                      onChange={(e) =>
                        patchAcao((acao) => {
                          const faixas = [...(lm.faixas || [])];
                          faixas[index] = { ...faixas[index], qtd: Number.parseInt(e.target.value, 10) || 1 };
                          return { ...acao, leve_mais: { ...lm, faixas } };
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Preço (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(faixa.preco)}
                      onChange={(e) =>
                        patchAcao((acao) => {
                          const faixas = [...(lm.faixas || [])];
                          faixas[index] = { ...faixas[index], preco: Number(e.target.value) || 0 };
                          return { ...acao, leve_mais: { ...lm, faixas } };
                        })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="self-end"
                    onClick={() =>
                      patchAcao((acao) => ({
                        ...acao,
                        leve_mais: { ...lm, faixas: (lm.faixas || []).filter((_, i) => i !== index) },
                      }))
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      }

      case "pontos":
        return (
          <div className="space-y-2">
            <Label>Pontos extras</Label>
            <Input
              type="number"
              min={1}
              value={String(form.acao.pontos?.extra ?? 10)}
              onChange={(e) =>
                patchAcao((acao) => ({
                  ...acao,
                  pontos: { extra: Number.parseInt(e.target.value, 10) || 1 },
                }))
              }
            />
          </div>
        );

      case "cupom": {
        const modo = form.acao.cupom_modo || "percentual";
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Modo do cupom</Label>
              <Select
                value={modo}
                onValueChange={(cupom_modo: "percentual" | "fixo" | "frete_gratis" | "brinde") => {
                  const base = emptyAcaoForTipo(
                    cupom_modo === "fixo"
                      ? "desconto_fixo"
                      : cupom_modo === "frete_gratis"
                        ? "frete_gratis"
                        : cupom_modo === "brinde"
                          ? "brinde"
                          : "desconto_percentual",
                  );
                  patchAcao(() => ({ ...base, cupom_modo }));
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentual">Percentual</SelectItem>
                  <SelectItem value="fixo">Fixo</SelectItem>
                  <SelectItem value="frete_gratis">Frete grátis</SelectItem>
                  <SelectItem value="brinde">Brinde</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {modo === "percentual" && renderPercentualFields(true)}
            {modo === "fixo" && (
              <div className="space-y-2">
                <Label>Valor fixo (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={String(form.acao.valor_fixo ?? "")}
                  onChange={(e) => patchAcao((acao) => ({ ...acao, valor_fixo: Number(e.target.value) || 0 }))}
                />
              </div>
            )}
            {modo === "frete_gratis" && renderFreteFields()}
            {modo === "brinde" && renderBrindeFields()}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display flex items-center gap-3 text-5xl text-foreground">
            <Megaphone className="h-8 w-8 text-primary" /> Criar promoções
          </h1>
          <p className="mt-1 text-muted-foreground">
            Campanhas automáticas para delivery — não acumulam entre si
          </p>
        </div>
        <Button onClick={openCreate}>
          <CopyPlus className="mr-2 h-4 w-4" /> Nova promoção
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Usos</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Carregando promoções...
                </TableCell>
              </TableRow>
            ) : promocoes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Nenhuma promoção cadastrada.
                </TableCell>
              </TableRow>
            ) : (
              promocoes.map((promo) => {
                const status = statusInfo(promo);
                const usosLabel = `${promo.usos_realizados}/${promo.limite_usos_total == null ? "∞" : promo.limite_usos_total}`;
                return (
                  <TableRow key={promo.id}>
                    <TableCell className="font-semibold">{promo.nome}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{PROMOCAO_TIPO_LABELS[promo.tipo]}</Badge>
                    </TableCell>
                    <TableCell>{promo.prioridade}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={status.className}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell>{usosLabel}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => openEdit(promo)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Ativar/desativar" onClick={() => void toggleAtivo(promo)}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Duplicar" onClick={() => openDuplicate(promo)}>
                          <CopyPlus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:text-destructive"
                          title="Excluir"
                          onClick={() => void removePromocao(promo)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
          else setFormOpen(true);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar promoção" : "Nova promoção"}</DialogTitle>
            <DialogDescription>
              Escolha o tipo e configure apenas os campos necessários. A prévia atualiza em tempo real.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <Card className="border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prévia</p>
              <p className="mt-1 text-sm">{previewText}</p>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Tipo da promoção</Label>
                <Select value={form.tipo} onValueChange={(value: PromocaoTipo) => onTipoChange(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROMOCAO_TIPOS.map((tipo) => (
                      <SelectItem key={tipo} value={tipo}>
                        {PROMOCAO_TIPO_LABELS[tipo]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => patchForm({ nome: e.target.value })}
                  placeholder="Ex.: Frete grátis sexta"
                />
              </div>

              <div className="space-y-2">
                <Label>Prioridade</Label>
                <Input
                  type="number"
                  value={form.prioridade}
                  onChange={(e) => patchForm({ prioridade: e.target.value })}
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Descrição</Label>
                <Textarea
                  value={form.descricao}
                  onChange={(e) => patchForm({ descricao: e.target.value })}
                  placeholder="Uso interno"
                  rows={2}
                />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Ação ({PROMOCAO_TIPO_LABELS[form.tipo]})</h3>
              {renderAcaoFields()}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Data início</Label>
                <Input
                  type="date"
                  value={form.data_inicio}
                  onChange={(e) => patchForm({ data_inicio: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Data fim</Label>
                <Input
                  type="date"
                  value={form.data_fim}
                  onChange={(e) => patchForm({ data_fim: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora início</Label>
                <Input
                  type="time"
                  value={form.hora_inicio}
                  onChange={(e) => patchForm({ hora_inicio: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora fim</Label>
                <Input
                  type="time"
                  value={form.hora_fim}
                  onChange={(e) => patchForm({ hora_fim: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Dias da semana</Label>
              <div className="flex flex-wrap gap-3">
                {DIAS_SEMANA.map((dia) => (
                  <label key={dia.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.dias_semana.includes(dia.value)}
                      onCheckedChange={() => toggleDia(dia.value)}
                    />
                    {dia.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Limite de usos total</Label>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.ilimitado}
                    onCheckedChange={(ilimitado) => patchForm({ ilimitado })}
                  />
                  <span className="text-sm text-muted-foreground">Ilimitado</span>
                </div>
                {!form.ilimitado && (
                  <Input
                    type="number"
                    min={1}
                    value={form.limite_usos_total}
                    onChange={(e) => patchForm({ limite_usos_total: e.target.value })}
                    placeholder="Ex.: 100"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Limite por cliente</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.limite_por_cliente}
                  onChange={(e) => patchForm({ limite_por_cliente: e.target.value })}
                  placeholder="Opcional"
                />
              </div>

              <div className="space-y-2">
                <Label>Ativo</Label>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.ativo}
                    disabled={Boolean(form.data_fim) && form.data_fim < todayKey()}
                    onCheckedChange={(ativo) => patchForm({ ativo })}
                  />
                  <span className="text-sm text-muted-foreground">
                    {form.ativo ? "Disponível no delivery" : "Fora de uso"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Aplicação automática</Label>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.aplica_automaticamente}
                    disabled={form.tipo === "cupom"}
                    onCheckedChange={(aplica_automaticamente) => patchForm({ aplica_automaticamente })}
                  />
                  <span className="text-sm text-muted-foreground">Aplica sem código</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Necessita cupom</Label>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.necessita_cupom || form.tipo === "cupom"}
                    disabled={form.tipo === "cupom"}
                    onCheckedChange={(necessita_cupom) =>
                      patchForm({
                        necessita_cupom,
                        codigo_cupom: necessita_cupom ? form.codigo_cupom : "",
                      })
                    }
                  />
                  <span className="text-sm text-muted-foreground">Exige código no checkout</span>
                </div>
              </div>

              {(form.necessita_cupom || form.tipo === "cupom") && (
                <div className="space-y-2">
                  <Label>Código do cupom</Label>
                  <Input
                    value={form.codigo_cupom}
                    onChange={(e) => patchForm({ codigo_cupom: e.target.value.toUpperCase() })}
                    placeholder="PROMO10"
                    className="uppercase"
                  />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Escopo de produtos</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Modo</Label>
                  <Select
                    value={form.escopo_produtos.modo}
                    onValueChange={(modo: EscopoProdutos["modo"]) => patchEscopo({ modo })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="categorias">Categorias</SelectItem>
                      <SelectItem value="produtos">Produtos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.escopo_produtos.modo === "categorias" && (
                <div className="space-y-2">
                  <Label>Categorias incluídas</Label>
                  <MultiCheckList
                    items={categorias}
                    selected={form.escopo_produtos.categoria_ids}
                    onChange={(categoria_ids) => patchEscopo({ categoria_ids })}
                  />
                </div>
              )}

              {form.escopo_produtos.modo === "produtos" && (
                <div className="space-y-2">
                  <Label>Produtos incluídos</Label>
                  <MultiCheckList
                    items={produtos}
                    selected={form.escopo_produtos.produto_ids}
                    onChange={(produto_ids) => patchEscopo({ produto_ids })}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Excluir produtos (opcional)</Label>
                <MultiCheckList
                  items={produtos}
                  selected={form.escopo_produtos.excluir_produto_ids}
                  onChange={(excluir_produto_ids) => patchEscopo({ excluir_produto_ids })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold">Condições</h3>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1 space-y-2">
                  <Label>Adicionar condição</Label>
                  <Select value={condicaoTipoAdd} onValueChange={(v: CondicaoTipo) => setCondicaoTipoAdd(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONDICAO_TIPOS.map((tipo) => (
                        <SelectItem key={tipo} value={tipo}>
                          {CONDICAO_TIPO_LABELS[tipo]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="outline" onClick={addCondicao}>
                  <Plus className="mr-2 h-4 w-4" /> Adicionar
                </Button>
              </div>

              {form.condicoes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma condição — a promoção vale para qualquer pedido elegível.</p>
              ) : (
                <div className="space-y-3">
                  {form.condicoes.map((cond, index) => (
                    <Card key={`${cond.tipo}-${index}`} className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{CONDICAO_TIPO_LABELS[cond.tipo as CondicaoTipo] || cond.tipo}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeCondicao(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {renderCondicaoFields(cond, index)}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancelar</Button>
            <Button onClick={() => void savePromocao()} disabled={busy}>
              {busy ? "Salvando..." : "Salvar promoção"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
