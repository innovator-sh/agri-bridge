import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError, notFound } from '@/lib/api/errors';
import { requireRole, uid } from '@/lib/auth/require';
import { cartAddSchema, cartRemoveSchema, cartSetSchema } from '@/lib/validation/cart';
import { paginationSchema } from '@/lib/validation/orders';

interface CartRow {
  product_id: number;
  quantity: number;
}

/** All of a user's cart rows in the legacy `{ product_id, quantity }` item shape. */
async function loadItems(userId: number): Promise<CartRow[]> {
  const { data, error } = await supabase
    .from('cart_items')
    .select('product_id, quantity')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    console.error('[cart] load items failed', error);
    throw new HttpError(500, 'Failed to load cart');
  }
  return (data ?? []) as unknown as CartRow[];
}

/** Rejects a cart quantity above the product's current stock, with the available amount in the message. */
async function assertWithinStock(productId: number, wanted: number) {
  const { data, error } = await supabase
    .from('products')
    .select('quantity, status')
    .eq('id', productId)
    .maybeSingle();
  if (error) {
    console.error('[cart] stock check failed', error);
    throw new HttpError(500, 'Failed to update cart');
  }
  const product = data as { quantity: number; status: string } | null;
  if (!product || product.status !== 'active') throw notFound('Product');
  if (wanted > product.quantity) {
    throw new HttpError(409, `Only ${product.quantity} kg available. Your cart would have ${wanted} kg.`);
  }
}

// GET - the session user's cart with product details
export const GET = route(async (req) => {
  const me = uid(await requireRole('buyer'));
  const { limit, offset } = paginationSchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data: rows, count, error } = await supabase
    .from('cart_items')
    .select('product_id, quantity', { count: 'exact' })
    .eq('user_id', me)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[cart] fetch failed', error);
    throw new HttpError(500, 'Failed to fetch cart');
  }

  const items = (rows ?? []) as unknown as CartRow[];
  const page = { total: count ?? 0, limit, offset };
  if (items.length === 0) {
    return NextResponse.json({ cart: { user_id: me, items: [], products: [] }, ...page });
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('*, users!products_seller_id_fkey (name, phone_number)')
    .in('id', items.map((i) => i.product_id))
    .eq('status', 'active');

  if (productsError) {
    console.error('[cart] products fetch failed', productsError);
    throw new HttpError(500, 'Failed to fetch cart');
  }

  const qty = new Map(items.map((i) => [i.product_id, i.quantity]));
  const transformed = ((products ?? []) as unknown as Record<string, any>[]).map((p) => ({
    ...p,
    seller_name: p.users?.name,
    seller_phone: p.users?.phone_number,
    photos: p.photos || [],
    cart_quantity: qty.get(p.id) ?? 0,
  }));

  return NextResponse.json({ cart: { user_id: me, items, products: transformed }, ...page });
});

// POST - add to cart (increments atomically if already present)
export const POST = route(async (req) => {
  const me = uid(await requireRole('buyer'));
  const { productId, quantity } = await parseJson(req, cartAddSchema);

  const { data: existing } = await supabase
    .from('cart_items')
    .select('quantity')
    .eq('user_id', me)
    .eq('product_id', productId)
    .maybeSingle();
  await assertWithinStock(productId, quantity + ((existing as { quantity: number } | null)?.quantity ?? 0));

  const { error } = await supabase.rpc('cart_add', {
    p_user_id: me,
    p_product_id: productId,
    p_quantity: quantity,
  } as never);
  if (error) {
    if (error.message?.includes('product_unavailable')) throw notFound('Product');
    console.error('[cart] add failed', error);
    throw new HttpError(500, 'Failed to update cart');
  }

  return NextResponse.json({
    success: true,
    cart: { user_id: me, items: await loadItems(me) },
    message: 'Product added to cart',
  });
});

// PUT - set an item's quantity (0 removes it)
export const PUT = route(async (req) => {
  const me = uid(await requireRole('buyer'));
  const { productId, quantity } = await parseJson(req, cartSetSchema);

  if (quantity === 0) {
    const { error } = await supabase.from('cart_items').delete().eq('user_id', me).eq('product_id', productId);
    if (error) {
      console.error('[cart] remove failed', error);
      throw new HttpError(500, 'Failed to update cart');
    }
  } else {
    await assertWithinStock(productId, quantity);
    const { data, error } = await supabase
      .from('cart_items')
      .update({ quantity } as never)
      .eq('user_id', me)
      .eq('product_id', productId)
      .select('id');
    if (error) {
      console.error('[cart] update failed', error);
      throw new HttpError(500, 'Failed to update cart');
    }
    if (!data || data.length === 0) throw notFound('Cart item');
  }

  return NextResponse.json({
    success: true,
    cart: { user_id: me, items: await loadItems(me) },
    message: 'Cart updated',
  });
});

// DELETE - remove an item
export const DELETE = route(async (req) => {
  const me = uid(await requireRole('buyer'));
  const { productId } = await parseJson(req, cartRemoveSchema);

  const { error } = await supabase.from('cart_items').delete().eq('user_id', me).eq('product_id', productId);
  if (error) {
    console.error('[cart] delete failed', error);
    throw new HttpError(500, 'Failed to update cart');
  }

  return NextResponse.json({
    success: true,
    cart: { user_id: me, items: await loadItems(me) },
    message: 'Product removed from cart',
  });
});
