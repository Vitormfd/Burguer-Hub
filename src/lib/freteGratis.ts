import type { TipoEntrega } from "@/types/db";

export type FreteGratisMotivo = "retirada" | "cupom" | "promocao_global" | "valor_minimo";

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

export function calcularTaxaEntrega(params: {
  tipoEntrega: TipoEntrega;
  taxaBairro: number;
  subtotal: number;
  config?: FreteGratisConfig | null;
  cupomZeraFrete?: boolean;
}): TaxaEntregaCalculada {
  const taxaBairro = Math.max(Number(params.taxaBairro || 0), 0);
  const subtotal = Math.max(Number(params.subtotal || 0), 0);
  const config = params.config;

  if (params.tipoEntrega === "retirada") {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "retirada" };
  }

  if (params.cupomZeraFrete) {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "cupom" };
  }

  if (config?.frete_gratis_ativo) {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "promocao_global" };
  }

  const minimo = Number(config?.frete_gratis_minimo || 0);
  if (minimo > 0 && subtotal >= minimo) {
    return { taxaBairro, taxaEfetiva: 0, freteGratis: true, motivo: "valor_minimo" };
  }

  return { taxaBairro, taxaEfetiva: taxaBairro, freteGratis: false, motivo: null };
}

export function freteGratisFaltam(subtotal: number, minimo?: number | null): number | null {
  const valorMinimo = Number(minimo || 0);
  if (valorMinimo <= 0) return null;
  const falta = valorMinimo - subtotal;
  return falta > 0 ? Number(falta.toFixed(2)) : null;
}

export function freteGratisResumo(config?: FreteGratisConfig | null): string | null {
  if (!config) return null;
  if (config.frete_gratis_ativo) return "Frete grátis em todos os pedidos delivery";
  const minimo = Number(config.frete_gratis_minimo || 0);
  if (minimo > 0) return `Frete grátis em pedidos a partir de R$ ${minimo.toFixed(2).replace(".", ",")}`;
  return null;
}
