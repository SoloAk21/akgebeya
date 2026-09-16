import { AuthError, digest } from './auth-security.js';
import type { PrismaClient } from './generated/prisma/client.js';

export interface Coordinates { latitude: number; longitude: number }
export interface ReverseInput extends Coordinates { language: 'en' | 'am' }
export interface SearchInput { query: string; language: 'en' | 'am'; proximity?: Coordinates }
export interface Address {
  formattedAddress: string; city: string | null; subCity: string | null; woreda: string | null;
  neighborhood: string | null; street: string | null; landmark: string | null;
  provider: 'geoapify'; placeId: string | null;
}
export interface GeocodeResult extends Coordinates { address: Address }
export interface Geocoder {
  search(input: SearchInput, signal?: AbortSignal, accountId?: string): Promise<GeocodeResult[]>;
  reverse(input: ReverseInput, signal?: AbortSignal, accountId?: string): Promise<GeocodeResult | null>;
}
export class GeocodingError extends AuthError {
  constructor(status: number, code: string, message: string, public readonly retryAfter = 60) { super(status, code, message); }
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const invalid = () => new AuthError(400, 'INVALID_GEOCODING_INPUT', 'Enter a search of 2–120 characters or valid Ethiopian coordinates, and choose English or Amharic.');
function coordinates(value: unknown): Coordinates {
  if (!record(value) || Object.keys(value).length !== 2 || typeof value['latitude'] !== 'number'
    || typeof value['longitude'] !== 'number' || !Number.isFinite(value['latitude']) || !Number.isFinite(value['longitude'])
    || value['latitude'] < 3 || value['latitude'] > 15 || value['longitude'] < 32 || value['longitude'] > 48) throw invalid();
  return { latitude: value['latitude'], longitude: value['longitude'] };
}
export function searchInput(value: unknown): SearchInput {
  if (!record(value) || Object.keys(value).some(key => !['query', 'language', 'proximity'].includes(key))
    || typeof value['query'] !== 'string' || typeof value['language'] !== 'string' || !['en', 'am'].includes(value['language'])) throw invalid();
  const query = value['query'].trim().normalize('NFC');
  if ([...query].length < 2 || [...query].length > 120 || /[\p{Cc}\p{Cf}]/u.test(query)) throw invalid();
  return { query, language: value['language'] as 'en' | 'am',
    ...(Object.hasOwn(value, 'proximity') ? { proximity: coordinates(value['proximity']) } : {}) };
}
export function reverseInput(value: unknown): ReverseInput {
  if (!record(value) || Object.keys(value).length !== 3 || typeof value['language'] !== 'string' || !['en', 'am'].includes(value['language'])) throw invalid();
  return { ...coordinates({ latitude: value['latitude'], longitude: value['longitude'] }), language: value['language'] as 'en' | 'am' };
}
function text(value: unknown, max = 300): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return clean ? clean.slice(0, max) : null;
}
export function normalizeAddress(value: unknown): Address | null {
  if (!record(value) || typeof value['country_code'] !== 'string' || value['country_code'].toLowerCase() !== 'et') return null;
  const formattedAddress = text(value['formatted'], 600);
  if (!formattedAddress) return null;
  // Do not invent a woreda or infer hierarchy from arbitrary address text.
  return { formattedAddress, city: text(value['city']), subCity: null,
    woreda: null, neighborhood: text(value['suburb']) ?? text(value['neighbourhood']),
    street: text(value['street']), landmark: text(value['name']), provider: 'geoapify', placeId: text(value['place_id']) };
}

