# Testing and debugging guide

Every command needed to verify AgriBridge locally, from static checks to a full
farmer-to-buyer walkthrough, plus debugging recipes. Commands assume **Node 22** and a
**bash** shell (Git Bash on Windows). PowerShell equivalents are noted where they differ.

Expected results are given as `-> 401` style comments. If something differs, jump to
[Debugging](#7-debugging).

## Contents

1. [Setup](#1-setup)
2. [Static checks](#2-static-checks)
3. [Run the app](#3-run-the-app)
4. [Smoke test without a database](#4-smoke-test-without-a-database)
5. [Full walkthrough with a database](#5-full-walkthrough-with-a-database)
6. [Database checks](#6-database-checks)
7. [Debugging](#7-debugging)
8. [Repository guardrails and CI](#8-repository-guardrails-and-ci)

---

## 1. Setup

```bash
node -v                      # v22.x
npm ci                       # exact install from package-lock.json
cp .env.example .env.local   # then fill in the values below
```

Generate secrets (never reuse or commit them):

```bash
openssl rand -base64 48      # -> SESSION_SECRET
openssl rand -base64 32      # -> CRON_SECRET
```

Required in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SESSION_SECRET` (32+ characters). Optional: `CRON_SECRET`, `GROQ_API_KEY`,
`OPENWEATHER_API_KEY`, `MARKET_DATA_API_KEY`, `MARKET_DATA_API_URL`, `ML_API_URL`.
A missing or malformed required value fails the first request with
`Invalid or missing environment variables: ...`.

Apply the database scripts once, in order, in the Supabase SQL editor:
`sql/0001_init.sql`, `0002_security.sql`, `0003_orders_cart.sql`, `0004_indexes.sql`.
Never apply `sql/legacy/`.

Dummy values that are enough for build and the no-database smoke test (section 4):

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=dummy-service-role-key-for-ci-0000
export SESSION_SECRET=ci-only-secret-value-at-least-32-characters-long
```

```powershell
# PowerShell
$env:NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role-key-for-ci-0000"
$env:SESSION_SECRET = "ci-only-secret-value-at-least-32-characters-long"
```

## 2. Static checks

These are exactly what CI runs.

```bash
npm run typecheck            # tsc --noEmit            -> no output = pass
npm run lint                 # eslint                  -> 0 errors (warnings are known debt)
npm run build                # next build --webpack    -> "Compiled successfully"
```

Dependency and secret checks:

```bash
npm audit --omit=dev                     # -> found 0 vulnerabilities (production deps)
npm audit                                # includes dev tooling; some highs are known and non-blocking
npm outdated                             # what could be upgraded
gitleaks dir . --redact --no-banner      # secrets in the working tree  -> no leaks found
gitleaks git . --redact --no-banner      # secrets in full git history  -> no leaks found
```

Handy variants:

```bash
npx eslint app/api --max-warnings=0      # lint one folder strictly
npx eslint . -f json -o lint.json        # machine-readable report (do not commit)
npx tsc --noEmit --incremental false     # ignore the stale tsbuildinfo cache
```

## 3. Run the app

```bash
npm run dev                  # Turbopack dev server, http://localhost:3000
```

Production-like (this is what the service worker and security headers are tested against):

```bash
npm run build && npm run start           # http://localhost:3000
npx next start -p 3111                   # same, on another port
```

The service worker is only built in production builds, never in `npm run dev`.

## 4. Smoke test without a database

Uses the dummy environment from section 1. Start the production build, then in a second
terminal run the checks. Nothing here touches Supabase.

```bash
B=http://localhost:3000

# Authentication is enforced
curl -s -o /dev/null -w '%{http_code}\n' $B/api/cart                          # -> 401
curl -s -o /dev/null -w '%{http_code}\n' $B/api/products                      # -> 401
curl -s -o /dev/null -w '%{http_code}\n' $B/dashboard/buyer                   # -> 307 (redirect to /login)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: ab_session=abc.def.ghi' $B/api/cart   # -> 401 forged cookie

# Removed routes are not reachable
curl -s -o /dev/null -w '%{http_code}\n' $B/api/users                         # -> 401 (and no handler exists)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/migrate               # -> 401

# Input validation returns 400 with a list of issues, never a stack trace
curl -s -w '\n%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' $B/api/auth/login   # -> 400

# Cron endpoint needs its secret
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/process-schedules     # -> 503 if CRON_SECRET unset, 401 if set but missing/wrong

# Placeholder image cannot be used for script injection
curl -s "$B/api/placeholder/%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E/300"    # -> plain SVG, no <script>
curl -sI "$B/api/placeholder/300/200" | grep -i 'content-security-policy'     # -> default-src 'none'

# Security headers
curl -sI $B/login | grep -iE 'strict-transport|x-frame|x-content-type|content-security|referrer-policy|permissions-policy'
curl -sI $B/login | grep -i 'x-powered-by'                                    # -> (nothing)
```

### Signed-token tests (role enforcement, no database needed)

Sign a session cookie with your `SESSION_SECRET` to act as a user with a chosen role:

```bash
token() {   # usage: token <userId> <farmer|buyer>
  node -e "import('jose').then(async({SignJWT})=>{console.log(await new SignJWT({role:'$2'}).setProtectedHeader({alg:'HS256'}).setSubject('$1').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.SESSION_SECRET)))})"
}
BUYER=$(token 7 buyer); FARMER=$(token 8 farmer)

# A buyer must not be able to act as a farmer
curl -s -w ' %{http_code}\n' -X POST -H "Cookie: ab_session=$BUYER" -H 'content-type: application/json' -d '{"name":"x"}' $B/api/products      # -> 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Cookie: ab_session=$BUYER" $B/api/upload-photo                                          # -> 403

# Validation runs before any database work
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Cookie: ab_session=$BUYER" -H 'content-type: application/json' -d '{}' $B/api/order-schedules   # -> 400

# Client-supplied "system" chat turns are rejected
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Cookie: ab_session=$BUYER" -H 'content-type: application/json' \
  -d '{"message":"hi","conversationHistory":[{"role":"system","content":"x"}]}' $B/api/chatbot                                                # -> 400

# Algorithm-none token must be rejected
H=$(printf '{"alg":"none","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
P=$(printf '{"sub":"1","role":"farmer"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: ab_session=$H.$P." $B/api/cart                                                          # -> 401
```

## 5. Full walkthrough with a database

Needs real Supabase values in `.env.local` and the four SQL files applied. Run the app
(`npm run dev` or `npm run start`), then use a cookie jar so the session persists between
requests. Use two jars: one farmer, one buyer.

```bash
B=http://localhost:3000
J_F=/tmp/farmer.jar; J_B=/tmp/buyer.jar; rm -f $J_F $J_B
JSON='content-type: application/json'
```

### 5.1 Optional: seed development data

Refuses to run unless explicitly confirmed. **Development projects only.** Passwords are
random and printed once.

```bash
ALLOW_SEED=1 SEED_CONFIRM_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  node --env-file=.env.local scripts/seed-dev.mjs
```

### 5.2 Register and log in

```bash
curl -s -c $J_F -X POST -H "$JSON" $B/api/auth/register \
  -d '{"name":"Test Farmer","email":"farmer@example.test","phone_number":"9000000001","password":"correct-horse-9","role":"farmer"}'   # -> 201
curl -s -c $J_B -X POST -H "$JSON" $B/api/auth/register \
  -d '{"name":"Test Buyer","email":"buyer@example.test","phone_number":"9000000002","password":"correct-horse-9","role":"buyer"}'      # -> 201

curl -s -b $J_F $B/api/auth/me                       # -> your user, no password field
curl -s -c $J_F -X POST -H "$JSON" $B/api/auth/login -d '{"identifier":"farmer@example.test","password":"correct-horse-9"}'   # -> 200
curl -s -w ' %{http_code}\n' -X POST -H "$JSON" $B/api/auth/login -d '{"identifier":"farmer@example.test","password":"wrong"}' # -> 401 "Invalid credentials"
curl -s -w ' %{http_code}\n' -X POST -H "$JSON" $B/api/auth/login -d '{"identifier":"nobody@example.test","password":"wrong"}'  # -> same 401 and message (no account enumeration)
curl -s -w ' %{http_code}\n' -X POST -H "$JSON" $B/api/auth/register -d '{"name":"Dup","email":"farmer@example.test","password":"correct-horse-9","role":"buyer"}'  # -> 409
curl -s -b $J_F -c $J_F -X POST $B/api/auth/logout   # -> clears the cookie
```

Inspect the cookie flags (expect `HttpOnly`, `SameSite=Lax`, and `Secure` in production):

```bash
curl -si -X POST -H "$JSON" $B/api/auth/login -d '{"identifier":"farmer@example.test","password":"correct-horse-9"}' | grep -i set-cookie
```

### 5.3 Products and photos (farmer)

```bash
curl -s -b $J_F -X POST -H "$JSON" $B/api/products \
  -d '{"name":"Tomatoes","category":"vegetables","quantity":100,"price_single":30,"price_multiple":25,"location":"Pune"}'     # -> 201, note the id
curl -s -b $J_B "$B/api/products?limit=5&offset=0"             # buyer lists products (paginated: limit max 50)
curl -s -b $J_B "$B/api/products?search=tomato&category=vegetables"
curl -s -b $J_F -X PUT -H "$JSON" $B/api/products/1 -d '{"quantity":120,"status":"active"}'      # owner only
curl -s -w ' %{http_code}\n' -b $J_B -X PUT -H "$JSON" $B/api/products/1 -d '{"quantity":1}'     # -> 403 (buyer)

# Upload: JPEG/PNG/WebP, up to 5 MB, content checked by magic bytes
curl -s -b $J_F -F "file=@./photo.jpg;type=image/jpeg" -F "productId=1" $B/api/upload-photo      # -> {success,url,path}
echo 'not an image' > fake.jpg
curl -s -w ' %{http_code}\n' -b $J_F -F "file=@./fake.jpg;type=image/jpeg" -F "productId=1" $B/api/upload-photo   # -> 400 (bad magic bytes)
curl -s -b $J_F -X POST -H "$JSON" $B/api/delete-photo -d '{"productId":1,"url":"<url from upload>"}'
```

### 5.4 Cart and orders (buyer)

```bash
curl -s -b $J_B -X POST -H "$JSON" $B/api/cart -d '{"productId":1,"quantity":2}'     # add
curl -s -b $J_B -X PUT  -H "$JSON" $B/api/cart -d '{"productId":1,"quantity":3}'     # set; 0 removes
curl -s -b $J_B $B/api/cart

# Price is computed on the server: sending unitPrice/totalPrice has no effect
curl -s -b $J_B -X POST -H "$JSON" $B/api/orders \
  -d '{"productId":1,"quantity":10,"deliveryAddress":"1 Test Road","unitPrice":1,"totalPrice":1}'   # -> 201, total uses real price_multiple

curl -s -w ' %{http_code}\n' -b $J_F -X POST -H "$JSON" $B/api/orders -d '{"productId":1,"quantity":1}'   # -> 403 (farmers cannot buy)
curl -s -w ' %{http_code}\n' -b $J_B -X POST -H "$JSON" $B/api/orders -d '{"productId":1,"quantity":999999}' # -> 409 insufficient stock

curl -s -b $J_B "$B/api/orders?role=buyer"
curl -s -b $J_F "$B/api/orders?role=seller"

# Status transitions: seller pending->confirmed->shipped->delivered; buyer may cancel early
curl -s -b $J_F -X PUT -H "$JSON" $B/api/orders/1 -d '{"status":"confirmed"}'
curl -s -w ' %{http_code}\n' -b $J_F -X PUT -H "$JSON" $B/api/orders/1 -d '{"status":"delivered"}'   # -> 409 (skips a step)
```

### 5.5 Ratings

A rating is only allowed once the order is `delivered`, one per user per order.

```bash
curl -s -b $J_B -X POST -H "$JSON" $B/api/ratings -d '{"orderId":1,"rating":5,"review":"Fresh"}'     # -> 201 (after delivery)
curl -s -w ' %{http_code}\n' -b $J_B -X POST -H "$JSON" $B/api/ratings -d '{"orderId":1,"rating":4}' # -> 409 duplicate
curl -s -b $J_B "$B/api/ratings?orderIds=1,2,3"       # batch, only orders you are a party to
curl -s -b $J_B "$B/api/user-stats"                    # your own stats
curl -s -b $J_B "$B/api/user-stats?userId=2"           # another user: public rating summary only
```

### 5.6 Order requests, applications and schedules

```bash
curl -s -b $J_B -X POST -H "$JSON" $B/api/order-requests \
  -d '{"product_name":"Onions","quantity":50,"by_date":"2030-01-01","description":"Bulk"}'          # buyer; date must be in the future
curl -s -b $J_F "$B/api/order-requests"                     # farmer sees open requests
curl -s -b $J_F -X POST -H "$JSON" $B/api/order-applications -d '{"order_request_id":1,"available_quantity":50,"price_per_unit":20}'
curl -s -b $J_B -X PUT  -H "$JSON" $B/api/order-applications -d '{"application_id":1,"status":"accepted"}'

curl -s -b $J_B -X POST -H "$JSON" $B/api/order-schedules \
  -d '{"product_name":"Tomatoes","quantity":20,"schedule_type":"weekly","schedule_day":1,"days_before_needed":7}'
curl -s -b $J_B "$B/api/order-schedules"
curl -s -b $J_B -X DELETE "$B/api/order-schedules?schedule_id=1"
```

Cron runner (only the scheduler may call it; in production Vercel sends the bearer secret):

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" $B/api/process-schedules   # -> {success,processed,...}
curl -s -w ' %{http_code}\n' -X POST -H "Authorization: Bearer wrong" $B/api/process-schedules   # -> 401
```

### 5.7 External-service routes (need their keys)

```bash
curl -s -b $J_B -X POST -H "$JSON" $B/api/chatbot -d '{"message":"How do I store tomatoes?"}'   # needs GROQ_API_KEY, else 503
curl -s -b $J_B $B/api/schemes                                                                   # cached 24h; GROQ_API_KEY
curl -s -b $J_B "$B/api/weather?city=Pune"                                                       # or ?lat=18.52&lon=73.85
curl -s -w ' %{http_code}\n' -b $J_B "$B/api/weather?lat=999&lon=0"                              # -> 400
curl -s -b $J_B "$B/api/market-data?productName=Tomato&state=Maharashtra"                        # needs MARKET_DATA_API_KEY/URL
curl -s -b $J_B -F "file=@./photo.jpg;type=image/jpeg" $B/api/quality-analysis                   # needs ML_API_URL, else 503
```

### 5.8 Abuse limits

Rate limits are per client IP or user and reset when the server restarts.

```bash
# Login: 10 attempts per 15 minutes -> the 11th returns 429
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "$i: %{http_code}\n" -X POST -H "$JSON" $B/api/auth/login -d '{"identifier":"x@example.test","password":"bad"}'
done
# Register: 5 per hour. Chatbot: 20 per 10 minutes. Upload: 20 per 10 minutes.
```

### 5.9 Authorisation (IDOR) checks

Create a second farmer, then confirm they cannot touch the first farmer's data:

```bash
curl -s -w ' %{http_code}\n' -b $J_F2 -X PUT -H "$JSON" $B/api/products/1 -d '{"quantity":0}'   # -> 403
curl -s -w ' %{http_code}\n' -b $J_F2 -X DELETE $B/api/products/1                                # -> 403
curl -s -w ' %{http_code}\n' -b $J_F2 -X PUT -H "$JSON" $B/api/orders/1 -d '{"status":"cancelled"}'   # -> 404 (not a party)
```

### 5.10 Browser walkthrough

1. Open `http://localhost:3000/login`, register a farmer, add a product with a photo.
2. In a private window register a buyer, add the product to the cart, check out.
3. As the farmer confirm, ship and deliver the order; as the buyer leave a rating.
4. DevTools -> Application -> Cookies: `ab_session` is `HttpOnly`; Local Storage holds no user object.
5. Production build only: Application -> Service Workers shows `sw.js`; Network -> Offline,
   reload a page, and you get the offline fallback; `/api/*` is never served from cache.

## 6. Database checks

Run in the Supabase SQL editor.

```sql
-- Every public table must have RLS on (rowsecurity = true)
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;

-- Must return no rows: anon/authenticated should hold no table privileges
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');

-- Must return no rows: no policies for the browser roles
select * from pg_policies where schemaname = 'public';

-- exec_sql must not exist
select proname from pg_proc where proname = 'exec_sql';

-- Atomic ordering functions exist
select proname from pg_proc where proname in ('place_order','update_order_status','cart_add');

-- Stock never goes negative
select id, name, quantity from products where quantity < 0;

-- Passwords are bcrypt hashes ($2a/$2b prefix), never plain text
select id, left(password, 4) as prefix from users limit 5;

-- Storage bucket is public-read with limits
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'Products';
```

Concurrency check for stock: with `quantity = 1`, fire two simultaneous orders; exactly one
succeeds and the other gets 409.

```bash
for i in 1 2; do curl -s -o /dev/null -w "%{http_code}\n" -b $J_B -X POST -H "$JSON" $B/api/orders -d '{"productId":1,"quantity":1}' & done; wait
```

## 7. Debugging

### Server will not start or every request is a 500

```bash
cat .env.local | sed -E 's/=.{6,}/=<set>/'     # which variables are set, without printing values
node --env-file=.env.local -e "console.log(process.env.SESSION_SECRET?.length)"   # must be >= 32
```

`Invalid or missing environment variables: X` names the failing variable. Fix `.env.local`
and restart; values are validated once and cached.

### Port already in use

```bash
netstat -ano | grep ':3000 '                    # Git Bash: find the PID in the last column
taskkill //PID <pid> //F                        # Git Bash
```

```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
Stop-Process -Id <pid> -Force
```

### Stale build or odd behaviour

```bash
rm -rf .next tsconfig.tsbuildinfo public/sw.js   # generated, safe to delete
npm run build
rm -rf node_modules && npm ci                    # last resort
```

```powershell
Remove-Item -Recurse -Force .next, tsconfig.tsbuildinfo
```

### Always logged out or unexpected 401

```bash
# Does the cookie exist and verify? Decode its payload (not the signature):
echo "<ab_session value>" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null; echo

# Is it expired? (7-day lifetime) Is SESSION_SECRET the same one that signed it? Changing it logs everyone out.
curl -s -b "ab_session=<value>" -w ' %{http_code}\n' http://localhost:3000/api/auth/me
```

Over plain `http://` in production mode the `Secure` cookie flag stops the browser storing
the cookie; test production builds on localhost (browsers allow it) or over HTTPS.

### See what the server logged

API errors are logged server-side as `[api] METHOD /path`, and clients only ever get a
generic message. Watch the terminal running `npm run dev` / `npm run start`, or:

```bash
npm run start 2>&1 | tee /tmp/app.log
grep '\[api\]' /tmp/app.log
```

### Inspect a request and its headers

```bash
curl -v http://localhost:3000/login 2>&1 | head -40     # request and response headers
curl -sI http://localhost:3000/api/cart                  # status line only
curl -s -D - -o /dev/null -b $J_B http://localhost:3000/api/products
```

### 429 Too many requests while testing

Limits are in memory per server process: restart the server to reset them.

### Type or lint errors in one file

```bash
npx tsc --noEmit 2>&1 | grep 'app/api/orders'
npx eslint app/api/orders/route.ts
npx eslint . --fix                                       # auto-fix what is safe
```

### Build fails only in CI

```bash
npm ci && npm run lint && npm run typecheck && npm run build   # same steps and order as CI
node -v                                                        # CI uses Node 22
```

### Service worker problems (production build only)

```bash
npm run build && npm run start
```

In DevTools -> Application -> Service Workers, tick "Update on reload" or press
"Unregister", then hard-reload. Application -> Storage -> "Clear site data" resets caches.

### Database errors

- `relation "..." does not exist`: the SQL files were not applied, or not in order.
- `permission denied for table`: the app must use the **service-role** key, not the anon key.
- `insufficient_stock` surfaces as HTTP 409 by design.
- After SQL changes, reload the API schema cache in the dashboard (Settings -> API) if a new
  table or column is not seen.

## 8. Repository guardrails and CI

Local git hooks (in `.git/hooks`, not committed) block commits that contain secrets or a
non-noreply author email. Check them without committing:

```bash
git config user.email                                  # must end with @users.noreply.github.com
gitleaks protect --staged --redact --no-banner         # scan only what is staged
git log --format='%an <%ae>' | sort | uniq -c          # only the noreply identity should appear
git log --format='%h %s%n%b' | less                     # eyeball messages: one-line subject, details, no trailers
git ls-files | grep -E '\.env($|\.local)|\.pem$|\.key$' || echo "no secrets tracked"
```

GitHub side, with the GitHub CLI:

```bash
gh run list --limit 5                                  # recent CI and Security runs
gh run view <run-id> --log-failed                      # logs of failed steps only
gh run watch                                           # follow the current run live
gh pr list                                             # open Dependabot pull requests
gh pr checks <number>                                  # check results for one PR
gh workflow run security.yml                           # trigger the Security workflow manually
```

CodeQL and dependency review are skipped while the repository is private (they need GitHub
Advanced Security) and start running automatically once it is public.
