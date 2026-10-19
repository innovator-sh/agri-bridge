'use client';
import { useCallback, useEffect, useState } from 'react';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  phone_number: string | null;
  role: 'farmer' | 'buyer';
  created_at?: string;
}

/** Server-backed session (httpOnly cookie). Ids from here are for display, never for authorisation. */
export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setUser(d?.user ?? null))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/login';
  }, []);

  return { user, loading, logout };
}
