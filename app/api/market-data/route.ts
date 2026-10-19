import { NextResponse } from 'next/server';
import { route } from '@/lib/api/handler';
import { HttpError } from '@/lib/api/errors';
import { requireUser, uid } from '@/lib/auth/require';
import { rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { marketQuerySchema } from '@/lib/validation/market';
import type { MarketRecord, PricePrediction, RawMarketRecord } from '@/lib/types/market-data';

export const dynamic = 'force-dynamic';

const DEFAULT_API_URL = 'https://api.data.gov.in/resource/35985678-0d79-46b4-9ed6-6f13308a1d24';

/** Convert DD/MM/YYYY to a Date. */
function parseArrivalDate(dateStr: string): Date {
  const [day, month, year] = String(dateStr).split('/').map(Number);
  if (!day || !month || !year || day > 31 || month > 12 || year < 1900) {
    throw new Error('Invalid date format');
  }
  return new Date(year, month - 1, day);
}

/** Normalize a raw government record; throws on invalid data. */
function normalizeRecord(raw: RawMarketRecord): MarketRecord {
  const minPrice = Number(raw.Min_Price);
  const maxPrice = Number(raw.Max_Price);
  const modalPrice = Number(raw.Modal_Price);

  if (
    !Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || !Number.isFinite(modalPrice) ||
    minPrice < 0 || maxPrice < 0 || modalPrice < 0
  ) {
    throw new Error('Invalid price data');
  }

  return {
    state: raw.State,
    district: raw.District,
    market: raw.Market,
    commodity: raw.Commodity,
    variety: raw.Variety,
    grade: raw.Grade,
    arrivalDate: raw.Arrival_Date,
    arrivalDateObj: parseArrivalDate(raw.Arrival_Date),
    minPrice,
    maxPrice,
    modalPrice,
  };
}

/** Keep only records from the most recent arrival date. */
function findLatestRecords(records: MarketRecord[]): MarketRecord[] {
  if (records.length === 0) return [];
  const latest = records.reduce(
    (max, r) => (r.arrivalDateObj > max ? r.arrivalDateObj : max),
    records[0].arrivalDateObj
  );
  return records.filter((r) => r.arrivalDateObj.getTime() === latest.getTime());
}

// Common commodity mappings for better matching
const COMMODITY_MAPPINGS: Record<string, string[]> = {
  tomato: ['Tomato'],
  tomatoes: ['Tomato'],
  onion: ['Onion'],
  onions: ['Onion'],
  potato: ['Potato'],
  potatoes: ['Potato'],
  rice: ['Rice'],
  wheat: ['Wheat'],
  beans: ['Beans'],
  bean: ['Beans'],
  brinjal: ['Brinjal'],
  eggplant: ['Brinjal'],
  cabbage: ['Cabbage'],
  carrot: ['Carrot'],
  cauliflower: ['Cauliflower'],
  'green chilli': ['Green Chilli'],
  chilli: ['Green Chilli'],
  pepper: ['Green Chilli'],
  ginger: ['Ginger'],
  garlic: ['Garlic'],
  coriander: ['Coriander'],
  spinach: ['Spinach'],
  okra: ['Bhindi(Ladies Finger)'],
  ladyfinger: ['Bhindi(Ladies Finger)'],
  cucumber: ['Cucumber'],
  'bitter gourd': ['Bitter gourd'],
  'bottle gourd': ['Bottle gourd'],
  pumpkin: ['Pumpkin'],
  'sweet potato': ['Sweet Potato'],
  radish: ['Raddish'],
  beetroot: ['Beetroot'],
  lemon: ['Lemon'],
  lime: ['Lemon'],
  banana: ['Banana'],
  apple: ['Apple'],
  orange: ['Orange'],
  mango: ['Mango'],
  grapes: ['Grapes'],
  papaya: ['Papaya'],
  watermelon: ['Water Melon'],
  coconut: ['Coconut'],
  groundnut: ['Groundnut'],
  peanut: ['Groundnut'],
  sesame: ['Sesame'],
  mustard: ['Mustard'],
  turmeric: ['Turmeric'],
  'red chilli': ['Red Chilli'],
  'black pepper': ['Black pepper'],
  cardamom: ['Cardamom'],
  cloves: ['Cloves'],
  cinnamon: ['Cinnamon'],
  cumin: ['Cumin'],
  fenugreek: ['Fenugreek'],
  ajwain: ['Ajwain'],
  fennel: ['Fennel'],
  dill: ['Dill'],
  mint: ['Mint'],
  'curry leaves': ['Curry Leaves'],
};

function commoditiesFor(productName: string): string[] {
  const term = productName.toLowerCase().trim();
  if (COMMODITY_MAPPINGS[term]) return COMMODITY_MAPPINGS[term];

  const fuzzy = new Set<string>();
  for (const [key, values] of Object.entries(COMMODITY_MAPPINGS)) {
    if (key.includes(term) || term.includes(key)) values.forEach((v) => fuzzy.add(v));
  }
  if (fuzzy.size > 0) return [...fuzzy].slice(0, 4);

  return [
    ...new Set([
      productName,
      productName.charAt(0).toUpperCase() + productName.slice(1).toLowerCase(),
      productName.toUpperCase(),
      productName.toLowerCase(),
    ]),
  ];
}

export const GET = route(async (req) => {
  const session = await requireUser();
  rateLimit(`market:${uid(session)}`, 120, 10 * 60_000);

  const { productName, state } = marketQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const e = env();
  const apiKey = e.MARKET_DATA_API_KEY;
  if (!apiKey) throw new HttpError(503, 'Service not configured');
  const apiUrl = e.MARKET_DATA_API_URL || DEFAULT_API_URL;

  const deadline = Date.now() + 20_000;
  let answered = false; // at least one upstream call returned a usable HTTP response

  for (const commodity of commoditiesFor(productName)) {
    if (Date.now() > deadline) break;

    const params = new URLSearchParams({
      'api-key': apiKey,
      format: 'json',
      'filters[Commodity]': commodity,
      limit: '20',
    });
    if (state) params.set('filters[State]', state);

    try {
      // Market data is public and identical for everyone, so Next's data cache is safe here.
      const response = await fetch(`${apiUrl}?${params}`, {
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: 'application/json', 'User-Agent': 'AgriBridge-PricePrediction/1.0' },
        next: { revalidate: 3600 },
      });

      if (!response.ok) {
        console.error('[market-data] upstream status', response.status);
        continue;
      }
      answered = true;

      const data = (await response.json()) as { records?: RawMarketRecord[] };
      const rawRecords = Array.isArray(data.records) ? data.records : [];

      const valid: MarketRecord[] = [];
      for (const raw of rawRecords) {
        try {
          valid.push(normalizeRecord(raw));
        } catch {
          // Skip malformed records and keep going.
        }
      }
      if (valid.length === 0) continue;

      const latest = findLatestRecords(valid);
      const prediction: PricePrediction = {
        commodity: latest[0].commodity,
        latestDate: latest[0].arrivalDate,
        records: latest,
        summary: {
          minPrice: Math.min(...latest.map((r) => r.minPrice)),
          maxPrice: Math.max(...latest.map((r) => r.maxPrice)),
          modalPrice: Math.round(latest.reduce((sum, r) => sum + r.modalPrice, 0) / latest.length),
          marketCount: latest.length,
        },
      };

      return NextResponse.json({ prediction }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
    } catch (err) {
      console.error('[market-data] request failed:', err instanceof Error ? err.name : 'unknown error');
    }
  }

  if (!answered) throw new HttpError(502, 'Market data service is unavailable');
  return NextResponse.json({ prediction: null }, { headers: { 'Cache-Control': 'private, max-age=600' } });
});
