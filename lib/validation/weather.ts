import { z } from 'zod';

const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((v) => Number(v))
    .pipe(z.number().finite().min(min).max(max));

export const weatherQuerySchema = z
  .object({
    lat: coordinate(-90, 90).optional(),
    lon: coordinate(-180, 180).optional(),
    city: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[\p{L}\s,.\-]+$/u, 'City contains invalid characters')
      .optional(),
  })
  .refine((q) => (q.lat === undefined) === (q.lon === undefined), {
    message: 'lat and lon must be provided together',
  });

export type WeatherQuery = z.infer<typeof weatherQuerySchema>;
