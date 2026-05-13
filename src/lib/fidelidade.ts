import type { Cliente, Produto, Recompensa, Resgate } from "@/types/db";

export interface ResgatePendenteComRecompensa {
  id: string;
  recompensa_id: string;
  pedido_id: string | null;
  status: Resgate["status"];
  nome: string;
  descricao: string | null;
  tipo: Recompensa["tipo"];
  valor: number;
  produto_id: string | null;
}

export interface FidelidadeLookupResult {
  cliente: Cliente | null;
  resgates_pendentes: ResgatePendenteComRecompensa[];
}

export interface BeneficioRecompensa {
  desconto: number;
  itemGratis: Produto | null;
  descricao: string;
}

export const normalizePhone = (value: string) => value.replace(/\D/g, "").slice(0, 16);

export const isRewardAvailable = (reward: Recompensa, totalPedidos: number) =>
  totalPedidos >= reward.pedidos_necessarios;

export const rewardProgress = (reward: Recompensa, totalPedidos: number) => {
  const atual = Math.min(totalPedidos, reward.pedidos_necessarios);
  const faltam = Math.max(reward.pedidos_necessarios - totalPedidos, 0);
  const percentual = Math.min((totalPedidos / reward.pedidos_necessarios) * 100, 100);

  return {
    atual,
    faltam,
    percentual,
  };
};

export const nextReward = (rewards: Recompensa[], totalPedidos: number) =>
  [...rewards]
    .filter((reward) => reward.ativo && reward.pedidos_necessarios > totalPedidos)
    .sort((left, right) => left.pedidos_necessarios - right.pedidos_necessarios || left.ordem - right.ordem)[0] ?? null;

export const describeReward = (reward: Recompensa, product?: Produto | null) => {
  if (reward.tipo === "item_gratis") {
    return product ? `1x ${product.nome} gratis` : "Item gratis";
  }

  if (reward.tipo === "desconto_percentual") {
    return `${Number(reward.valor)}% de desconto`;
  }

  return `Desconto de R$ ${Number(reward.valor).toFixed(2)}`;
};

export const calculateRewardBenefit = (
  reward: Recompensa,
  subtotal: number,
  products: Produto[]
): BeneficioRecompensa => {
  if (reward.tipo === "item_gratis") {
    const itemGratis = products.find((product) => product.id === reward.produto_id) ?? null;
    return {
      desconto: 0,
      itemGratis,
      descricao: describeReward(reward, itemGratis),
    };
  }

  if (reward.tipo === "desconto_percentual") {
    const desconto = Math.max(Math.min(subtotal * (Number(reward.valor) / 100), subtotal), 0);
    return {
      desconto,
      itemGratis: null,
      descricao: describeReward(reward),
    };
  }

  const desconto = Math.max(Math.min(Number(reward.valor), subtotal), 0);
  return {
    desconto,
    itemGratis: null,
    descricao: describeReward(reward),
  };
};