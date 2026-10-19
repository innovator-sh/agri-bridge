-- 0002_security.sql
-- Lock the database down so the only way to reach data is the Next.js API.
--
-- SECURITY MODEL
--   The app does NOT use Supabase Auth and the browser never talks to Supabase.
--   Authentication is a signed httpOnly session cookie and authorisation is enforced
--   in the server-side API routes, which use the service-role key. The service_role
--   bypasses Row Level Security, so:
--     * RLS is ENABLED on every public table with NO policies. For the anon and
--       authenticated roles that means "deny everything".
--     * All table / sequence / function privileges are REVOKED from anon and
--       authenticated (defence in depth: even a future mistaken policy or a leaked
--       anon key cannot read or write tables through PostgREST).
--     * Default privileges are changed so objects created later stay locked down.
--   Do NOT add anon/authenticated policies or grants to "make something work": add
--   a server-side API route instead.
--
-- Safe to re-run. Run it again after adding new tables (0004_indexes.sql also
-- re-asserts RLS at its end as a safety net for tables created by 0003).

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on every table in public (no policies are created on purpose)
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end
$$;

-- Remove any policy left over from the legacy setup scripts (they were all permissive
-- USING (true) policies). With RLS on and no policies, anon/authenticated get nothing.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Revoke every privilege from the API roles
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- The server-side client (service_role) keeps full access.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 3. Keep it that way for objects created in the future
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- Supabase also installs default privileges for objects created by supabase_admin
-- (for example from the dashboard). Only applicable when the current role may alter them.
do $$
begin
  alter default privileges for role supabase_admin in schema public
    revoke all on tables from anon, authenticated;
  alter default privileges for role supabase_admin in schema public
    revoke all on sequences from anon, authenticated;
  alter default privileges for role supabase_admin in schema public
    revoke all on functions from public, anon, authenticated;
exception
  when insufficient_privilege or undefined_object then
    raise notice 'Skipped default privileges for supabase_admin (insufficient privilege or role missing).';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Remove arbitrary-SQL helpers
-- An exec_sql(...) RPC that runs caller-supplied SQL would defeat everything above.
-- Drop it whatever its argument list is.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'exec_sql'
      and n.nspname = 'public'
  loop
    execute format('drop function if exists %s cascade', f.signature);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Storage
-- The `Products` bucket is public, so object URLs are readable without any policy.
-- All uploads and deletes are done server-side with the service-role key, which
-- bypasses RLS. Therefore NO insert/update/delete policies are created for anon or
-- authenticated. Policies created by the legacy photo-setup instructions are removed.
-- ---------------------------------------------------------------------------
drop policy if exists "Public read access for Products" on storage.objects;
drop policy if exists "Public upload to Products"       on storage.objects;
drop policy if exists "Public update in Products"       on storage.objects;
drop policy if exists "Public delete in Products"       on storage.objects;

-- The legacy notes suggested disabling RLS on storage.objects. Make sure it is on.
-- (storage.objects is owned by supabase_storage_admin and RLS is on by default, so a
-- permission error here is harmless.)
do $$
begin
  alter table storage.objects enable row level security;
exception
  when insufficient_privilege then
    raise notice 'Could not alter storage.objects (not owner); RLS is enabled by default on Supabase.';
end
$$;
