import 'server-only';
import { env } from '@/lib/env';

// Server-only ML API configuration. The URL comes from ML_API_URL and is never exposed to the browser.
export const ML_API_CONFIG = {
  HEADERS: {
    // Bypasses the tunnel provider's interstitial page; only ever sent from the server.
    'ngrok-skip-browser-warning': 'true',
    Accept: 'application/json',
  } as Record<string, string>,
  TIMEOUT_MS: 30_000,
};

/** Full prediction endpoint, or null when ML_API_URL is not configured. */
export function getMlApiUrl(): string | null {
  const raw = env().ML_API_URL;
  if (!raw) return null;
  const url = new URL(raw);
  // Allow ML_API_URL to be either the service root or the full /predict endpoint.
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/predict';
  return url.toString();
}

export const isMLApiConfigured = (): boolean => getMlApiUrl() !== null;
