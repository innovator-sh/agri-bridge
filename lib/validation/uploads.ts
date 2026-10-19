import 'server-only';
import { z } from 'zod';
import { env } from '@/lib/env';

export const PRODUCT_BUCKET = 'Products';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_PHOTOS = 10;

export const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

/** Public URL prefix of the product photo bucket, e.g. https://x.supabase.co/storage/v1/object/public/Products/ */
export function photoUrlPrefix(): string {
  const base = env().NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${PRODUCT_BUCKET}/`;
}

/** Returns the image mime type if the bytes match a supported format, else null. */
export function detectImageType(b: Uint8Array): keyof typeof ALLOWED_IMAGE_TYPES | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Storage object path for a photo URL, only if it points into this bucket and into a
 * folder owned by the user (`products/<id>/...` or the legacy `<id>/...`). Otherwise null.
 */
export function ownedPhotoPath(url: string, userId: number): string | null {
  const prefix = photoUrlPrefix();
  if (!url.startsWith(prefix)) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  if (!path || path.includes('..') || path.includes('\\')) return null;
  if (!path.startsWith(`products/${userId}/`) && !path.startsWith(`${userId}/`)) return null;
  return path;
}

const idField = z.coerce.number().int().positive();

export const uploadFieldsSchema = z.object({
  productId: idField.optional(),
});

export const photoUrlsSchema = z.object({
  productId: idField,
  photoUrls: z.array(z.string().max(1000)).max(MAX_PRODUCT_PHOTOS),
});

export const deletePhotoSchema = z.object({
  productId: idField,
  url: z.string().max(1000),
});
