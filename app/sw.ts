import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type RuntimeCaching,
} from 'serwist';

// The service worker is compiled separately by @serwist/next (webpack build); the manifest is injected there.
declare const self: { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };

const runtimeCaching: RuntimeCaching[] = [
  // Never cache API traffic: responses are per-user and contain private data.
  {
    matcher: ({ url }) => url.pathname.startsWith('/api/'),
    handler: new NetworkOnly(),
  },
  // Page navigations always go to the network (authenticated HTML must not be stored);
  // when offline, the fallback below serves /offline.
  {
    matcher: ({ request }) => request.destination === 'document',
    handler: new NetworkOnly(),
  },
  // Fingerprinted build assets.
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
    handler: new CacheFirst({
      cacheName: 'static-build-assets',
      plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 30 * 24 * 60 * 60, maxAgeFrom: 'last-used' })],
    }),
  },
  // Fonts.
  {
    matcher: ({ request, url }) =>
      request.destination === 'font' || /^https:\/\/fonts\.gstatic\.com\//.test(url.href),
    handler: new CacheFirst({
      cacheName: 'fonts',
      plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 365 * 24 * 60 * 60, maxAgeFrom: 'last-used' })],
    }),
  },
  // Same-origin images (static files and the Next image optimizer).
  {
    matcher: ({ sameOrigin, request, url }) =>
      sameOrigin && (request.destination === 'image' || url.pathname.startsWith('/_next/image')),
    handler: new StaleWhileRevalidate({
      cacheName: 'static-images',
      plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 24 * 60 * 60, maxAgeFrom: 'last-used' })],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();
