import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';
import { route } from '@/lib/api/handler';
import { requireUser, uid } from '@/lib/auth/require';
import { HttpError } from '@/lib/api/errors';

export const GET = route(async () => {
  const s = await requireUser();
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email, phone_number, role, created_at')
    .eq('id', uid(s))
    .maybeSingle();
  if (!user) throw new HttpError(401, 'Authentication required');
  return NextResponse.json({ user }, { headers: { 'Cache-Control': 'no-store' } });
});
