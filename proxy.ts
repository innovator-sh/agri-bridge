import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { secretIsUsable } from '@/lib/secrets';

const PUBLIC_API = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/process-schedules', // authenticated by CRON_SECRET inside the route
  '/api/placeholder',
];

async function valid(token?: string) {
  if (!token || !secretIsUsable(process.env.SESSION_SECRET)) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET), { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');
  if (isApi && PUBLIC_API.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (await valid(req.cookies.get('ab_session')?.value)) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/dashboard/:path*', '/api/:path*'] };
