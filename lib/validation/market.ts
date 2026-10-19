import { z } from 'zod';

const label = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[\p{L}\p{N}\s().,&'\-]+$/u, 'Contains invalid characters');

export const marketQuerySchema = z.object({
  productName: label,
  state: label.optional(),
});

export type MarketQuery = z.infer<typeof marketQuerySchema>;
