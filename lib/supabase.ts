import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

// No generated DB types yet, so the client is intentionally loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>;

let client: Db | undefined;

/** Service-role client. Server only: RLS is bypassed, so callers must authorise first. */
export function getSupabase(): Db {
  if (!client) {
    const e = env();
    client = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

export const supabase = new Proxy({} as Db, {
  get: (_t, prop) => Reflect.get(getSupabase(), prop),
});

export default supabase;
