import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError, badRequest, forbidden, notFound } from '@/lib/api/errors';
import { requireRole, uid } from '@/lib/auth/require';
import { deletePhotoSchema, ownedPhotoPath, PRODUCT_BUCKET } from '@/lib/validation/uploads';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

export const POST = route(async (req) => {
  const session = await requireRole('farmer');
  const userId = uid(session);
  const { productId, url } = await parseJson(req, deletePhotoSchema);

  const path = ownedPhotoPath(url, userId);
  if (!path) throw badRequest('Invalid photo URL');

  const { data: product, error: lookupError } = await supabase
    .from('products')
    .select('seller_id, photos')
    .eq('id', productId)
    .maybeSingle();
  if (lookupError) {
    console.error('Delete photo lookup error:', lookupError);
    throw new HttpError(500, 'Failed to delete photo');
  }
  if (!product) throw notFound('Product');
  if (Number(product.seller_id) !== userId) throw forbidden();

  const { error: removeError } = await supabase.storage.from(PRODUCT_BUCKET).remove([path]);
  if (removeError) {
    console.error('Storage delete error:', removeError);
    throw new HttpError(500, 'Failed to delete photo');
  }

  const photos = ((product.photos as string[] | null) ?? []).filter((u) => u !== url);
  const { error } = await supabase.from('products').update({ photos }).eq('id', productId).eq('seller_id', userId);
  if (error) {
    console.error('Delete photo update error:', error);
    throw new HttpError(500, 'Failed to delete photo');
  }

  return NextResponse.json({ success: true, photos });
});
