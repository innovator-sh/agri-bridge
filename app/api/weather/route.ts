import { NextResponse } from 'next/server';
import { route } from '@/lib/api/handler';
import { requireUser, uid } from '@/lib/auth/require';
import { rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';
import { weatherQuerySchema } from '@/lib/validation/weather';

export const dynamic = 'force-dynamic';

const REAL_CACHE = 'private, max-age=600';
const DEMO_CACHE = 'private, max-age=60';

function demoWeather(location?: string) {
  return {
    location: location || 'Mumbai',
    region: 'Maharashtra',
    temperature: 28,
    description: 'Partly Cloudy',
    humidity: 65,
    windSpeed: 12,
    icon: '02d',
    sunrise: '06:30',
    sunset: '18:45',
    pressure: 1013,
    visibility: 10,
    uvIndex: 6,
    feelsLike: 32,
    isDemo: true,
  };
}

const demoResponse = (location?: string) =>
  NextResponse.json({ success: true, weather: demoWeather(location) }, { headers: { 'Cache-Control': DEMO_CACHE } });

const formatTime = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

interface OpenWeatherResponse {
  name?: string;
  main: { temp: number; humidity: number; pressure: number; feels_like: number };
  weather: { description: string; icon: string }[];
  wind: { speed: number };
  sys: { sunrise: number; sunset: number };
  visibility?: number;
}

export const GET = route(async (req) => {
  const session = await requireUser();
  rateLimit(`weather:${uid(session)}`, 60, 10 * 60_000);

  const { lat, lon, city } = weatherQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const apiKey = env().OPENWEATHER_API_KEY;
  if (!apiKey || apiKey === 'demo_key') return demoResponse(city);

  const params = new URLSearchParams({ appid: apiKey, units: 'metric' });
  if (lat !== undefined && lon !== undefined) {
    params.set('lat', String(lat));
    params.set('lon', String(lon));
  } else {
    // Default to Mumbai when no location is provided (central for Indian users).
    params.set('q', city ?? 'Mumbai,IN');
  }

  try {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?${params}`, {
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 600 },
    });

    if (!response.ok) {
      // Status only: the URL carries the API key and the body is never forwarded.
      console.error('[weather] OpenWeather status', response.status);
      return demoResponse(city);
    }

    const data = (await response.json()) as OpenWeatherResponse;

    let locationName = data.name ?? '';
    let regionName = '';

    if (lat !== undefined && lon !== undefined) {
      try {
        const geo = new URLSearchParams({
          format: 'json',
          lat: String(lat),
          lon: String(lon),
          zoom: '10',
          addressdetails: '1',
        });
        const geocode = await fetch(`https://nominatim.openstreetmap.org/reverse?${geo}`, {
          signal: AbortSignal.timeout(5_000),
          headers: { 'User-Agent': 'AgriBridge/1.0', Accept: 'application/json' },
          next: { revalidate: 86_400 },
        });
        if (geocode.ok) {
          const address = ((await geocode.json()) as { address?: Record<string, string> }).address ?? {};
          locationName = address.city || address.town || address.village || address.suburb || locationName;
          regionName = address.state || address.region || '';
        }
      } catch {
        // Reverse geocoding is best effort; fall back to the OpenWeather place name.
      }
    }

    const weather = {
      location: locationName,
      region: regionName,
      temperature: Math.round(data.main.temp),
      description: data.weather[0].description,
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed * 3.6), // m/s to km/h
      icon: data.weather[0].icon,
      sunrise: formatTime(data.sys.sunrise),
      sunset: formatTime(data.sys.sunset),
      pressure: data.main.pressure,
      visibility: Math.round((data.visibility ?? 10_000) / 1000), // km
      feelsLike: Math.round(data.main.feels_like),
      uvIndex: 6, // not available on the OpenWeather free tier
      isDemo: false,
    };

    return NextResponse.json({ success: true, weather }, { headers: { 'Cache-Control': REAL_CACHE } });
  } catch (err) {
    console.error('[weather] lookup failed:', err instanceof Error ? err.name : 'unknown error');
    return demoResponse(city);
  }
});
