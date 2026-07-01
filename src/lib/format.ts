export const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

/** YYYY-MM-DD no fuso local — evita deslocamento de dia ao usar toISOString() (UTC). */
export const toLocalDateKey = (date: Date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/** YYYY-MM no fuso local. */
export const toLocalMonthKey = (date: Date = new Date()) => toLocalDateKey(date).slice(0, 7);
