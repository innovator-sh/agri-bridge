import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { route } from '@/lib/api/handler';
import { HttpError, badRequest, forbidden, notFound } from '@/lib/api/errors';
import { requireRole, uid } from '@/lib/auth/require';
import { rateLimit } from '@/lib/rate-limit';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  PRODUCT_BUCKET,
  detectImageType,
  uploadFieldsSchema,
} from '@/lib/validation/uploads';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

export const POST = route(async (req) => {
  const session = await requireRole('farmer');
  const userId = uid(session);
  rateLimit(`upload:${userId}`, 20, 10 * 60_000);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest('Request must be multipart form data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('File is required');
  if (file.size === 0) throw badRequest('File is empty');
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'File must be 5 MB or smaller');

  const rawProductId = form.get('productId');
  const { productId } = uploadFieldsSchema.parse({ productId: rawProductId === null || rawProductId === '' ? undefined : rawProductId });

  if (productId !== undefined) {
    const { data: product, error } = await supabase.from('products').select('seller_id').eq('id', productId).maybeSingle();
    if (error) {
      console.error('Upload product lookup error:', error);
      throw new HttpError(500, 'Failed to upload file');
    }
    if (!product) throw notFound('Product');
    if (Number(product.seller_id) !== userId) throw forbidden();
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectImageType(buffer);
  if (!type) throw badRequest('Only JPEG, PNG and WebP images are allowed');

  // Server-chosen path and content type; the client's filename and mime type are ignored.
  const filePath = `products/${userId}/${randomUUID()}.${ALLOWED_IMAGE_TYPES[type]}`;
  const { error } = await supabase.storage.from(PRODUCT_BUCKET).upload(filePath, buffer, { contentType: type, upsert: false });
  if (error) {
    console.error('Upload error:', error);
    throw new HttpError(500, 'Failed to upload file');
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(PRODUCT_BUCKET).getPublicUrl(filePath);

  return NextResponse.json({ success: true, url: publicUrl, path: filePath });
});
