import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError, badRequest, forbidden, notFound } from '@/lib/api/errors';
import { requireRole, uid } from '@/lib/auth/require';
import {
  APPLICATION_TRANSITIONS,
  createApplicationSchema,
  todayIso,
  updateApplicationSchema,
} from '@/lib/validation/orderRequests';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

/** Farmers apply to open order requests; the applicant is always the session user. */
export const POST = route(async (req) => {
  const session = await requireRole('farmer');
  const farmerId = uid(session);
  const input = await parseJson(req, createApplicationSchema);

  const { data: orderRequest, error: orderError } = await supabase
    .from('order_requests')
    .select('allow_multiple_farmers, status, by_date')
    .eq('id', input.order_request_id)
    .maybeSingle();
  if (orderError) {
    console.error('Order request lookup error:', orderError);
    throw new HttpError(500, 'Failed to submit application');
  }
  if (!orderRequest) throw notFound('Order request');
  if (orderRequest.status !== 'open' || String(orderRequest.by_date) < todayIso()) {
    throw badRequest('This order request is no longer open');
  }

  const { data: existing, error: existingError } = await supabase
    .from('order_applications')
    .select('farmer_id')
    .eq('order_request_id', input.order_request_id);
  if (existingError) {
    console.error('Applications lookup error:', existingError);
    throw new HttpError(500, 'Failed to submit application');
  }
  if (existing?.some((a) => Number(a.farmer_id) === farmerId)) {
    throw badRequest('You have already applied to this order request');
  }
  if (!orderRequest.allow_multiple_farmers && existing && existing.length > 0) {
    throw badRequest('This order request only allows one farmer application');
  }

  const { data, error } = await supabase
    .from('order_applications')
    .insert({
      order_request_id: input.order_request_id,
      farmer_id: farmerId,
      price_per_unit: input.price_per_unit,
      available_quantity: input.available_quantity,
      delivery_date: input.delivery_date ?? null,
      notes: input.notes,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    // 23505 = unique(order_request_id, farmer_id): lost a race with a duplicate submit.
    if (error.code === '23505') throw badRequest('You have already applied to this order request');
    console.error('Application creation error:', error);
    throw new HttpError(500, 'Failed to submit application');
  }

  return NextResponse.json({ success: true, application: data });
});

/** The buyer who owns the order request accepts or rejects a pending application. */
export const PUT = route(async (req) => {
  const session = await requireRole('buyer');
  const { application_id, status } = await parseJson(req, updateApplicationSchema);

  const { data: application, error: appError } = await supabase
    .from('order_applications')
    .select('id, status, order_request_id, order_requests!inner (buyer_id, status)')
    .eq('id', application_id)
    .maybeSingle();
  if (appError) {
    console.error('Application lookup error:', appError);
    throw new HttpError(500, 'Failed to update application');
  }
  if (!application) throw notFound('Application');

  const request = application.order_requests as unknown as { buyer_id: number; status: string };
  if (Number(request.buyer_id) !== uid(session)) throw forbidden();

  if (!APPLICATION_TRANSITIONS[application.status as string]?.includes(status)) {
    throw badRequest(`Cannot change an application from ${application.status} to ${status}`);
  }
  if (status === 'accepted' && request.status !== 'open') {
    throw badRequest('This order request is no longer open');
  }

  const { data, error } = await supabase
    .from('order_applications')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', application_id)
    .eq('status', 'pending')
    .select()
    .single();
  if (error || !data) {
    console.error('Application update error:', error);
    throw new HttpError(500, 'Failed to update application');
  }

  if (status === 'accepted') {
    const [{ data: accepted }, { data: orderRequest }] = await Promise.all([
      supabase.from('order_applications').select('available_quantity').eq('order_request_id', application.order_request_id).eq('status', 'accepted'),
      supabase.from('order_requests').select('quantity, allow_multiple_farmers').eq('id', application.order_request_id).maybeSingle(),
    ]);

    if (orderRequest && accepted) {
      // `accepted` already includes the application updated above.
      const totalAccepted = accepted.reduce((sum, a) => sum + Number(a.available_quantity), 0);
      if (!orderRequest.allow_multiple_farmers || totalAccepted >= Number(orderRequest.quantity)) {
        const { error: closeError } = await supabase
          .from('order_requests')
          .update({ status: 'closed', updated_at: new Date().toISOString() })
          .eq('id', application.order_request_id)
          .eq('buyer_id', uid(session));
        if (closeError) console.error('Order request close error:', closeError);
      }
    }
  }

  return NextResponse.json({ success: true, application: data });
});
