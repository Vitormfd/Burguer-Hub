import type { Promocao } from "./types";

type CacheEntry = {
  expiresAt: number;
  data: Promocao[];
};

const store = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 45_000;

export function getCachedPromocoes(ownerId: string): Promocao[] | null {
  const entry = store.get(ownerId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(ownerId);
    return null;
  }
  return entry.data;
}

export function setCachedPromocoes(
  ownerId: string,
  data: Promocao[],
  ttlMs = DEFAULT_TTL_MS,
): void {
  store.set(ownerId, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidatePromocoesCache(ownerId?: string): void {
  if (ownerId) store.delete(ownerId);
  else store.clear();
}
