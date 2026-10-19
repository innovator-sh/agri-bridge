import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { HttpError } from '@/lib/api/errors';
import { requireUser, uid } from '@/lib/auth/require';
import { rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';

// Per-user (cookie-gated) route: no route-level `revalidate`. The Groq result is cached in-process
// for 24h and the response is marked private so shared caches never serve it to other callers.
export const dynamic = 'force-dynamic';

const schemeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000),
  // Links end up in href attributes: only absolute https URLs are accepted.
  link: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((u) => u.startsWith('https://'), 'Link must use https'),
});

type Scheme = z.infer<typeof schemeSchema>;

const FALLBACK_SCHEMES: Scheme[] = [
  {
    title: 'PM-KISAN (Pradhan Mantri Kisan Samman Nidhi)',
    description:
      "Direct income support of ₹6,000 per year to small and marginal farmers. The amount is transferred in three equal installments of ₹2,000 each directly to farmers' bank accounts.",
    link: 'https://pmkisan.gov.in/',
  },
  {
    title: 'Kisan Credit Card (KCC)',
    description:
      'Provides farmers with timely access to credit for agricultural needs including crop production, post-harvest expenses, and consumption requirements at subsidized interest rates.',
    link: 'https://www.nabard.org/content1.aspx?id=570&catid=23',
  },
  {
    title: 'Pradhan Mantri Fasal Bima Yojana (PMFBY)',
    description:
      'Crop insurance scheme providing financial support to farmers in case of crop failure due to natural calamities, pests, and diseases with very low premium rates.',
    link: 'https://pmfby.gov.in/',
  },
  {
    title: 'Soil Health Card Scheme',
    description:
      'Provides farmers with soil health cards containing crop-wise recommendations of nutrients and fertilizers required for individual farms to improve productivity.',
    link: 'https://soilhealth.dac.gov.in/',
  },
  {
    title: 'Pradhan Mantri Krishi Sinchai Yojana (PMKSY)',
    description:
      'Aims to expand cultivated area under assured irrigation, improve water use efficiency, and adopt precision irrigation and other water saving technologies.',
    link: 'https://pmksy.gov.in/',
  },
];

const DAY_MS = 24 * 60 * 60_000;
const FAILURE_RETRY_MS = 5 * 60_000;

interface CacheEntry {
  schemes: Scheme[];
  lastUpdated: string;
  expiresAt: number;
  fallback: boolean;
}

let cache: CacheEntry | null = null;
let lastGood: { schemes: Scheme[]; lastUpdated: string } | null = null;
let inflight: Promise<CacheEntry> | null = null;

function parseSchemes(raw: string): Scheme[] {
  // Models sometimes wrap JSON in markdown fences or add prose; extract the outermost object.
  const stripped = raw.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { schemes?: unknown } | null)?.schemes;
  if (!Array.isArray(list)) return [];
  const valid: Scheme[] = [];
  for (const item of list) {
    const r = schemeSchema.safeParse(item);
    if (r.success) valid.push(r.data);
    if (valid.length >= 10) break;
  }
  return valid;
}

async function fetchFromGroq(apiKey: string): Promise<Scheme[]> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful assistant that provides accurate information about government schemes for farmers. Always provide the response in valid JSON format only, without any additional text or markdown formatting.',
        },
        {
          role: 'user',
          content: `Please provide the top 10 government schemes in India regarding agricultural produce for farmers. For each scheme, include:
- title: The official name of the scheme
- description: A brief description (2-3 sentences) of what the scheme offers
- link: An official government website link for more information

Return the data as a JSON array with exactly this structure:
{
  "schemes": [
    {
      "title": "Scheme Name",
      "description": "Brief description",
      "link": "https://official-link.gov.in"
    }
  ]
}`,
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 2048,
      stream: false,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`upstream status ${response.status}`);
  const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = data.choices?.[0]?.message?.content;
  const schemes = typeof content === 'string' ? parseSchemes(content) : [];
  if (schemes.length === 0) throw new Error('no valid schemes in response');
  return schemes;
}

async function load(apiKey: string): Promise<CacheEntry> {
  try {
    const schemes = await fetchFromGroq(apiKey);
    lastGood = { schemes, lastUpdated: new Date().toISOString() };
    return { ...lastGood, expiresAt: Date.now() + DAY_MS, fallback: false };
  } catch (err) {
    console.error('[schemes] refresh failed:', err instanceof Error ? err.message : 'unknown error');
    // Serve the last good copy if we have one, otherwise the built-in list; retry soon.
    return {
      schemes: lastGood?.schemes ?? FALLBACK_SCHEMES,
      lastUpdated: lastGood?.lastUpdated ?? new Date().toISOString(),
      expiresAt: Date.now() + FAILURE_RETRY_MS,
      fallback: true,
    };
  }
}

export const GET = route(async () => {
  const session = await requireUser();
  rateLimit(`schemes:${uid(session)}`, 10, 60 * 60_000);

  const apiKey = env().GROQ_API_KEY;
  if (!apiKey) throw new HttpError(503, 'Service not configured');

  if (!cache || cache.expiresAt <= Date.now()) {
    inflight ??= load(apiKey).finally(() => {
      inflight = null;
    });
    cache = await inflight;
  }

  const body: { schemes: Scheme[]; lastUpdated: string; note?: string } = {
    schemes: cache.schemes,
    lastUpdated: cache.lastUpdated,
  };
  if (cache.fallback) body.note = 'Showing cached schemes due to service unavailability';

  return NextResponse.json(body, {
    headers: { 'Cache-Control': cache.fallback ? 'private, max-age=60' : 'private, max-age=3600' },
  });
});
