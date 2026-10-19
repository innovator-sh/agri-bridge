import { route } from '@/lib/api/handler';

const DEFAULT_SIZE = 300;
const MAX_SIZE = 2000;

/** Integer in 1..MAX_SIZE; anything else (missing, non-numeric, decimals, signs) falls back to the default. */
function parseSize(segment: string | undefined): number {
  if (!segment || !/^\d{1,6}$/.test(segment)) return DEFAULT_SIZE;
  const n = Number.parseInt(segment, 10);
  return Math.min(Math.max(n, 1), MAX_SIZE);
}

export const GET = route(async (_req, ctx: { params: Promise<{ dimensions: string[] }> }) => {
  const { dimensions } = await ctx.params;
  // Only the two parsed integers are ever interpolated; raw URL segments never reach the SVG.
  const width = parseSize(dimensions?.[0]);
  const height = parseSize(dimensions?.[1]);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f3f4f6"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="16" fill="#9ca3af" text-anchor="middle" dy=".3em">No Image Available</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
