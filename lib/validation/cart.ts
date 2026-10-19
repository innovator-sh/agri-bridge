import { z } from 'zod';

const productId = z.coerce.number().int().positive();

export const cartAddSchema = z.object({
  productId,
  quantity: z.coerce.number().int().min(1).max(10_000).default(1),
});

// quantity 0 removes the item
export const cartSetSchema = z.object({
  productId,
  quantity: z.coerce.number().int().min(0).max(10_000),
});

export const cartRemoveSchema = z.object({ productId });
