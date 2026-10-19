import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const id = z.coerce.number().int().positive();
const price = z.coerce.number().finite().positive().max(10_000_000);
const quantity = z.coerce.number().int().positive().max(100_000_000);
const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

/** UTC calendar date as YYYY-MM-DD. */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = () => isoDate(new Date());

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && isoDate(new Date(`${s}T00:00:00Z`)) === s, 'Invalid date');
const futureDate = dateString.refine((s) => s >= todayIso(), 'Date cannot be in the past');

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

// ---- order requests ----
export const REQUEST_STATUSES = ['open', 'closed', 'cancelled'] as const;

export const createOrderRequestSchema = z.object({
  product_name: text(255).min(1),
  quantity,
  by_date: futureDate,
  allow_multiple_farmers: z.boolean().optional().default(false),
  description: z.preprocess((v) => v ?? '', text(2000)),
  max_price_per_unit: z.preprocess(emptyToNull, z.union([z.null(), price])).optional(),
});

// ---- applications ----
export const APPLICATION_STATUSES = ['pending', 'accepted', 'rejected'] as const;
/** Buyers can move a pending application to one of these; no other transitions exist. */
export const APPLICATION_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
};

export const createApplicationSchema = z.object({
  order_request_id: id,
  price_per_unit: price,
  available_quantity: quantity,
  delivery_date: z.preprocess(emptyToNull, z.union([z.null(), futureDate])).optional(),
  notes: z.preprocess((v) => v ?? '', text(2000)),
});

export const updateApplicationSchema = z.object({
  application_id: id,
  status: z.enum(['accepted', 'rejected']),
});

// ---- schedules ----
export const SCHEDULE_TYPES = ['monthly', 'weekly', 'daily'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

const scheduleDay = z.preprocess(emptyToNull, z.union([z.null(), z.coerce.number().int().min(0).max(31)]));

const scheduleFields = {
  product_name: text(255).min(1),
  quantity,
  allow_multiple_farmers: z.boolean(),
  description: z.preprocess((v) => v ?? '', text(2000)),
  max_price_per_unit: z.preprocess(emptyToNull, z.union([z.null(), price])),
  schedule_type: z.enum(SCHEDULE_TYPES),
  schedule_day: scheduleDay,
  days_before_needed: z.coerce.number().int().min(1).max(365),
};

export const createScheduleSchema = z.object({
  ...scheduleFields,
  allow_multiple_farmers: scheduleFields.allow_multiple_farmers.optional().default(false),
  max_price_per_unit: scheduleFields.max_price_per_unit.optional(),
  schedule_day: scheduleFields.schedule_day.optional(),
  days_before_needed: scheduleFields.days_before_needed.optional().default(7),
});

export const updateScheduleSchema = z.object({
  schedule_id: id,
  is_active: z.boolean().optional(),
  product_name: scheduleFields.product_name.optional(),
  quantity: scheduleFields.quantity.optional(),
  allow_multiple_farmers: scheduleFields.allow_multiple_farmers.optional(),
  description: scheduleFields.description.optional(),
  max_price_per_unit: scheduleFields.max_price_per_unit.optional(),
  schedule_type: scheduleFields.schedule_type.optional(),
  schedule_day: scheduleFields.schedule_day.optional(),
  days_before_needed: scheduleFields.days_before_needed.optional(),
});

export const scheduleIdQuery = z.object({ schedule_id: id });

/** Returns an error message if the type/day combination is invalid, else null. */
export function validateScheduleDay(type: ScheduleType, day: number | null | undefined): string | null {
  if (type === 'monthly' && (day == null || day < 1 || day > 31)) {
    return 'Invalid schedule_day for monthly schedule (must be 1-31)';
  }
  if (type === 'weekly' && (day == null || day < 0 || day > 6)) {
    return 'Invalid schedule_day for weekly schedule (must be 0-6, where 0=Sunday)';
  }
  return null;
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Date for `day` of month index `m` of year `y` (UTC), clamped to the month length. */
const monthDate = (y: number, m: number, day: number) => {
  const norm = new Date(Date.UTC(y, m, 1));
  return new Date(Date.UTC(norm.getUTCFullYear(), norm.getUTCMonth(), Math.min(day, daysInMonth(norm.getUTCFullYear(), norm.getUTCMonth()))));
};

/** First execution date strictly after `from` (UTC midnight-based). */
export function firstExecutionDate(type: ScheduleType, day: number | null | undefined, from = new Date()): string {
  const today = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (type === 'daily') return isoDate(addDays(today, 1));
  if (type === 'weekly') {
    const until = (Number(day) - today.getUTCDay() + 7) % 7;
    return isoDate(addDays(today, until || 7));
  }
  let d = monthDate(today.getUTCFullYear(), today.getUTCMonth(), Number(day));
  if (d <= today) d = monthDate(today.getUTCFullYear(), today.getUTCMonth() + 1, Number(day));
  return isoDate(d);
}

/** Advances `current` (YYYY-MM-DD) by whole periods until it is after today. */
export function advanceExecutionDate(type: ScheduleType, day: number | null | undefined, current: string, from = new Date()): string {
  const today = isoDate(from);
  let d = new Date(`${current}T00:00:00Z`);
  for (let i = 0; i < 1000; i++) {
    if (type === 'daily') d = addDays(d, 1);
    else if (type === 'weekly') d = addDays(d, 7);
    else d = monthDate(d.getUTCFullYear(), d.getUTCMonth() + 1, Number(day ?? d.getUTCDate()));
    if (isoDate(d) > today) break;
  }
  return isoDate(d);
}
