-- 0004_indexes.sql
-- Plain btree indexes for foreign keys and the filter / sort columns used by the API.
-- Names match the legacy idx_* names where an equivalent existed, so re-running on an
-- upgraded database does not create duplicates. Safe to re-run.
--
-- Not repeated here because a UNIQUE constraint already provides the index:
--   users(email), users(phone_number), order_applications(order_request_id, farmer_id),
--   ratings(order_id, rater_id).
-- Indexes for cart_items belong in 0003_orders_cart.sql.

-- users: supplier directory (role = 'farmer' ordered by name)
create index if not exists idx_users_role_name on public.users (role, name);

-- products: seller listings (also covers the seller_id FK), category filter, and the
-- default catalogue query (status = 'active' ordered by newest first)
create index if not exists idx_products_seller on public.products (seller_id, status);
create index if not exists idx_products_category on public.products (category);
create index if not exists idx_products_status_created on public.products (status, created_at desc);

-- orders: per-user lists ordered by newest first, status filter, product FK
create index if not exists idx_orders_buyer_id on public.orders (buyer_id, created_at desc);
create index if not exists idx_orders_seller_id on public.orders (seller_id, created_at desc);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_product_id on public.orders (product_id);

-- ratings: lookups by order, by rater and by the rated user (profile pages / stats)
create index if not exists idx_ratings_order_id on public.ratings (order_id);
create index if not exists idx_ratings_rater_id on public.ratings (rater_id);
create index if not exists idx_ratings_rated_id on public.ratings (rated_id, rater_type, created_at desc);

-- order_requests: buyer's own list, the open feed for farmers, schedule FK
create index if not exists idx_order_requests_buyer_id on public.order_requests (buyer_id, status);
create index if not exists idx_order_requests_status on public.order_requests (status, by_date);
create index if not exists idx_order_requests_schedule_id on public.order_requests (schedule_id);

-- order_applications: farmer FK and status (order_request_id is the leading column of
-- the unique constraint)
create index if not exists idx_order_applications_farmer_id on public.order_applications (farmer_id);
create index if not exists idx_order_applications_status on public.order_applications (status);

-- order_schedules: buyer's list and the cron scan for due active schedules
create index if not exists idx_order_schedules_buyer_id on public.order_schedules (buyer_id);
create index if not exists idx_order_schedules_next_execution
  on public.order_schedules (next_execution_date)
  where is_active;

-- ---------------------------------------------------------------------------
-- Safety net: 0003 runs after 0002, so make sure every table that exists now
-- (including cart_items) has RLS enabled and nothing granted to the API roles.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables     in schema public to service_role;
grant all on all sequences  in schema public to service_role;
