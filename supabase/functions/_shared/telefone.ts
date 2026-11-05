// Telefones de celular do Brasil, como chegam do cardápio, do painel e do banco.

export const somenteDigitos = (valor: string): string => valor.replace(/\D/g, "").trim();

/** Normaliza celular BR para 11 dígitos locais (DDD + 9 + número). */
export function normalizarCelularBr(valor: string): { local: string; formatted: string } | null {
  let digitos = somenteDigitos(valor);
  if (!digitos) return null;

  if (digitos.startsWith("55") && digitos.length > 11) {
    digitos = digitos.slice(2);
  }

  // DDD (2) + 8 dígitos: celular sem o 9 extra (comum em APIs e no WhatsApp)
  if (digitos.length === 10) {
    digitos = digitos.slice(0, 2) + "9" + digitos.slice(2);
  }

  if (digitos.length !== 11 || digitos[2] !== "9") {
    return null;
  }

  return { local: digitos, formatted: `55${digitos}` };
}

/** Mesmo número, mesmo escrito de formas diferentes. Inválido nunca é igual a nada. */
export function mesmoCelular(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = normalizarCelularBr(a ?? "");
  const pb = normalizarCelularBr(b ?? "");
  return Boolean(pa && pb && pa.local === pb.local);
}
