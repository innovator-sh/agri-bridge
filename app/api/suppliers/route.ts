import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';
import { route } from '@/lib/api/handler';
import { HttpError } from '@/lib/api/errors';
import { requireUser } from '@/lib/auth/require';
import { paginationSchema } from '@/lib/validation/orders';

type Row = Record<string, any>;

// GET - paginated farmers with product stats (batched: 2 queries total, no email)
export const GET = route(async (req) => {
  await requireUser();
  const { limit, offset } = paginationSchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data, count, error } = await supabase
    .from('users')
    .select('id, name, phone_number, created_at', { count: 'exact' })
    .eq('role', 'farmer')
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[suppliers] fetch failed', error);
    throw new HttpError(500, 'Failed to fetch suppliers');
  }

  const farmers = (data ?? []) as unknown as Row[];
  const byFarmer = new Map<number, Row[]>();

  if (farmers.length > 0) {
    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('seller_id, price_single, quantity, category')
      .in('seller_id', farmers.map((f) => f.id))
      .eq('status', 'active');
    if (pErr) {
      console.error('[suppliers] products fetch failed', pErr);
      throw new HttpError(500, 'Failed to fetch suppliers');
    }
    for (const p of (products ?? []) as unknown as Row[]) {
      const list = byFarmer.get(p.seller_id) ?? [];
      list.push(p);
      byFarmer.set(p.seller_id, list);
    }
  }

  const suppliers = farmers.map((f) => {
    const products = byFarmer.get(f.id) ?? [];
    const totalStock = products.reduce((s, p) => s + (p.quantity || 0), 0);
    const avgPrice = products.length
      ? Math.round(products.reduce((s, p) => s + Number(p.price_single || 0), 0) / products.length)
      : 0;
    return {
      ...f,
      productCount: products.length,
      totalStock,
      avgPrice,
      categories: [...new Set(products.map((p) => p.category))],
      joinedDate: new Date(f.created_at).toLocaleDateString(),
    };
  });

  return NextResponse.json({ suppliers, total: count ?? 0, limit, offset });
});
