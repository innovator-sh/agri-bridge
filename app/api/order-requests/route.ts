import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError } from '@/lib/api/errors';
import { requireUser, requireRole, uid } from '@/lib/auth/require';
import { rateLimit } from '@/lib/rate-limit';
import { createOrderRequestSchema, pagination, todayIso } from '@/lib/validation/orderRequests';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

export const POST = route(async (req) => {
  const session = await requireRole('buyer');
  rateLimit(`order-requests:${uid(session)}`, 30, 60 * 60_000);
  const input = await parseJson(req, createOrderRequestSchema);

  const { data, error } = await supabase
    .from('order_requests')
    .insert({
      buyer_id: uid(session),
      product_name: input.product_name,
      quantity: input.quantity,
      by_date: input.by_date,
      allow_multiple_farmers: input.allow_multiple_farmers,
      description: input.description,
      max_price_per_unit: input.max_price_per_unit ?? null,
      status: 'open',
      // Scheduled requests are only created by the cron job, never by clients.
      is_scheduled: false,
      schedule_id: null,
    })
    .select()
    .single();

  if (error) {
    console.error('Order request creation error:', error);
    throw new HttpError(500, 'Failed to create order request');
  }

  return NextResponse.json({ success: true, orderRequest: data });
});

/** Buyers see their own requests; farmers see open requests they can apply to. */
export const GET = route(async (req) => {
  const session = await requireUser();
  const { limit, offset } = pagination.parse(Object.fromEntries(new URL(req.url).searchParams));

  if (session.role === 'buyer') {
    const { data, error, count } = await supabase
      .from('order_requests')
      .select(
        `
        *,
        order_applications (
          id,
          farmer_id,
          price_per_unit,
          available_quantity,
          delivery_date,
          notes,
          status,
          users!farmer_id (name, phone_number)
        )
      `,
        { count: 'exact' }
      )
      .eq('buyer_id', uid(session))
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Order requests fetch error:', error);
      throw new HttpError(500, 'Failed to fetch order requests');
    }
    return NextResponse.json({ orderRequests: data ?? [], total: count ?? data?.length ?? 0, limit, offset });
  }

  const { data, error, count } = await supabase
    .from('order_requests')
    .select(
      `
      id,
      buyer_id,
      product_name,
      quantity,
      by_date,
      allow_multiple_farmers,
      description,
      max_price_per_unit,
      status,
      created_at,
      is_scheduled,
      schedule_id,
      users!buyer_id (name, phone_number),
      order_applications!left (
        id,
        farmer_id,
        status
      )
    `,
      { count: 'exact' }
    )
    .eq('status', 'open')
    .gte('by_date', todayIso())
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Order requests fetch error:', error);
    throw new HttpError(500, 'Failed to fetch order requests');
  }
  return NextResponse.json({ orderRequests: data ?? [], total: count ?? data?.length ?? 0, limit, offset });
});
