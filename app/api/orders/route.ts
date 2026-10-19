import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError } from '@/lib/api/errors';
import { requireRole, requireUser, uid } from '@/lib/auth/require';
import { rateLimit } from '@/lib/rate-limit';
import { createOrderSchema, ordersQuerySchema } from '@/lib/validation/orders';

const ORDER_SELECT = `
  *,
  buyer:users!orders_buyer_id_fkey (id, name, phone_number),
  seller:users!orders_seller_id_fkey (id, name, phone_number),
  product:products (id, name, category, photos)
`;

// GET - orders the session user is a party to (optionally narrowed by ?role=buyer|seller, ?status=)
export const GET = route(async (req) => {
  const session = await requireUser();
  const me = uid(session);
  const q = ordersQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const as = q.role ?? q.userType;

  let query = supabase.from('orders').select(ORDER_SELECT, { count: 'exact' });
  if (as === 'buyer') query = query.eq('buyer_id', me);
  else if (as === 'seller') query = query.eq('seller_id', me);
  else query = query.or(`buyer_id.eq.${me},seller_id.eq.${me}`);
  if (q.status) query = query.eq('status', q.status);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);

  if (error) {
    console.error('[orders] fetch failed', error);
    throw new HttpError(500, 'Failed to fetch orders');
  }

  return NextResponse.json({
    orders: data ?? [],
    total: count ?? 0,
    limit: q.limit,
    offset: q.offset,
  });
});

const PLACE_ORDER_ERRORS: Record<string, HttpError> = {
  insufficient_stock: new HttpError(409, 'Insufficient stock'),
  product_not_found: new HttpError(404, 'Product not found'),
  product_unavailable: new HttpError(409, 'Product is not available'),
  own_product: new HttpError(403, 'You cannot order your own product'),
};

// POST - place an order. Buyer, seller, prices and totals are all derived server-side.
export const POST = route(async (req) => {
  const session = await requireRole('buyer');
  const me = uid(session);
  rateLimit(`orders:${me}`, 30, 60_000);
  const body = await parseJson(req, createOrderSchema);

  const { data, error } = await supabase.rpc('place_order', {
    p_buyer_id: me,
    p_product_id: body.productId,
    p_quantity: body.quantity,
    p_delivery_address: body.deliveryAddress || null,
    p_notes: body.notes || null,
  } as never);

  if (error) {
    const known = Object.keys(PLACE_ORDER_ERRORS).find((k) => error.message?.includes(k));
    if (known) throw PLACE_ORDER_ERRORS[known];
    console.error('[orders] place_order failed', error);
    throw new HttpError(500, 'Failed to create order');
  }

  return NextResponse.json({ success: true, order: data, message: 'Order created successfully' });
});
