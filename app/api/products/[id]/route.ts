import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError, badRequest, forbidden, notFound } from '@/lib/api/errors';
import { requireUser, requireRole, uid } from '@/lib/auth/require';
import { productIdParam, updateProductSchema } from '@/lib/validation/products';
import { ownedPhotoPath, PRODUCT_BUCKET } from '@/lib/validation/uploads';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<number> {
  const r = productIdParam.safeParse((await ctx.params).id);
  if (!r.success) throw badRequest('Invalid product ID');
  return r.data;
}

/** Loads the product and verifies it belongs to the session farmer. */
async function loadOwned(productId: number, userId: number) {
  const { data, error } = await supabase.from('products').select('id, seller_id, photos').eq('id', productId).maybeSingle();
  if (error) {
    console.error('Product lookup error:', error);
    throw new HttpError(500, 'Failed to load product');
  }
  if (!data) throw notFound('Product');
  if (Number(data.seller_id) !== userId) throw forbidden();
  return data as { id: number; seller_id: number; photos: string[] | null };
}

export const GET = route<Ctx>(async (_req, ctx) => {
  await requireUser();
  const productId = await parseId(ctx);

  const { data, error } = await supabase
    .from('products')
    .select('*, users!products_seller_id_fkey (name, phone_number)')
    .eq('id', productId)
    .maybeSingle();
  if (error) {
    console.error('Product fetch error:', error);
    throw new HttpError(500, 'Failed to fetch product');
  }
  if (!data) throw notFound('Product');

  const p = data as Record<string, any>;
  return NextResponse.json({
    product: { ...p, seller_name: p.users?.name, seller_phone: p.users?.phone_number, photos: p.photos || [] },
  });
});

export const PUT = route<Ctx>(async (req, ctx) => {
  const session = await requireRole('farmer');
  const productId = await parseId(ctx);
  const input = await parseJson(req, updateProductSchema);
  const owned = await loadOwned(productId, uid(session));

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) update[k] = v;

  if (input.photos) {
    const current = owned.photos ?? [];
    const bad = input.photos.some((u) => !current.includes(u) && !ownedPhotoPath(u, uid(session)));
    if (bad) throw badRequest('Invalid photo URL');
  }
  if (Object.keys(update).length === 0) throw badRequest('No fields to update');
  update.updated_at = new Date().toISOString();

  const { data: product, error } = await supabase
    .from('products')
    .update(update)
    .eq('id', productId)
    .eq('seller_id', uid(session))
    .select('*')
    .single();
  if (error || !product) {
    console.error('Product update error:', error);
    throw new HttpError(500, 'Failed to update product');
  }

  return NextResponse.json({ success: true, product: { ...product, photos: product.photos || [] } });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const session = await requireRole('farmer');
  const productId = await parseId(ctx);
  const owned = await loadOwned(productId, uid(session));

  const { error } = await supabase.from('products').delete().eq('id', productId).eq('seller_id', uid(session));
  if (error) {
    console.error('Product deletion error:', error);
    throw new HttpError(500, 'Failed to delete product');
  }

  // Best-effort cleanup of the product's photos in storage.
  const paths = (owned.photos ?? []).map((u) => ownedPhotoPath(u, uid(session))).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error: rmError } = await supabase.storage.from(PRODUCT_BUCKET).remove(paths);
    if (rmError) console.error('Product photo cleanup error:', rmError);
  }

  return NextResponse.json({ success: true, message: 'Product deleted successfully' });
});
