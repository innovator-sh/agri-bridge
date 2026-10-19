import { z } from 'zod';
import { paginationSchema } from '@/lib/validation/orders';

const ratingValue = z.coerce.number().int().min(1, 'Rating must be between 1 and 5').max(5, 'Rating must be between 1 and 5');
const review = z.string().trim().max(1000).optional().nullable();

export const ratingsQuerySchema = paginationSchema.extend({
  orderId: z.coerce.number().int().positive().optional(),
  orderIds: z
    .string()
    .regex(/^\d+(,\d+){0,49}$/, 'orderIds must be up to 50 comma-separated ids')
    .transform((s) => [...new Set(s.split(',').map(Number))])
    .optional(),
  userId: z.coerce.number().int().positive().optional(),
  userType: z.enum(['buyer', 'seller']).optional(),
});

// raterId / ratedId / raterType are derived from the session and the order, never from the client.
export const createRatingSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  rating: ratingValue,
  review,
});

export const updateRatingSchema = z.object({
  ratingId: z.coerce.number().int().positive(),
  rating: ratingValue,
  review,
});

export const deleteRatingQuerySchema = z.object({ ratingId: z.coerce.number().int().positive() });

export const userStatsQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
});
