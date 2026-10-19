/**
 * Fetches every page of a paginated list endpoint (`limit` / `offset` / `total` keys).
 * If the endpoint does not paginate (no `limit`/`total` in the response) only one request is made.
 */
export async function fetchAllPages<T extends { id?: number | string }>(
  path: string,
  key: string,
  pageSize = 50,
  maxPages = 40
): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<number | string>();
  const sep = path.includes('?') ? '&' : '?';

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const response = await fetch(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    if (!response.ok) {
      if (page === 0) throw new Error(`Request failed with status ${response.status}`);
      break;
    }
    const data = await response.json();
    const rows: T[] = Array.isArray(data?.[key]) ? data[key] : [];

    let added = 0;
    for (const row of rows) {
      if (row && row.id !== undefined) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      all.push(row);
      added++;
    }

    const serverLimit = typeof data?.limit === 'number' ? data.limit : undefined;
    const total = typeof data?.total === 'number' ? data.total : undefined;
    const paginated = serverLimit !== undefined || total !== undefined;

    if (!paginated) break; // endpoint returned everything in one go
    if (added === 0) break; // nothing new, avoid looping
    if (total !== undefined && all.length >= total) break;
    if (rows.length < (serverLimit ?? pageSize)) break;
  }
  return all;
}

/** Splits an array into chunks of at most `size` items. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Fetches ratings for many orders in a few batched requests (`/api/ratings?orderIds=1,2,3`). */
export async function fetchRatingsForOrders(orderIds: Array<number | string>): Promise<any[]> {
  if (orderIds.length === 0) return [];
  const results = await Promise.all(
    chunk(orderIds, 25).map((ids) =>
      fetchAllPages<any>(`/api/ratings?orderIds=${ids.join(',')}`, 'ratings').catch(() => [])
    )
  );
  return results.flat();
}
