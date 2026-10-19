import { NextResponse } from 'next/server';
import supabase from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError, badRequest, notFound } from '@/lib/api/errors';
import { requireUser, uid } from '@/lib/auth/require';
import { rateLimit } from '@/lib/rate-limit';
import {
  createRatingSchema,
  deleteRatingQuerySchema,
  ratingsQuerySchema,
  updateRatingSchema,
} from '@/lib/validation/ratings';

type Row = Record<string, any>;

const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
const fail = (what: string, err: unknown): never => {
  console.error(`[ratings] ${what}`, err);
  throw new HttpError(500, `Failed to ${what}`);
};

/** Attach rater/rated names and order->product with two batched queries (no per-row lookups). */
async function enrich(ratings: Row[], withRated: boolean): Promise<Row[]> {
  if (ratings.length === 0) return [];
  const userIds = [...new Set(ratings.flatMap((r) => [r.rater_id, r.rated_id]))];
  const orderIds = [...new Set(ratings.map((r) => r.order_id))];

  const [users, orders] = await Promise.all([
    supabase.from('users').select('id, name').in('id', userIds),
    supabase.from('orders').select('id, product_id, product:products (id, name)').in('id', orderIds),
  ]);
  if (users.error) fail('load ratings', users.error);
  if (orders.error) fail('load ratings', orders.error);

  const userMap = new Map(((users.data ?? []) as unknown as Row[]).map((u) => [Number(u.id), u]));
  const orderMap = new Map(((orders.data ?? []) as unknown as Row[]).map((o) => [Number(o.id), o]));
  const person = (id: number) => userMap.get(Number(id)) ?? { id, name: 'Unknown User' };

  return ratings.map((r) => {
    const o = orderMap.get(Number(r.order_id));
    return {
      ...r,
      rater: person(r.rater_id),
      ...(withRated ? { rated: person(r.rated_id) } : {}),
      order: o ? { id: o.id, product: o.product ?? { id: o.product_id, name: 'Unknown Product' } } : null,
    };
  });
}

// GET - ?orderId=, ?orderIds=1,2,3 (batch) or ?userId=&userType= (ratings received by a user)
export const GET = route(async (req) => {
  const me = uid(await requireUser());
  const q = ratingsQuerySchema.parse(query(req));
  const page = { limit: q.limit, offset: q.offset };

  const ids = q.orderIds ?? (q.orderId ? [q.orderId] : null);
  if (ids) {
    // Only orders the session user is a party to.
    const { data: orders, error: oErr } = await supabase
      .from('orders')
      .select('id')
      .in('id', ids)
      .or(`buyer_id.eq.${me},seller_id.eq.${me}`);
    if (oErr) fail('fetch ratings', oErr);
    const allowed = ((orders ?? []) as unknown as Row[]).map((o) => o.id);
    if (q.orderId && !q.orderIds && allowed.length === 0) throw notFound('Order');

    const { data, count, error } = allowed.length
      ? await supabase
          .from('ratings')
          .select('*', { count: 'exact' })
          .in('order_id', allowed)
          .order('created_at', { ascending: false })
          .range(q.offset, q.offset + q.limit - 1)
      : { data: [], count: 0, error: null };
    if (error) fail('fetch ratings', error);

    return NextResponse.json({
      ratings: await enrich((data ?? []) as unknown as Row[], true),
      total: count ?? 0,
      ...page,
    });
  }

  // Ratings received by a user (defaults to the session user); reviews are public profile data.
  const userId = q.userId ?? me;
  let received = supabase.from('ratings').select('*', { count: 'exact' }).eq('rated_id', userId);
  if (q.userType) received = received.eq('rater_type', q.userType === 'buyer' ? 'seller' : 'buyer');
  const { data, count, error } = await received
    .order('created_at', { ascending: false })
    .range(q.offset, q.offset + q.limit - 1);
  if (error) fail('fetch ratings', error);

  return NextResponse.json({
    ratings: await enrich((data ?? []) as unknown as Row[], false),
    total: count ?? 0,
    ...page,
  });
});

// POST - rate the other party of a delivered order you took part in
export const POST = route(async (req) => {
  const me = uid(await requireUser());
  rateLimit(`ratings:${me}`, 20, 60_000);
  const body = await parseJson(req, createRatingSchema);

  const { data: order, error: oErr } = await supabase
    .from('orders')
    .select('buyer_id, seller_id, status')
    .eq('id', body.orderId)
    .maybeSingle();
  if (oErr) fail('create rating', oErr);
  const o = order as unknown as Row | null;
  // Same 404 for missing and foreign orders so ids cannot be probed.
  if (!o || (o.buyer_id !== me && o.seller_id !== me)) throw notFound('Order');
  if (o.status !== 'delivered') throw badRequest('Only delivered orders can be rated');

  const asBuyer = o.buyer_id === me;
  const { data: created, error } = await supabase
    .from('ratings')
    .insert({
      order_id: body.orderId,
      rater_id: me,
      rated_id: asBuyer ? o.seller_id : o.buyer_id,
      rater_type: asBuyer ? 'buyer' : 'seller',
      rating: body.rating,
      review: body.review || null,
    } as never)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'You have already rated this order');
    fail('create rating', error);
  }

  const [rating] = await enrich([created as unknown as Row], true);
  return NextResponse.json({ success: true, rating, message: 'Rating submitted successfully' });
});

// PUT - edit your own rating
export const PUT = route(async (req) => {
  const me = uid(await requireUser());
  const body = await parseJson(req, updateRatingSchema);

  const { data, error } = await supabase
    .from('ratings')
    .update({ rating: body.rating, review: body.review || null, updated_at: new Date().toISOString() } as never)
    .eq('id', body.ratingId)
    .eq('rater_id', me)
    .select()
    .maybeSingle();
  if (error) fail('update rating', error);
  if (!data) throw notFound('Rating');

  const [rating] = await enrich([data as unknown as Row], true);
  return NextResponse.json({ success: true, rating, message: 'Rating updated successfully' });
});

// DELETE - remove your own rating (?ratingId=)
export const DELETE = route(async (req) => {
  const me = uid(await requireUser());
  const { ratingId } = deleteRatingQuerySchema.parse(query(req));

  const { data, error } = await supabase
    .from('ratings')
    .delete()
    .eq('id', ratingId)
    .eq('rater_id', me)
    .select('id');
  if (error) fail('delete rating', error);
  if (!data || data.length === 0) throw notFound('Rating');

  return NextResponse.json({ success: true, message: 'Rating deleted successfully' });
});
