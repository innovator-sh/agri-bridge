import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import supabase from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { registerSchema } from '@/lib/validation/auth';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { signSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { HttpError } from '@/lib/api/errors';

export const POST = route(async (req) => {
  rateLimit(`register:${clientIp(req)}`, 5, 60 * 60_000);
  const { name, email, phone_number, password, role } = await parseJson(req, registerSchema);
  const phone = phone_number || null;

  const { data: byEmail } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  const { data: byPhone } = phone
    ? await supabase.from('users').select('id').eq('phone_number', phone).maybeSingle()
    : { data: null };
  if (byEmail || byPhone) throw new HttpError(409, 'An account with these details already exists');

  const hashed = await bcrypt.hash(password, 12);
  const { data: user, error } = await supabase
    .from('users')
    .insert({ name, email, phone_number: phone, password: hashed, role })
    .select('id, name, email, phone_number, role, created_at')
    .single();
  if (error || !user) {
    console.error('[register] insert failed', error);
    throw new HttpError(500, 'Registration failed');
  }

  const token = await signSession({ userId: String(user.id), role });
  const res = NextResponse.json({ message: 'User registered successfully', user }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
});