export function createProviderLimiter(now: () => number = Date.now) {
  let inFlight = 0;
  let starts: number[] = [];
  return () => {
    const time = now();
    starts = starts.filter(start => start > time - 1000);
    if (inFlight >= 4 || starts.length >= 5) throw new GeocodingError(429, 'GEOCODING_BUSY', 'Address lookup is busy. Please try again shortly.', 2);
    starts.push(time);
    inFlight++;
    return () => { inFlight--; };
  };
}
const providerLimiter = createProviderLimiter();
export function createGeocoder(options: { fetch?: typeof fetch; key?: () => string | undefined; now?: () => number; limiter?: () => () => void } = {}): Geocoder {
  const fetcher = options.fetch ?? fetch;
  const clock = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; rows: Record<string, unknown>[] }>();
  async function query(kind: 'autocomplete' | 'reverse', params: Record<string, string>, signal?: AbortSignal, accountId = '') {
    const key = (options.key ?? (() => process.env['GEOAPIFY_API_KEY']))()?.trim();
    if (!key) throw new GeocodingError(503, 'GEOCODING_NOT_CONFIGURED', 'Address search is not configured. You can still choose and save coordinates.');
    signal?.throwIfAborted();
    const cacheKey = digest(JSON.stringify([accountId, kind, params]));
    const now = clock();
    for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
    const cached = cache.get(cacheKey);
    if (cached) return cached.rows;
    const url = new URL(`https://api.geoapify.com/v1/geocode/${kind}`);
    for (const [name, value] of Object.entries({ ...params, format: 'json', apiKey: key })) url.searchParams.set(name, value);
    const release = (options.limiter ?? providerLimiter)();
    try {
      const timeout = AbortSignal.timeout(5000);
      const response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error', headers: { Accept: 'application/json' } });
      if (response.status === 429) {
        const raw = response.headers.get('retry-after');
        const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 60;
        await response.body?.cancel().catch(() => {});
        throw new GeocodingError(429, 'GEOCODING_RATE_LIMITED', 'Address provider is busy. Wait before trying again.', Number.isFinite(seconds) ? Math.max(1, Math.min(3600, seconds)) : 60);
      }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('Provider rejected lookup'); }
      if (!response.body) throw new Error('Missing provider response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 1048576) { await reader.cancel(); throw new Error('Provider response too large'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!record(data) || !Array.isArray(data['results'])) throw new Error('Invalid provider response');
      const rows = data['results'].filter(record).slice(0, 6);
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { expires: now + 300000, rows });
      return rows;
    } catch (error) {
      if (error instanceof GeocodingError) throw error;
      throw new GeocodingError(502, 'GEOCODING_UNAVAILABLE', 'Address lookup is temporarily unavailable. You can still choose and save coordinates.');
    } finally { release(); }
  }
  return {
    async search(input, signal, accountId) {
      const p = input.proximity ?? { latitude: 9.01, longitude: 38.76 };
      const rows = await query('autocomplete', { text: input.query, lang: input.language, filter: 'countrycode:et', bias: `proximity:${p.longitude},${p.latitude}`, limit: '6' }, signal, accountId);
      return rows.flatMap(row => {
        const address = normalizeAddress(row);
        if (!address || typeof row['lat'] !== 'number' || typeof row['lon'] !== 'number') return [];
        try { return [{ ...coordinates({ latitude: row['lat'], longitude: row['lon'] }), address }]; } catch { return []; }
      });
    },
    async reverse(input, signal, accountId) {
      const rows = await query('reverse', { lat: String(input.latitude), lon: String(input.longitude), lang: input.language, countrycodes: 'et', limit: '1' }, signal, accountId);
      const address = normalizeAddress(rows[0]);
      // Keep the user's exact point; a provider feature's centroid is not their pin.
      return address ? { latitude: input.latitude, longitude: input.longitude, address } : null;
    },
  };
}
export const geocoder = createGeocoder();

export async function limitGeocoding(database: PrismaClient, accountId: string): Promise<void> {
  const window = Math.floor(Date.now() / 60000);
  const key = digest(`geocoding:${accountId}:${window}`);
  const expiresAt = new Date((window + 1) * 60000);
  const count = await database.$transaction(async tx => {
    await tx.authAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    return tx.authAttempt.upsert({ where: { key }, create: { key, count: 1, expiresAt }, update: { count: { increment: 1 } } });
  });
  if (count.count > 30) throw new GeocodingError(429, 'GEOCODING_RATE_LIMITED', 'Too many address lookups. Please wait a minute.', Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)));
  // Conservative shared daily budget includes cache hits; leaves room below the free-tier limit.
  const day = Math.floor(Date.now() / 86400000);
  const dailyKey = digest(`geocoding:global:day:${day}`);
  const daily = await database.authAttempt.upsert({ where: { key: dailyKey },
    create: { key: dailyKey, count: 1, expiresAt: new Date((day + 1) * 86400000) }, update: { count: { increment: 1 } } });
  if (daily.count > 2800) throw new GeocodingError(429, 'GEOCODING_DAILY_LIMIT', 'Address lookups have reached today’s limit. You can still save coordinates.', 3600);
}
