import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';
import { route } from '@/lib/api/handler';
import { HttpError, notFound } from '@/lib/api/errors';
import { requireUser, uid } from '@/lib/auth/require';
import { userStatsQuerySchema } from '@/lib/validation/ratings';

type Row = Record<string, any>;

async function count(table: string, filters: Record<string, string | number>) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count: n, error } = await q;
  if (error) {
    console.error(`[user-stats] count ${table} failed`, error);
    throw new HttpError(500, 'Failed to fetch statistics');
  }
  return n ?? 0;
}

async function ratingStats(userId: number) {
  const { data, error } = await supabase.rpc('user_rating_counts', { p_user_id: userId } as never);
  if (error) {
    console.error('[user-stats] rating counts failed', error);
    throw new HttpError(500, 'Failed to fetch statistics');
  }
  const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;
  for (const r of (data ?? []) as unknown as Row[]) {
    const n = Number(r.cnt);
    ratingDistribution[Number(r.rating)] = n;
    total += n;
    sum += Number(r.rating) * n;
  }
  return {
    averageRating: total ? Math.round((sum / total) * 10) / 10 : 0,
    totalRatings: total,
    ratingDistribution,
  };
}

// GET - own full stats by default; ?userId=<other> returns only public profile stats
export const GET = route(async (req) => {
  const session = await requireUser();
  const me = uid(session);
  const { userId } = userStatsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const target = userId ?? me;
  const isSelf = target === me;

  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, phone_number, role, created_at')
    .eq('id', target)
    .maybeSingle();
  if (error) {
    console.error('[user-stats] user fetch failed', error);
    throw new HttpError(500, 'Failed to fetch statistics');
  }
  if (!data) throw notFound('User');
  const user = data as unknown as Row;
  const isSeller = user.role === 'farmer';

  const ratings = await ratingStats(target);
  const products = isSeller
    ? {
        totalProducts: await count('products', { seller_id: target }),
        activeProducts: await count('products', { seller_id: target, status: 'active' }),
      }
    : {};

  if (!isSelf) {
    // Public profile only: no contact details, order counts or order values.
    return NextResponse.json({
      user: { id: user.id, name: user.name, role: user.role },
      stats: { ...ratings, ...products },
    });
  }

  const { data: totals, error: totalsError } = await supabase.rpc('user_order_totals', {
    p_user_id: me,
    p_as: isSeller ? 'seller' : 'buyer',
  } as never);
  if (totalsError) {
    console.error('[user-stats] order totals failed', totalsError);
    throw new HttpError(500, 'Failed to fetch statistics');
  }
  const t = ((totals ?? []) as unknown as Row[])[0] ?? {};

  return NextResponse.json({
    user,
    stats: {
      ...ratings,
      totalOrders: Number(t.total_orders ?? 0),
      completedOrders: Number(t.completed_orders ?? 0),
      totalValue: Number(t.total_value ?? 0),
      joinedDate: user.created_at,
      ...products,
    },
  });
});
