import 'server-only';
import { HttpError } from '@/lib/api/errors';

const buckets = new Map<string, number[]>();

/**
 * Sliding-window limiter. In-memory per instance; swap `hit` for a Redis-backed
 * implementation when UPSTASH_REDIS_REST_URL is configured on multi-instance deploys.
 */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    throw new HttpError(429, 'Too many requests, please try again later');
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
