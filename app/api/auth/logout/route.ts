import { NextResponse } from 'next/server';
import { route } from '@/lib/api/handler';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const POST = route(async () => {
  const res = NextResponse.json({ message: 'Logged out' });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
});
