-- 0003_orders_cart.sql
-- Cart rewrite (cart_items), atomic order placement / status changes, stats helpers.
-- Idempotent where reasonable. Run in the Supabase SQL editor. Requires users, products, orders, ratings.

-- ---------------------------------------------------------------------------
-- 1. cart_items (replaces the single-row JSON/array cart table)
-- ---------------------------------------------------------------------------
-- Created and back-filled once: the data migration only runs when cart_items did not exist yet,
-- so re-running this file never resurrects items a user already removed.
DO $$
BEGIN
  IF to_regclass('public.cart_items') IS NULL THEN
    CREATE TABLE public.cart_items (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
      quantity   INTEGER NOT NULL CHECK (quantity > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, product_id)
    );

    IF to_regclass('public.cart') IS NOT NULL THEN
      -- Layout used by the app: items jsonb = [{"product_id": n, "quantity": n}, ...]
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'cart' AND column_name = 'items') THEN
        EXECUTE $m$
          INSERT INTO public.cart_items (user_id, product_id, quantity)
          SELECT c.user_id, (e->>'product_id')::int, SUM(GREATEST((e->>'quantity')::int, 1))::int
          FROM public.cart c
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.items, '[]'::jsonb)) e
          JOIN public.products p ON p.id = (e->>'product_id')::int
          WHERE c.user_id IS NOT NULL AND (e->>'product_id') ~ '^[0-9]+$'
          GROUP BY c.user_id, (e->>'product_id')::int
          ON CONFLICT (user_id, product_id) DO NOTHING
        $m$;
      END IF;
      -- Older layout: product_ids integer[] (one entry per unit added)
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'cart' AND column_name = 'product_ids') THEN
        EXECUTE $m$
          INSERT INTO public.cart_items (user_id, product_id, quantity)
          SELECT c.user_id, pid, COUNT(*)::int
          FROM public.cart c
          CROSS JOIN LATERAL unnest(COALESCE(c.product_ids, '{}')) AS pid
          JOIN public.products p ON p.id = pid
          WHERE c.user_id IS NOT NULL
          GROUP BY c.user_id, pid
          ON CONFLICT (user_id, product_id) DO NOTHING
        $m$;
      END IF;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cart_items_user_id ON public.cart_items (user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON public.cart_items (product_id);

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON public.cart_items FROM anon, authenticated;

-- Old cart table: verify cart_items is populated and nothing reads `cart` any more, then run manually:
-- DROP TABLE IF EXISTS public.cart;

-- ---------------------------------------------------------------------------
-- 2. Harden legacy tables whose setup scripts opened them to anon (service role bypasses RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view all ratings" ON public.ratings;
DROP POLICY IF EXISTS "Users can insert ratings" ON public.ratings;
DROP POLICY IF EXISTS "Users can update their own ratings" ON public.ratings;
REVOKE ALL ON public.orders FROM anon, authenticated;
REVOKE ALL ON public.ratings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. cart_add: atomic "add n to quantity" (no lost updates)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cart_add(p_user_id int, p_product_id int, p_quantity int)
RETURNS public.cart_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.cart_items;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND status = 'active') THEN
    RAISE EXCEPTION 'product_unavailable';
  END IF;
  INSERT INTO cart_items (user_id, product_id, quantity)
  VALUES (p_user_id, p_product_id, LEAST(p_quantity, 100000))
  ON CONFLICT (user_id, product_id)
  DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, 100000)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. place_order: price from the product row, atomic stock decrement + insert
--    Bulk rule (as in the existing UI): quantity >= 10 uses price_multiple when set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.place_order(
  p_buyer_id int,
  p_product_id int,
  p_quantity int,
  p_delivery_address text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_prod  record;
  v_unit  numeric;
  v_order public.orders;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  UPDATE products
     SET quantity = quantity - p_quantity
   WHERE id = p_product_id
     AND status = 'active'
     AND quantity >= p_quantity
  RETURNING seller_id, price_single, price_multiple INTO v_prod;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id) THEN
      RAISE EXCEPTION 'product_not_found';
    ELSIF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND status = 'active') THEN
      RAISE EXCEPTION 'product_unavailable';
    ELSE
      RAISE EXCEPTION 'insufficient_stock';
    END IF;
  END IF;

  IF v_prod.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'own_product';  -- rolls back the stock update
  END IF;

  v_unit := CASE
    WHEN p_quantity >= 10 AND v_prod.price_multiple IS NOT NULL AND v_prod.price_multiple > 0
      THEN v_prod.price_multiple
    ELSE v_prod.price_single
  END;

  INSERT INTO orders (buyer_id, seller_id, product_id, quantity, unit_price, total_price,
                      delivery_address, notes, status)
  VALUES (p_buyer_id, v_prod.seller_id, p_product_id, p_quantity, v_unit, v_unit * p_quantity,
          p_delivery_address, p_notes, 'pending')
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. update_order_status: ownership + transition rules + restock on cancel, atomically
--    seller: pending->confirmed|cancelled, confirmed->shipped|cancelled, shipped->delivered
--    buyer:  pending|confirmed->cancelled
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id int, p_actor_id int, p_status text)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_ok    boolean;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF p_actor_id = v_order.seller_id THEN
    v_ok := (v_order.status, p_status) IN (
      ('pending', 'confirmed'), ('pending', 'cancelled'),
      ('confirmed', 'shipped'), ('confirmed', 'cancelled'),
      ('shipped', 'delivered')
    );
  ELSIF p_actor_id = v_order.buyer_id THEN
    v_ok := v_order.status IN ('pending', 'confirmed') AND p_status = 'cancelled';
  ELSE
    RAISE EXCEPTION 'order_forbidden';
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;

  UPDATE orders SET status = p_status WHERE id = p_order_id RETURNING * INTO v_order;

  IF p_status = 'cancelled' THEN
    UPDATE products SET quantity = quantity + v_order.quantity WHERE id = v_order.product_id;
  END IF;

  RETURN v_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Aggregates for /api/user-stats
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_rating_counts(p_user_id int)
RETURNS TABLE (rating int, cnt bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.rating::int, COUNT(*) FROM ratings r WHERE r.rated_id = p_user_id GROUP BY r.rating;
$$;

CREATE OR REPLACE FUNCTION public.user_order_totals(p_user_id int, p_as text)
RETURNS TABLE (total_orders bigint, completed_orders bigint, total_value numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'delivered'),
         COALESCE(SUM(total_price) FILTER (WHERE status <> 'cancelled'), 0)
  FROM orders
  WHERE (p_as = 'buyer' AND buyer_id = p_user_id) OR (p_as = 'seller' AND seller_id = p_user_id);
$$;

-- ---------------------------------------------------------------------------
-- 7. Lock functions down to the service role
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.cart_add(int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.place_order(int, int, int, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_order_status(int, int, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_rating_counts(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_order_totals(int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cart_add(int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.place_order(int, int, int, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_order_status(int, int, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_rating_counts(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_order_totals(int, text) TO service_role;
