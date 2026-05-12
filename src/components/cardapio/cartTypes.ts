import type { Produto } from "@/types/db";

export interface CartAdicionalSelecionado {
  grupoId: string;
  grupoNome: string;
  adicionalId: string;
  adicionalNome: string;
  quantidade: number;
  precoUnitario: number;
}

export interface CartItem {
  id: string;
  produto: Produto;
  quantidade: number;
  observacao: string;
  adicionais: CartAdicionalSelecionado[];
  precoBaseUnit: number;
  precoAdicionaisUnit: number;
  precoUnit: number;
}

export type Cart = CartItem[];

export const cartSubtotal = (cart: Cart) =>
  cart.reduce((sum, item) => sum + item.precoUnit * item.quantidade, 0);
