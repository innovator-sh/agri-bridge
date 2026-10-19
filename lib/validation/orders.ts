import { z } from 'zod';

/** Shared `?limit=&offset=` schema: limit defaults to 20 (max 50), offset to 0. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;

export const ordersQuerySchema = paginationSchema.extend({
  // Optional narrowing; always intersected with the session user. Legacy `userType` is accepted too.
  role: z.enum(['buyer', 'seller']).optional(),
  userType: z.enum(['buyer', 'seller']).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
});

// Identity (buyer/seller), prices and totals are derived server-side and deliberately absent here.
export const createOrderSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(100_000),
  deliveryAddress: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const orderIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});
