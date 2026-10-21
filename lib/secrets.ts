// Pure helpers (no server-only import) so both env validation and proxy.ts can use them.

/** Values that appear in docs, examples and CI and must never sign real sessions. */
const PLACEHOLDER = /^(ci-only|dummy|generate-with|your-|change-?me|replace-?me|example|test-?secret|secret|password)/i;

export function isPlaceholderSecret(value: string | undefined): boolean {
  return !!value && PLACEHOLDER.test(value.trim());
}

/**
 * In production, placeholder secrets are refused. Local testing of a production build
 * (see testing.md) opts in explicitly with ALLOW_PLACEHOLDER_SECRETS=1.
 */
export function placeholderSecretsRefused(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.ALLOW_PLACEHOLDER_SECRETS !== '1';
}

export function secretIsUsable(value: string | undefined): boolean {
  return !!value && !(placeholderSecretsRefused() && isPlaceholderSecret(value));
}
