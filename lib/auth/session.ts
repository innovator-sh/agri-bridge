import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/lib/env';

export const SESSION_COOKIE = 'ab_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type Role = 'farmer' | 'buyer';
export interface Session {
  userId: string;
  role: Role;
}

const key = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ role: s.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    if (!payload.sub || (payload.role !== 'farmer' && payload.role !== 'buyer')) return null;
    return { userId: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
};
