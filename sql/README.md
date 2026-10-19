# Database migrations

The schema is plain SQL, applied in numeric order. All files are idempotent, so
re-running one is safe.

| File | Purpose |
| --- | --- |
| `0001_init.sql` | Tables, constraints, `updated_at` triggers, the `Products` storage bucket |
| `0002_security.sql` | Row Level Security on every table, privileges revoked from `anon` / `authenticated`, `exec_sql` removed, storage policies cleaned up |
| `0003_orders_cart.sql` | `cart_items` table and the `place_order` function |
| `0004_indexes.sql` | Indexes for foreign keys and filter / sort columns, plus a final RLS safety net |

## Legacy scripts: do NOT apply

`sql/legacy/` holds the original setup scripts, kept for reference only. They disable
Row Level Security and grant `anon` access, so running them would undo
`0002_security.sql`. The numbered files above are the only ones to apply.

## Applying

### Option A: Supabase SQL editor

1. Open the project dashboard, then SQL Editor.
2. Paste and run each file in order: `0001`, `0002`, `0003`, `0004`.

### Option B: Supabase CLI

The CLI expects migrations in `supabase/migrations`. Point it at this folder with a
symlink, or copy the files, then push:

```bash
supabase link --project-ref <your-project-ref>
mkdir -p supabase/migrations
cp sql/000*.sql supabase/migrations/
supabase db push
```

(`supabase/` is only a build artefact for the CLI; the files in `sql/` are the source of truth.)

## Security model in one paragraph

The browser never talks to Supabase. Every API route authenticates the signed session
cookie and authorises the request itself, then uses the service-role key, which bypasses
Row Level Security. Because of that, RLS is enabled with no policies and all privileges
are revoked from `anon` and `authenticated`: the database is closed to everything except
the server. Do not add policies or grants for those roles; add or change an API route
instead. Product photos are served from a public bucket (read by URL); uploads and deletes
happen server-side only.

## Rotating keys

- **Service-role key** (`SUPABASE_SERVICE_ROLE_KEY`): in the dashboard go to Project
  Settings, API, then rotate / regenerate the JWT secret or the service-role key as
  offered. Update the value in the hosting provider's environment settings (and
  `.env.local`) and redeploy. Treat any key that was ever committed, pasted in chat or
  logged as compromised and rotate it immediately.
- **Anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`): rotates together with the JWT secret.
  The app does not use it for data access.
- **`SESSION_SECRET`**: generate a new one with `openssl rand -base64 48`. Changing it
  signs every user out, which is the intended effect.
- **`CRON_SECRET`**: generate a new one with `openssl rand -base64 32` and update both the
  environment and the cron caller.
- **Database password**: Project Settings, Database, reset password. Only needed if you
  connect with a direct Postgres connection string (for example for the CLI).
