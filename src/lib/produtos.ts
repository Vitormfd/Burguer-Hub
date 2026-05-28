import type { Produto } from "@/types/db";

/** Preço cobrado quando o produto está em promoção ativa. */
export function precoEfetivo(p: Pick<Produto, "preco" | "promocao" | "preco_promocional">): number {
  return p.promocao && p.preco_promocional != null ? Number(p.preco_promocional) : Number(p.preco);
}

export function emPromocao(p: Pick<Produto, "promocao" | "preco_promocional">): boolean {
  return !!p.promocao && p.preco_promocional != null;
}
