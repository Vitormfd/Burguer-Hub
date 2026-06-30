const DEFAULT_BATCH_SIZE = 80;

export function chunkArray<T>(items: T[], size = DEFAULT_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function fetchInBatches<T>(
  ids: string[],
  queryFn: (batch: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<T[]> {
  if (!ids.length) return [];

  const batches = chunkArray(ids, batchSize);
  const results = await Promise.all(batches.map((batch) => queryFn(batch)));

  const data: T[] = [];
  for (const result of results) {
    if (result.error) throw new Error(result.error.message);
    if (result.data?.length) data.push(...result.data);
  }
  return data;
}
