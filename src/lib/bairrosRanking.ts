import { totalPedidoDelivery } from "@/lib/faturamento";

export interface PedidoBairroInput {
  id: string;
  tipo_entrega: string | null;
  total: number | null;
  subtotal: number | null;
  desconto: number | null;
  valor_desconto: number | null;
}

export interface EntregaBairroInput {
  pedido_id: string;
  bairro: string | null;
  taxa_entrega: number | null;
}

export interface BairroRankingLinha {
  /** Chave normalizada (sem acento, minúscula, espaços únicos). */
  chave: string;
  /** Grafia mais usada nos pedidos, para exibir. */
  nome: string;
  pedidos: number;
  faturamento: number;
}

export interface BairrosRanking {
  bairros: BairroRankingLinha[];
  /** Entregas sem bairro preenchido (pedidos antigos ou digitados sem bairro). */
  semBairro: { pedidos: number; faturamento: number };
}

/** Limpa espaços da grafia original, mantendo maiúsculas e acentos. */
const limparEspacos = (value: string) => value.replace(/\s+/g, " ").trim();

/** Agrupa "Centro", " centro ", "CENTRO" e "Céntro" na mesma chave. */
export function normalizarBairro(value?: string | null): string {
  return limparEspacos(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const arredondar = (valor: number) => Number(valor.toFixed(2));

/**
 * Ranking de bairros por número de pedidos (desempate pelo faturamento).
 * Só entram pedidos de entrega: retirada no balcão e mesa ficam de fora, e
 * entregas sem bairro vão para `semBairro`.
 */
export function calcularRankingBairros(
  pedidos: PedidoBairroInput[],
  entregas: EntregaBairroInput[],
  subtotalItensPorPedido: Map<string, number> = new Map(),
): BairrosRanking {
  const entregaPorPedido = new Map(entregas.map((entrega) => [entrega.pedido_id, entrega]));
  const grupos = new Map<string, { pedidos: number; faturamento: number; grafias: Map<string, number> }>();
  const semBairro = { pedidos: 0, faturamento: 0 };

  pedidos.forEach((pedido) => {
    if (pedido.tipo_entrega === "retirada") return;
    const entrega = entregaPorPedido.get(pedido.id);
    if (!entrega) return;

    const valor = totalPedidoDelivery(
      pedido,
      subtotalItensPorPedido.get(pedido.id) || 0,
      Number(entrega.taxa_entrega || 0),
    );

    const chave = normalizarBairro(entrega.bairro);
    if (!chave) {
      semBairro.pedidos += 1;
      semBairro.faturamento += valor;
      return;
    }

    const grupo = grupos.get(chave) ?? { pedidos: 0, faturamento: 0, grafias: new Map<string, number>() };
    grupo.pedidos += 1;
    grupo.faturamento += valor;
    const grafia = limparEspacos(entrega.bairro || "");
    grupo.grafias.set(grafia, (grupo.grafias.get(grafia) || 0) + 1);
    grupos.set(chave, grupo);
  });

  const bairros = Array.from(grupos.entries())
    .map(([chave, grupo]) => {
      let nome = "";
      let usos = 0;
      grupo.grafias.forEach((qtd, grafia) => {
        if (qtd > usos) {
          nome = grafia;
          usos = qtd;
        }
      });
      return { chave, nome, pedidos: grupo.pedidos, faturamento: arredondar(grupo.faturamento) };
    })
    .sort(
      (a, b) =>
        b.pedidos - a.pedidos ||
        b.faturamento - a.faturamento ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    );

  return {
    bairros,
    semBairro: { pedidos: semBairro.pedidos, faturamento: arredondar(semBairro.faturamento) },
  };
}
