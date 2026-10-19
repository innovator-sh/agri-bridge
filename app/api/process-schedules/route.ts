import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import supabaseClient from '@/lib/supabase';
import { env } from '@/lib/env';
import { route } from '@/lib/api/handler';
import { HttpError, unauthorized } from '@/lib/api/errors';
import { advanceExecutionDate, isoDate, todayIso, type ScheduleType } from '@/lib/validation/orderRequests';

// Untyped view of the service-role client (no generated DB types in this project).
const supabase = supabaseClient as unknown as SupabaseClient<any, 'public', any>;

const BATCH_LIMIT = 500;
const CONCURRENCY = 5;

type Schedule = {
  id: number;
  buyer_id: number;
  product_name: string;
  quantity: number;
  allow_multiple_farmers: boolean;
  description: string | null;
  max_price_per_unit: number | null;
  schedule_type: ScheduleType;
  schedule_day: number | null;
  days_before_needed: number;
  next_execution_date: string;
};

type Result = { schedule_id: number; success: boolean; error?: string; skipped?: boolean; order_request_id?: number; next_execution_date?: string };

/** Requires `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends it automatically). */
function assertCron(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) throw new HttpError(503, 'Cron is not configured');
  const header = req.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Hash both sides so the comparison is constant-length and constant-time.
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(secret).digest();
  if (!timingSafeEqual(a, b)) throw unauthorized();
}

async function fetchDue(today: string): Promise<Schedule[]> {
  const { data, error } = await supabase
    .from('order_schedules')
    .select('*')
    .eq('is_active', true)
    .lte('next_execution_date', today)
    .order('next_execution_date', { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) {
    console.error('Error fetching schedules:', error);
    throw new HttpError(500, 'Failed to fetch schedules');
  }
  return (data ?? []) as unknown as Schedule[];
}

async function processOne(schedule: Schedule, today: string): Promise<Result> {
  const nextDate = advanceExecutionDate(schedule.schedule_type, schedule.schedule_day, schedule.next_execution_date);
  try {
    // Claim the run first: only one concurrent invocation can move the date forward for this schedule.
    const { data: claimed, error: claimError } = await supabase
      .from('order_schedules')
      .update({ next_execution_date: nextDate, updated_at: new Date().toISOString() })
      .eq('id', schedule.id)
      .eq('is_active', true)
      .eq('next_execution_date', schedule.next_execution_date)
      .select('id');
    if (claimError) {
      console.error(`Error claiming schedule ${schedule.id}:`, claimError);
      return { schedule_id: schedule.id, success: false, error: 'Failed to update schedule' };
    }
    if (!claimed || claimed.length === 0) {
      return { schedule_id: schedule.id, success: false, skipped: true, error: 'Already processed' };
    }

    const delivery = new Date(`${today}T00:00:00Z`);
    delivery.setUTCDate(delivery.getUTCDate() + Number(schedule.days_before_needed));

    const { data: orderRequest, error: orderError } = await supabase
      .from('order_requests')
      .insert({
        buyer_id: schedule.buyer_id,
        product_name: schedule.product_name,
        quantity: schedule.quantity,
        by_date: isoDate(delivery),
        allow_multiple_farmers: schedule.allow_multiple_farmers,
        description: (schedule.description ?? '') + (schedule.description ? ' - ' : '') + 'Auto-Generated Order',
        max_price_per_unit: schedule.max_price_per_unit,
        status: 'open',
        is_scheduled: true,
        schedule_id: schedule.id,
      })
      .select('id')
      .single();

    if (orderError || !orderRequest) {
      console.error(`Error creating order request for schedule ${schedule.id}:`, orderError);
      // Hand the run back so the next invocation retries it.
      await supabase.from('order_schedules').update({ next_execution_date: schedule.next_execution_date }).eq('id', schedule.id);
      return { schedule_id: schedule.id, success: false, error: 'Failed to create order request' };
    }

    return { schedule_id: schedule.id, success: true, order_request_id: Number(orderRequest.id), next_execution_date: nextDate };
  } catch (err) {
    console.error(`Error processing schedule ${schedule.id}:`, err);
    return { schedule_id: schedule.id, success: false, error: 'Unexpected error' };
  }
}

export const POST = route(async (req) => {
  assertCron(req);
  const today = todayIso();
  const schedules = await fetchDue(today);

  if (schedules.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No schedules due for processing',
      processed: 0,
      info: 'Next scheduled execution dates are in the future',
    });
  }

  const results: Result[] = [];
  for (let i = 0; i < schedules.length; i += CONCURRENCY) {
    const chunk = schedules.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(chunk.map((s) => processOne(s, today)))));
  }

  const processed = results.filter((r) => r.success).length;
  return NextResponse.json({
    success: true,
    message: `Processed ${processed} schedules`,
    processed,
    total: schedules.length,
    results,
  });
});

/** Lists schedules that are due, without processing them. */
export const GET = route(async (req) => {
  assertCron(req);
  const schedules = await fetchDue(todayIso());
  return NextResponse.json({ success: true, schedules_due: schedules.length, schedules });
});
