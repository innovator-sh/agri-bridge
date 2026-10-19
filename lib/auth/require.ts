import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, type Role, type Session } from '@/lib/auth/session';
import { forbidden, unauthorized } from '@/lib/api/errors';

export async function getSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) throw unauthorized();
  return s;
}

export async function requireRole(role: Role): Promise<Session> {
  const s = await requireUser();
  if (s.role !== role) throw forbidden();
  return s;
}

/** Numeric DB id for the session user (users.id is an integer column). */
export const uid = (s: Session): number => Number(s.userId);
