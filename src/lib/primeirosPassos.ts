// Guia da conta em teste: o mínimo para receber o primeiro pedido pelo cardápio online.
// Conta nova nasce sem produtos, sem bairros, com a retirada desligada e com horário das
// 18h às 23h, e o cardápio recusa pedido de loja fechada.

export type IdPasso = "produto" | "entrega" | "horario" | "pedido";

export interface SituacaoLoja {
  temProduto: boolean;
  temBairro: boolean;
  retiradaAtiva: boolean;
  abertaAgora: boolean;
  /** Horário de hoje, já formatado (ex.: "18:00 - 23:00" ou "Fechado"). */
  horarioHoje: string;
  temPedido: boolean;
}

export interface Passo {
  id: IdPasso;
  titulo: string;
  detalhe: string;
  feito: boolean;
}

export function passosPrimeiroPedido(s: SituacaoLoja): Passo[] {
  return [
    {
      id: "produto",
      titulo: "Cadastre um produto",
      detalhe: "Um item com preço já basta para testar.",
      feito: s.temProduto,
    },
    {
      id: "entrega",
      titulo: "Escolha como o cliente recebe",
      detalhe: "Ligue a retirada no balcão ou cadastre os bairros de entrega com a taxa.",
      feito: s.retiradaAtiva || s.temBairro,
    },
    {
      id: "horario",
      titulo: "Deixe a loja aberta agora",
      detalhe: s.abertaAgora
        ? `Hoje: ${s.horarioHoje}.`
        : `Fora do horário o cardápio não aceita pedidos. Hoje: ${s.horarioHoje}.`,
      feito: s.abertaAgora,
    },
    {
      id: "pedido",
      titulo: "Faça um pedido de teste pelo seu link",
      detalhe: "Abra o cardápio no celular, peça e veja o pedido chegar no painel.",
      feito: s.temPedido,
    },
  ];
}
