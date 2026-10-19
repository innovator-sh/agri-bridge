import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { HttpError } from '@/lib/api/errors';
import { requireUser, uid } from '@/lib/auth/require';
import { rateLimit } from '@/lib/rate-limit';
import { ML_API_CONFIG, getMlApiUrl } from '@/lib/config/ml-api';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;
// Multipart framing adds a little on top of the file itself.
const MAX_BODY_BYTES = MAX_BYTES + 64 * 1024;

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';
const EXTENSIONS: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Detect the real image type from magic bytes (the client-declared MIME type is not trusted). */
function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Reads the request body, aborting as soon as it exceeds `limit` bytes. */
async function readLimited(req: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'Image must be 5 MB or smaller');
  if (!req.body) throw new HttpError(400, 'An image file is required');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'Image must be 5 MB or smaller');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// Only the fields the UI renders are passed through.
const mlResponseSchema = z.object({
  predicted_class: z.string().trim().min(1).max(100),
  confidence_score: z.union([z.string().max(20), z.number()]),
  quality_score: z.number().finite(),
  message: z.string().max(500).optional(),
});

function formatConfidence(v: string | number): string {
  if (typeof v === 'string') return v;
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toFixed(2)}%`;
}

export const POST = route(async (req) => {
  const session = await requireUser();
  rateLimit(`quality:${uid(session)}`, 15, 10 * 60_000);

  const mlUrl = getMlApiUrl();
  if (!mlUrl) throw new HttpError(503, 'Quality analysis is not configured');

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'Send the image as multipart/form-data');
  }

  const raw = await readLimited(req, MAX_BODY_BYTES);
  let form: FormData;
  try {
    form = await new Response(raw as BodyInit, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new HttpError(400, 'Invalid form data');
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'An image file is required');
  if (file.size > MAX_BYTES) throw new HttpError(413, 'Image must be 5 MB or smaller');
  if (!file.type.toLowerCase().startsWith('image/')) throw new HttpError(415, 'Only image files are accepted');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) throw new HttpError(415, 'Only JPEG, PNG or WebP images are accepted');

  const upstreamForm = new FormData();
  // The original filename is user-controlled; send a neutral one.
  upstreamForm.append('file', new Blob([bytes as BlobPart], { type }), `upload.${EXTENSIONS[type]}`);

  let upstream: Response;
  try {
    upstream = await fetch(mlUrl, {
      method: 'POST',
      body: upstreamForm,
      headers: ML_API_CONFIG.HEADERS,
      signal: AbortSignal.timeout(ML_API_CONFIG.TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.error('[quality-analysis] upstream request failed:', timedOut ? 'timeout' : 'network error');
    throw new HttpError(timedOut ? 504 : 502, 'Quality analysis is unavailable right now');
  }

  if (!upstream.ok) {
    console.error('[quality-analysis] upstream status', upstream.status);
    throw new HttpError(502, 'Quality analysis is unavailable right now');
  }

  const parsed = mlResponseSchema.safeParse(await upstream.json().catch(() => null));
  if (!parsed.success) {
    console.error('[quality-analysis] unexpected upstream response shape');
    throw new HttpError(502, 'Quality analysis returned an unexpected response');
  }

  const { predicted_class, confidence_score, quality_score, message } = parsed.data;
  return NextResponse.json({
    predicted_class,
    confidence_score: formatConfidence(confidence_score),
    quality_score,
    message: message ?? 'Analysis completed',
  });
});
