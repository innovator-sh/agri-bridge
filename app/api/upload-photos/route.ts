import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError, badRequest, forbidden, notFound } from '@/lib/api/errors';
import { requireRole, uid } from '@/lib/auth/require';
import { ownedPhotoPath, photoUrlsSchema } from '@/lib/validation/uploads';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

export const POST = route(async (req) => {
  const session = await requireRole('farmer');
  const { productId, photoUrls } = await parseJson(req, photoUrlsSchema);

  const { data: existing, error: lookupError } = await supabase
    .from('products')
    .select('seller_id, photos')
    .eq('id', productId)
    .maybeSingle();
  if (lookupError) {
    console.error('Photos product lookup error:', lookupError);
    throw new HttpError(500, 'Failed to update product photos');
  }
  if (!existing) throw notFound('Product');
  if (Number(existing.seller_id) !== uid(session)) throw forbidden();

  // Every URL must live in our bucket under one of the session user's folders (or already be on the product).
  const current = (existing.photos as string[] | null) ?? [];
  if (photoUrls.some((u) => !current.includes(u) && !ownedPhotoPath(u, uid(session)))) {
    throw badRequest('Invalid photo URL');
  }

  const { data, error } = await supabase
    .from('products')
    .update({ photos: photoUrls })
    .eq('id', productId)
    .eq('seller_id', uid(session))
    .select()
    .single();
  if (error) {
    console.error('Database update error:', error);
    throw new HttpError(500, 'Failed to update product photos');
  }

  return NextResponse.json({ success: true, product: data });
});
