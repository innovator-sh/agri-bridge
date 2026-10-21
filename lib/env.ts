import 'server-only';
import { z } from 'zod';
import { isPlaceholderSecret, placeholderSecretsRefused } from '@/lib/secrets';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  CRON_SECRET: z.string().min(16).optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENWEATHER_API_KEY: z.string().optional(),
  MARKET_DATA_API_KEY: z.string().optional(),
  MARKET_DATA_API_URL: z.string().url().optional(),
  ML_API_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
}).superRefine((v, ctx) => {
  if (!placeholderSecretsRefused()) return;
  for (const key of ['SESSION_SECRET', 'CRON_SECRET'] as const) {
    if (isPlaceholderSecret(v[key])) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'looks like a placeholder; generate a real secret' });
    }
  }
});

let cached: z.infer<typeof schema> | undefined;

/** Validated server environment; throws on first use if misconfigured. */
export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      throw new Error(`Invalid or missing environment variables: ${keys}`);
    }
    cached = parsed.data;
  }
  return cached;
}
