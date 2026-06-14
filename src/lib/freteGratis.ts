import type { TipoEntrega } from "@/types/db";

export type FreteGratisMotivo =
  | "retirada"
  | "cupom"
  | "promocao_global"
  | "promocao_bairro"
  | "valor_minimo"
  | "valor_minimo_bairro";

export interface TaxaEntregaCalculada {
  taxaBairro: number;
  taxaEfetiva: number;
  freteGratis: boolean;
  motivo: FreteGratisMotivo | null;
}

export interface FreteGratisConfig {
  frete_gratis_ativo?: boolean;
  frete_gratis_minimo?: number | null;
}

export interface BairroFreteGratisConfig {
  frete_gratis_ativo?: boolean;
  frete_gratis_minimo?: number | null;
}

export interface CategoriaFreteGratisConfig {
  id: string;
  nome: string;
  exclui_frete_gratis?: boolean;
}

export interface ItemFreteGratisCheck {
  produto: { categoria_id: string | null };
}

export function carrinhoBloqueiaFreteGratis(
  itens: ItemFreteGratisCheck[],
  categorias: CategoriaFreteGratisConfig[],
): boolean {
  const excluidas = new Set(
    categorias.filter((categoria) => categoria.exclui_frete_gratis).map((categoria) => categoria.id),
  );
  if (!excluidas.size) return false;
  return itens.some((item) => item.produto.categoria_id && excluidas.has(item.produto.categoria_id));
}

export function categoriasBloqueandoFreteGratis(
  itens: ItemFreteGratisCheck[],
  categorias: CategoriaFreteGratisConfig[],
): string[] {
  const excluidas = new Map(
    categorias
      .filter((categoria) => categoria.exclui_frete_gratis)
      .map((categoria) => [categoria.id, categoria.nome]),
  );
  if (!excluidas.size) return [];

  const nomes = new Set<string>();
  itens.forEach((item) => {
    const catId = item.produto.categoria_id;
    if (catId && excluidas.has(catId)) {
      nomes.add(excluidas.get(catId)!);
    }
  });
  return Array.from(nomes);
}

export function calcularTaxaEntrega(params: {
  tipoEntrega: TipoEntrega;
  taxaBairro: number;
  subtotal: number;
  config?: FreteGratisConfig | null;
  bairro?: BairroFreteGratisConfig | null;
  cupomZeraFrete?: boolean;
  bloqueiaFreteGratis?: boolean;
}): TaxaEntregaCalculada {
  const taxaBairro = Math.max(Number(params.taxaBairro || 0), 0);
  const subtotal = Math.max(Number(params.subtotal || 0), 0);
  const config = params.config;
  const bairro = params.bairro;

  if (params.tipoEntrega === "retirada") {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "retirada" };
  }

  if (params.cupomZeraFrete) {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "cupom" };
  }

  if (params.bloqueiaFreteGratis) {
    return { taxaBairro, taxaEfetiva: taxaBairro, freteGratis: false, motivo: null };
  }

  if (config?.frete_gratis_ativo) {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "promocao_global" };
  }

  if (bairro?.frete_gratis_ativo) {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "promocao_bairro" };
  }

  const minimoGlobal = Number(config?.frete_gratis_minimo || 0);
  if (minimoGlobal > 0 && subtotal >= minimoGlobal) {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "valor_minimo" };
  }

  const minimoBairro = Number(bairro?.frete_gratis_minimo || 0);
  if (minimoBairro > 0 && subtotal >= minimoBairro) {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "valor_minimo_bairro" };
  }

  return { taxaBairro, taxaEfetiva: taxaBairro, freteGratis: false, motivo: null };
}

export function freteGratisFaltam(subtotal: number, minimo?: number | null): number | null {
  const valorMinimo = Number(minimo || 0);
  if (valorMinimo <= 0) return null;
  const falta = valorMinimo - subtotal;
  return falta > 0 ? Number(falta.toFixed(2)) : null;
}

export function minimosFreteGratisAtivos(
  config?: FreteGratisConfig | null,
  bairro?: BairroFreteGratisConfig | null,
  bloqueiaFreteGratis = false,
): number[] {
  if (bloqueiaFreteGratis || config?.frete_gratis_ativo || bairro?.frete_gratis_ativo) return [];

  const minimos: number[] = [];
  const minimoGlobal = Number(config?.frete_gratis_minimo || 0);
  const minimoBairro = Number(bairro?.frete_gratis_minimo || 0);
  if (minimoGlobal > 0) minimos.push(minimoGlobal);
  if (minimoBairro > 0) minimos.push(minimoBairro);
  return minimos;
}

export function proximoMinimoFreteGratis(
  subtotal: number,
  config?: FreteGratisConfig | null,
  bairro?: BairroFreteGratisConfig | null,
  bloqueiaFreteGratis = false,
): number | null {
  const minimos = minimosFreteGratisAtivos(config, bairro, bloqueiaFreteGratis);
  if (!minimos.length) return null;
  return Math.min(...minimos);
}

export function freteGratisFaltamEfetivo(
  subtotal: number,
  config?: FreteGratisConfig | null,
  bairro?: BairroFreteGratisConfig | null,
  bloqueiaFreteGratis = false,
): number | null {
  const alvo = proximoMinimoFreteGratis(subtotal, config, bairro, bloqueiaFreteGratis);
  if (alvo == null) return null;
  return freteGratisFaltam(subtotal, alvo);
}

export function freteGratisResumo(
  config?: FreteGratisConfig | null,
  bairro?: BairroFreteGratisConfig | null,
  bloqueiaFreteGratis = false,
): string | null {
  if (bloqueiaFreteGratis) return null;
  if (config?.frete_gratis_ativo) return "Frete grátis em todos os pedidos delivery";
  if (bairro?.frete_gratis_ativo) return "Frete grátis neste bairro";
  const minimos = minimosFreteGratisAtivos(config, bairro, bloqueiaFreteGratis);
  if (!minimos.length) return null;
  const alvo = Math.min(...minimos);
  return `Frete grátis em pedidos a partir de R$ ${alvo.toFixed(2).replace(".", ",")}`;
}

export function freteGratisBairroResumo(bairro?: BairroFreteGratisConfig | null): string | null {
  if (!bairro) return null;
  if (bairro.frete_gratis_ativo) return "Frete grátis";
  const minimo = Number(bairro.frete_gratis_minimo || 0);
  if (minimo > 0) return `Grátis acima de R$ ${minimo.toFixed(2).replace(".", ",")}`;
  return null;
}
