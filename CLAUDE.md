# AgriBridge: project context

Marketplace connecting farmers (sellers) and buyers. Next.js 16 (App Router; dev uses Turbopack, production build uses webpack for Serwist), React 19,
Supabase (Postgres + Storage) accessed server-side only with the service-role key, Tailwind 4,
i18n via `messages/*.json`, PWA via Serwist.

## Architecture rules (do not regress)
- Identity comes ONLY from the signed httpOnly cookie `ab_session` (`lib/auth/session.ts`).
  Routes call `requireUser()` / `requireRole()` from `lib/auth/require.ts` and use `uid(session)`.
  Never read user ids from request bodies, query strings or localStorage for authorisation.
- Every API route is wrapped with `route()` from `lib/api/handler.ts` and validates input with zod
  schemas in `lib/validation/`. Throw `HttpError` (lib/api/errors.ts); never return `error.message`
  from the database or stack traces.
- `lib/supabase.ts` is server-only (service role, bypasses RLS). All tables have RLS enabled with no
  anon/authenticated policies, so the browser cannot reach data except through our API.
- `proxy.ts` (Next 16 middleware) gates `/dashboard/*` and `/api/*` except the public auth routes,
  `/api/placeholder`, and cron routes (protected by `CRON_SECRET`).
- Rate limit sensitive routes with `rateLimit()` from `lib/rate-limit.ts`.
- Never cache `/api/*` in the service worker.
- List endpoints are paginated (default 20, max 50).

## Environment
See `.env.example`. Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET.
Optional: CRON_SECRET, GROQ_API_KEY, OPENWEATHER_API_KEY, MARKET_DATA_API_KEY/URL, ML_API_URL.

## Commands
`npm run dev` / `build` / `lint` / `typecheck`. Node 22.

## Database
SQL lives in `sql/` (apply in order via the Supabase SQL editor or CLI).

## Conventions
- Commits: one-line subject, blank line, then details. Commit only meaningful milestones.
- Planning notes and legacy docs live in `.notes/` (gitignored).
