# AgriBridge

A marketplace that connects farmers (sellers) directly with buyers. Farmers list produce with
photos and prices; buyers browse, order, rate sellers, and post standing requests that farmers
can apply to.

## Features at a glance

- Farmer and buyer accounts with role-based dashboards
- Product listings with photo upload, search by category, bulk and single pricing
- Cart and direct orders with a status flow (pending, confirmed, shipped, delivered, cancelled)
- Two-way ratings and reviews tied to orders
- Order requests: buyers post what they need, farmers apply with a price and quantity
- Recurring order schedules processed by a daily cron job
- Weather, market prices, government schemes and an AI chatbot (optional integrations)
- Multi-language interface (`messages/*.json`) and an installable PWA

## Stack

- Next.js 16 (App Router, Turbopack) and React 19
- Supabase: Postgres and Storage, accessed server-side only with the service-role key
- Tailwind CSS 4
- zod for validation, jose and bcryptjs for sessions and password hashing
- Serwist for the service worker

## Quick start

Prerequisites: Node 22 (see `.nvmrc`), npm, and a Supabase project.

```bash
cp .env.example .env.local
# generate a session secret (at least 32 characters) and paste it into .env.local
openssl rand -base64 48
```

1. Fill in `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SESSION_SECRET` in
   `.env.local`.
2. Apply the database migrations in `sql/` in numeric order (`0001` to `0004`) using the
   Supabase SQL editor or the CLI. See [`sql/README.md`](sql/README.md).
3. Install and run:

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Optionally seed a development database with sample accounts
(random passwords are printed once):

```bash
ALLOW_SEED=1 SEED_CONFIRM_URL="<your NEXT_PUBLIC_SUPABASE_URL>" \
  node --env-file=.env.local scripts/seed-dev.mjs
```

## Environment variables

| Variable | Purpose | Required |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database and storage access (never exposed to the browser) | Yes |
| `SESSION_SECRET` | Signs the session cookie, at least 32 characters | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Not used for data access | No |
| `CRON_SECRET` | Authorises `/api/process-schedules` (at least 16 characters) | Required for scheduled orders |
| `GROQ_API_KEY` | Chatbot and image quality analysis | No |
| `OPENWEATHER_API_KEY` | Weather data | No |
| `MARKET_DATA_API_KEY`, `MARKET_DATA_API_URL` | Market price data | No |
| `ML_API_URL` | Price prediction service | No |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Reserved for shared rate limiting | No |
| `ALLOW_SEED`, `SEED_CONFIRM_URL` | Safety flags for `scripts/seed-dev.mjs` only | No |

## Security model

- The browser never talks to Supabase. Every data access goes through an API route using the
  service-role key.
- Identity comes only from a signed httpOnly session cookie. Routes authenticate, authorise
  (role and ownership) and validate input before touching the database.
- Row Level Security is enabled on all tables with no policies, and privileges are revoked
  from `anon` and `authenticated`, so the database is unreachable except through the API.
- Product photos are public by URL; uploads and deletes are server-side only.
- Sensitive routes are rate limited and errors never leak database details.

See [`SECURITY.md`](SECURITY.md) for details and how to report a vulnerability.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `node scripts/seed-dev.mjs` | Dev-only seed data (guarded, see above) |

## Project layout

```
app/            Routes, pages and API handlers (app/api/**/route.ts)
components/     React components
lib/            Server and shared code: auth, env, supabase client, validation, services
messages/       Translation files
public/         Static assets and PWA manifest
sql/            Numbered database migrations (sql/legacy is reference only, do not apply)
scripts/        Developer scripts
proxy.ts        Request gate for /dashboard and /api
```

## CI and security automation

- **CI** (`.github/workflows/ci.yml`): `npm ci`, lint, typecheck and build on every push to
  `main` and every pull request, with dummy environment values.
- **Security** (`.github/workflows/security.yml`): gitleaks over full history, `npm audit`,
  dependency review on pull requests and CodeQL, on push, pull request and weekly.
- **Dependabot**: weekly grouped updates for npm and GitHub Actions. Major versions of
  react, react-dom, next, typescript and eslint are reviewed manually.
- All third-party actions are pinned to full commit SHAs.

## Deployment notes

Designed for Vercel.

1. Set the required environment variables in the project settings (use production values;
   never reuse development keys).
2. Apply the `sql/` migrations to the production Supabase project.
3. `vercel.json` registers a daily cron for `/api/process-schedules`. Set `CRON_SECRET` in the
   Vercel project; Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` and the route
   rejects requests without it.
4. Rotate keys if they are ever exposed (see `sql/README.md`).

## License

Released under the [MIT License](LICENSE).

## Contributors

| Contributor | GitHub |
| --- | --- |
| innovator-sh | [github.com/innovator-sh](https://github.com/innovator-sh) |
| Dhruv | [github.com/Dhruv-Bhagchandani](https://github.com/Dhruv-Bhagchandani) |
| Swayam | [github.com/swayamkambli14](https://github.com/swayamkambli14) |
| seudoe | [github.com/seudoe](https://github.com/seudoe) |
