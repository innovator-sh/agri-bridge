import { randomUUID } from 'node:crypto';
import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const isDev = process.env.NODE_ENV === 'development';

function supabaseOrigin(): URL | null {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
  } catch {
    return null;
  }
}

const supabase = supabaseOrigin();
const supabaseSources = ['https://*.supabase.co', ...(supabase ? [supabase.origin] : [])];

const contentSecurityPolicy = [
  "default-src 'self'",
  `img-src 'self' data: blob: ${supabaseSources.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // nominatim.openstreetmap.org: browser-side reverse geocoding (dashboards, photo upload).
  `connect-src 'self' ${supabaseSources.join(' ')} https://nominatim.openstreetmap.org${isDev ? ' ws: wss:' : ''}`,
  "font-src 'self' data: https://fonts.gstatic.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Serwist's webpack plugin only runs in `next build --webpack`; this keeps `next dev` (Turbopack) working.
  turbopack: {},
  images: {
    remotePatterns: supabase
      ? [
          {
            protocol: supabase.protocol === 'http:' ? 'http' : 'https',
            hostname: supabase.hostname,
            ...(supabase.port ? { port: supabase.port } : {}),
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      // Declared after the catch-all so these win for the same header key.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
    ];
  },
};

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  reloadOnOnline: false,
  // Only the offline fallback page and the icons/manifest are precached from outside the build output.
  additionalPrecacheEntries: [{ url: '/offline', revision: randomUUID() }],
  globPublicPatterns: ['icon*.svg', 'manifest.json'],
});

export default withSerwist(nextConfig);
