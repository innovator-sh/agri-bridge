import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { route, parseJson } from '@/lib/api/handler';
import { HttpError, badRequest, forbidden, notFound } from '@/lib/api/errors';
import { requireRole, uid } from '@/lib/auth/require';
import {
  createScheduleSchema,
  firstExecutionDate,
  pagination,
  scheduleIdQuery,
  updateScheduleSchema,
  validateScheduleDay,
  type ScheduleType,
} from '@/lib/validation/orderRequests';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

export const POST = route(async (req) => {
  const session = await requireRole('buyer');
  const input = await parseJson(req, createScheduleSchema);

  const dayError = validateScheduleDay(input.schedule_type, input.schedule_day);
  if (dayError) throw badRequest(dayError);
  const day = input.schedule_type === 'daily' ? null : input.schedule_day ?? null;

  const { data, error } = await supabase
    .from('order_schedules')
    .insert({
      buyer_id: uid(session),
      product_name: input.product_name,
      quantity: input.quantity,
      allow_multiple_farmers: input.allow_multiple_farmers,
      description: input.description,
      max_price_per_unit: input.max_price_per_unit ?? null,
      schedule_type: input.schedule_type,
      schedule_day: day,
      days_before_needed: input.days_before_needed,
      is_active: true,
      next_execution_date: firstExecutionDate(input.schedule_type, day),
    })
    .select()
    .single();

  if (error) {
    console.error('Order schedule creation error:', error);
    throw new HttpError(500, 'Failed to create order schedule');
  }

  return NextResponse.json({ success: true, schedule: data });
});

export const GET = route(async (req) => {
  const session = await requireRole('buyer');
  const { limit, offset } = pagination.parse(Object.fromEntries(new URL(req.url).searchParams));

  const { data, error, count } = await supabase
    .from('order_schedules')
    .select('*', { count: 'exact' })
    .eq('buyer_id', uid(session))
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Order schedules fetch error:', error);
    throw new HttpError(500, 'Failed to fetch order schedules');
  }

  return NextResponse.json({ schedules: data ?? [], total: count ?? data?.length ?? 0, limit, offset });
});

type ScheduleRow = { buyer_id: number; schedule_type: ScheduleType; schedule_day: number | null };

async function loadOwnedSchedule(scheduleId: number, userId: number): Promise<ScheduleRow> {
  const { data, error } = await supabase
    .from('order_schedules')
    .select('buyer_id, schedule_type, schedule_day')
    .eq('id', scheduleId)
    .maybeSingle();
  if (error) {
    console.error('Order schedule lookup error:', error);
    throw new HttpError(500, 'Failed to load schedule');
  }
  if (!data) throw notFound('Schedule');
  if (Number(data.buyer_id) !== userId) throw forbidden();
  return data as unknown as ScheduleRow;
}

export const PUT = route(async (req) => {
  const session = await requireRole('buyer');
  const { schedule_id, ...input } = await parseJson(req, updateScheduleSchema);
  const existing = await loadOwnedSchedule(schedule_id, uid(session));

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) update[k] = v;

  // Changing the type or day re-derives the next run date.
  if (input.schedule_type !== undefined || input.schedule_day !== undefined) {
    const type = input.schedule_type ?? existing.schedule_type;
    const day = type === 'daily' ? null : input.schedule_day !== undefined ? input.schedule_day : existing.schedule_day;
    const dayError = validateScheduleDay(type, day);
    if (dayError) throw badRequest(dayError);
    update.schedule_type = type;
    update.schedule_day = day;
    update.next_execution_date = firstExecutionDate(type, day);
  }

  if (Object.keys(update).length === 0) throw badRequest('No fields to update');
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('order_schedules')
    .update(update)
    .eq('id', schedule_id)
    .eq('buyer_id', uid(session))
    .select()
    .single();
  if (error) {
    console.error('Order schedule update error:', error);
    throw new HttpError(500, 'Failed to update schedule');
  }

  return NextResponse.json({ success: true, schedule: data });
});

export const DELETE = route(async (req) => {
  const session = await requireRole('buyer');
  const { schedule_id } = scheduleIdQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  await loadOwnedSchedule(schedule_id, uid(session));

  const { error } = await supabase.from('order_schedules').delete().eq('id', schedule_id).eq('buyer_id', uid(session));
  if (error) {
    console.error('Order schedule delete error:', error);
    throw new HttpError(500, 'Failed to delete schedule');
  }

  return NextResponse.json({ success: true, message: 'Schedule deleted successfully' });
});
