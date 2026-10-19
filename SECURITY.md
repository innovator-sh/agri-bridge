# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately using GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(the "Report a vulnerability" button under this repository's **Security** tab).
Do not open a public issue or pull request for a suspected vulnerability.

Include a description, the affected route or file, reproduction steps and the impact you
expect. You will receive an acknowledgement, and fixes are developed in a private advisory
before disclosure.

## Supported versions

Only the latest commit on `main` is supported. Security fixes are not backported.

## Security model

- **Server-side data access only.** The browser never talks to Supabase. All reads and
  writes go through Next.js API routes that use the service-role key (`lib/supabase.ts`,
  marked `server-only`).
- **Database closed by default.** Row Level Security is enabled on every table with no
  policies, and all privileges are revoked from the `anon` and `authenticated` roles
  (`sql/0002_security.sql`). Even a leaked anon key cannot read or write tables.
- **Authentication.** A signed, httpOnly session cookie (`SESSION_SECRET`). Identity is taken
  only from the verified cookie, never from request bodies, query strings or client storage.
  Passwords are stored as bcrypt hashes.
- **Authorisation.** Enforced in each API route (role checks and ownership checks) before any
  database call, because the service role bypasses RLS.
- **Input validation.** Request bodies and query parameters are validated with zod; database
  and internal error details are not returned to clients.
- **Rate limiting** on sensitive routes such as login and registration.
- **Cron endpoint.** `/api/process-schedules` is authorised with `CRON_SECRET`.
- **Storage.** Product photos live in a public bucket (images only, 5 MB limit). Uploads and
  deletes happen server-side only; there are no anon write policies.
- **Secrets.** Real values live only in environment variables. `.env*` files are gitignored
  except `.env.example`, which contains placeholders.

## Automation

- Secret scanning of the full git history with gitleaks (pinned, checksum-verified binary).
- `npm audit` (blocking for production dependencies at high severity), dependency review on
  pull requests, and CodeQL analysis, on every push to `main`, every pull request and weekly.
- Dependabot for npm and GitHub Actions; third-party actions are pinned to commit SHAs.

## If a secret is exposed

Rotate it immediately (see `sql/README.md`), then remove it from the repository history.
Treat anything that was committed, logged or shared as compromised.
