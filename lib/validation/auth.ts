import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(200),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone_number: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{7,20}$/, 'Invalid phone number')
    .optional()
    .or(z.literal('')),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  role: z.enum(['farmer', 'buyer']),
});
