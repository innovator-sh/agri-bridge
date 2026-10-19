import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import supabase from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { loginSchema } from '@/lib/validation/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { signSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { HttpError } from '@/lib/api/errors';

// Compared against when the account does not exist, so timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export const POST = route(async (req) => {
  rateLimit(`login:${clientIp(req)}`, 10, 15 * 60_000);
  const { identifier, password } = await parseJson(req, loginSchema);

  const column = identifier.includes('@') ? 'email' : 'phone_number';
  const value = column === 'email' ? identifier.toLowerCase() : identifier;
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email, phone_number, role, password, created_at')
    .eq(column, value)
    .maybeSingle();

  const ok = await bcrypt.compare(password, (user?.password as string | undefined) ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid credentials');

  const { password: _pw, ...safe } = user as Record<string, unknown>;
  const token = await signSession({ userId: String(user.id), role: user.role as 'farmer' | 'buyer' });
  const res = NextResponse.json({ message: 'Login successful', user: safe });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
});
