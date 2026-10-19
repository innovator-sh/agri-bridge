import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const num = z.coerce.number().finite();
const nullableNum = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.union([z.null(), num.positive().max(10_000_000)]));
const nullableText = (max: number) =>
  z.preprocess((v) => (v === undefined ? null : v), z.union([z.null(), text(max)]));

export const PRODUCT_STATUSES = ['active', 'inactive', 'sold'] as const;

export const productIdParam = z.coerce.number().int().positive();

export const createProductSchema = z.object({
  name: text(255).min(1),
  category: text(100).min(1),
  quantity: z.coerce.number().int().positive().max(100_000_000),
  price_single: num.positive().max(10_000_000),
  price_multiple: nullableNum.optional(),
  location: nullableText(255).optional(),
  description: nullableText(5000).optional(),
});

/** Whitelist for updates; photos are validated against the bucket in the route. */
export const updateProductSchema = z.object({
  name: text(255).min(1).optional(),
  category: text(100).min(1).optional(),
  quantity: z.coerce.number().int().min(0).max(100_000_000).optional(),
  price_single: num.positive().max(10_000_000).optional(),
  price_multiple: nullableNum.optional(),
  location: nullableText(255).optional(),
  description: nullableText(5000).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  photos: z.array(z.string().max(1000)).max(10).optional(),
});

export const listProductsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  category: text(100).min(1).optional(),
  seller_id: z.coerce.number().int().positive().optional(),
  search: text(100).min(1).optional(),
  status: z.enum([...PRODUCT_STATUSES, 'all']).optional(),
});

/** Escape characters that are special inside a PostgREST `ilike`/`or` filter value. */
export function escapeSearch(term: string): string {
  return term.replace(/[\\%_,()*"']/g, ' ').replace(/\s+/g, ' ').trim();
}
