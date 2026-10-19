-- 0001_init.sql
-- Consolidated, idempotent base schema for the marketplace.
--
-- Conventions
--   * Ids are INTEGER serial columns (users.id and every foreign key are INTEGER).
--   * Timestamps are timestamptz and default to now().
--   * Status / type columns are constrained with CHECK so bad values cannot be stored.
--   * The legacy `cart` table is intentionally NOT created here; the cart lives in
--     `cart_items`, created by 0003_orders_cart.sql.
--   * Row Level Security and privileges are handled in 0002_security.sql, indexes in
--     0004_indexes.sql.
--
-- Safe to re-run: every statement uses IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT.

-- ---------------------------------------------------------------------------
-- Shared trigger function: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users
-- `password` holds a bcrypt hash, never a plain-text password.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id           serial primary key,
  name         varchar(255) not null,
  email        varchar(255) not null unique,
  phone_number varchar(20) unique,
  password     varchar(255) not null,
  role         varchar(50)  not null check (role in ('farmer', 'buyer')),
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

-- ---------------------------------------------------------------------------
-- products (listed by farmers)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id             serial primary key,
  name           varchar(255) not null,
  category       varchar(100) not null,
  quantity       integer      not null check (quantity >= 0),
  seller_id      integer      not null references public.users (id) on delete cascade,
  price_single   numeric(10, 2) not null check (price_single >= 0),
  price_multiple numeric(10, 2) check (price_multiple is null or price_multiple >= 0),
  location       varchar(255),
  description    text,
  photos         text[]       not null default '{}',
  status         varchar(50)  not null default 'active'
                 check (status in ('active', 'inactive', 'sold')),
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

-- ---------------------------------------------------------------------------
-- orders (direct purchases of a product)
-- product_id is SET NULL on product deletion so order history is preserved.
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id               serial primary key,
  buyer_id         integer not null references public.users (id) on delete cascade,
  seller_id        integer not null references public.users (id) on delete cascade,
  product_id       integer references public.products (id) on delete set null,
  quantity         integer not null check (quantity > 0),
  unit_price       numeric(10, 2) not null check (unit_price >= 0),
  total_price      numeric(10, 2) not null check (total_price >= 0),
  status           varchar(50) not null default 'pending'
                   check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  order_date       timestamptz not null default now(),
  delivery_address text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint orders_buyer_seller_differ check (buyer_id <> seller_id)
);

-- ---------------------------------------------------------------------------
-- ratings (one rating per rater per order)
-- rater_type is the role the rater played in the order ('buyer' or 'seller').
-- ---------------------------------------------------------------------------
create table if not exists public.ratings (
  id         serial primary key,
  order_id   integer not null references public.orders (id) on delete cascade,
  rater_id   integer not null references public.users (id) on delete cascade,
  rated_id   integer not null references public.users (id) on delete cascade,
  rater_type varchar(10) not null check (rater_type in ('buyer', 'seller')),
  rating     integer not null check (rating between 1 and 5),
  review     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_order_rater unique (order_id, rater_id),
  constraint ratings_rater_rated_differ check (rater_id <> rated_id)
);

-- ---------------------------------------------------------------------------
-- order_schedules (recurring buyer requests, processed by /api/process-schedules)
-- Created before order_requests because order_requests.schedule_id references it.
-- schedule_day: day of month (1-31) for monthly, day of week (0-6) for weekly.
-- ---------------------------------------------------------------------------
create table if not exists public.order_schedules (
  id                     serial primary key,
  buyer_id               integer not null references public.users (id) on delete cascade,
  product_name           varchar(255) not null,
  quantity               integer not null check (quantity > 0),
  allow_multiple_farmers boolean not null default false,
  description            text not null default '',
  max_price_per_unit     numeric(10, 2) check (max_price_per_unit is null or max_price_per_unit >= 0),
  schedule_type          varchar(20) not null check (schedule_type in ('monthly', 'weekly', 'daily')),
  schedule_day           integer check (schedule_day is null or schedule_day between 0 and 31),
  schedule_time          time default '09:00:00',
  days_before_needed     integer not null default 7 check (days_before_needed >= 0),
  is_active              boolean not null default true,
  next_execution_date    date not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- order_requests (buyer asks for a product; farmers apply)
-- ---------------------------------------------------------------------------
create table if not exists public.order_requests (
  id                     serial primary key,
  buyer_id               integer not null references public.users (id) on delete cascade,
  product_name           varchar(255) not null,
  quantity               integer not null check (quantity > 0),
  by_date                date not null,
  allow_multiple_farmers boolean not null default false,
  description            text not null default '',
  max_price_per_unit     numeric(10, 2) check (max_price_per_unit is null or max_price_per_unit >= 0),
  status                 varchar(20) not null default 'open'
                         check (status in ('open', 'closed', 'cancelled')),
  is_scheduled           boolean not null default false,
  schedule_id            integer references public.order_schedules (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- order_applications (a farmer's offer on an order request)
-- ---------------------------------------------------------------------------
create table if not exists public.order_applications (
  id                 serial primary key,
  order_request_id   integer not null references public.order_requests (id) on delete cascade,
  farmer_id          integer not null references public.users (id) on delete cascade,
  price_per_unit     numeric(10, 2) not null check (price_per_unit > 0),
  available_quantity integer not null check (available_quantity > 0),
  delivery_date      date,
  notes              text not null default '',
  status             varchar(20) not null default 'pending'
                     check (status in ('pending', 'accepted', 'rejected')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- one application per farmer per request
  unique (order_request_id, farmer_id)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists update_users_updated_at on public.users;
create trigger update_users_updated_at
  before update on public.users
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_products_updated_at on public.products;
create trigger update_products_updated_at
  before update on public.products
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_orders_updated_at on public.orders;
create trigger update_orders_updated_at
  before update on public.orders
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_ratings_updated_at on public.ratings;
create trigger update_ratings_updated_at
  before update on public.ratings
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_order_schedules_updated_at on public.order_schedules;
create trigger update_order_schedules_updated_at
  before update on public.order_schedules
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_order_requests_updated_at on public.order_requests;
create trigger update_order_requests_updated_at
  before update on public.order_requests
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_order_applications_updated_at on public.order_applications;
create trigger update_order_applications_updated_at
  before update on public.order_applications
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Storage bucket for product photos
-- Public read (object URLs are embedded in product listings), 5 MB per file,
-- images only. Writes happen server-side with the service-role key; see
-- 0002_security.sql for why there are no storage write policies.
-- The bucket id is case sensitive and must match the name used in the upload routes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'Products',
  'Products',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
