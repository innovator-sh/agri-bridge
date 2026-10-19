import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError } from '@/lib/api/errors';
import { requireUser, requireRole, uid } from '@/lib/auth/require';
import { createProductSchema, listProductsQuery, escapeSearch } from '@/lib/validation/products';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

export const GET = route(async (req) => {
  const session = await requireUser();
  const params = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ''));
  const q = listProductsQuery.parse(params);

  let query = supabase
    .from('products')
    .select('*, users!products_seller_id_fkey (name, phone_number)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);

  // Only a farmer looking at their own listings may see non-active products.
  const ownListing = session.role === 'farmer' && q.seller_id === uid(session);
  const status = ownListing && q.status ? q.status : 'active';
  if (status !== 'all') query = query.eq('status', status);

  if (q.seller_id) query = query.eq('seller_id', q.seller_id);
  if (q.category) query = query.eq('category', q.category);
  if (q.search) {
    const s = escapeSearch(q.search);
    if (s) query = query.or(`name.ilike.%${s}%,category.ilike.%${s}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('Products fetch error:', error);
    throw new HttpError(500, 'Failed to fetch products');
  }

  const products = (data ?? []).map((p: Record<string, any>) => ({
    ...p,
    seller_name: p.users?.name,
    seller_phone: p.users?.phone_number,
    photos: p.photos || [],
  }));

  return NextResponse.json({ products, total: count ?? products.length, limit: q.limit, offset: q.offset });
});

export const POST = route(async (req) => {
  const session = await requireRole('farmer');
  const input = await parseJson(req, createProductSchema);

  const { data: product, error } = await supabase
    .from('products')
    .insert({
      name: input.name,
      category: input.category,
      quantity: input.quantity,
      seller_id: uid(session),
      price_single: input.price_single,
      price_multiple: input.price_multiple ?? null,
      location: input.location ?? null,
      description: input.description ?? null,
      status: 'active',
      photos: [],
    })
    .select()
    .single();

  if (error) {
    console.error('Product creation error:', error);
    throw new HttpError(500, 'Failed to create product');
  }

  return NextResponse.json({ success: true, product });
});
