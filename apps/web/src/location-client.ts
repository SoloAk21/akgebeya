export interface Address {
  formattedAddress: string; city: string | null; subCity: string | null; woreda: string | null;
  neighborhood: string | null; street: string | null; landmark: string | null;
  provider: 'geoapify'; placeId: string | null;
}
export interface Place { latitude: number; longitude: number; address: Address }
export function validPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false;
  const p = value as Place;
  return Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180
    && Boolean(p.address && typeof p.address.formattedAddress === 'string' && p.address.formattedAddress.length <= 1000
      && p.address.provider === 'geoapify');
}
export function currentPosition(geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined,
  options: { signal?: AbortSignal; onFallback?: () => void } = {}): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!geolocation) { reject(new Error('Device location is unavailable in this browser. Search or choose a map point.')); return; }
    let settled = false;
    const finish = (error?: Error, position?: { latitude: number; longitude: number; accuracy: number }) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error); else if (position) resolve(position);
    };
    const abort = () => finish(new Error('Device location lookup canceled.'));
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    const attempt = (highAccuracy: boolean) => {
      if (settled) return;
      try {
        geolocation.getCurrentPosition(position => {
          if (settled) return;
          const { latitude, longitude, accuracy } = position.coords;
          if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180
            || !Number.isFinite(accuracy) || accuracy < 0) { finish(new Error('Your device returned an invalid location. Please try again.')); return; }
          finish(undefined, { latitude, longitude, accuracy });
        }, error => {
          if (settled) return;
          if (highAccuracy && (error.code === 2 || error.code === 3)) {
            options.onFallback?.(); attempt(false); return;
          }
          finish(new Error(error.code === 1
            ? 'Location permission was denied. Your pin has not changed. Allow location in browser settings or search manually.'
            : error.code === 3 ? 'Finding your location timed out after both attempts. Your pin is unchanged. Check device Location Services and this site’s location permission, or search manually.'
              : 'Your device location is unavailable. Your pin is unchanged. Check device Location Services or search manually.'));
        }, { enableHighAccuracy: highAccuracy, maximumAge: 0, timeout: highAccuracy ? 12000 : 15000 });
      } catch { finish(new Error('Device location is unavailable. Check browser permissions or search manually.')); }
    };
    attempt(true);
  });
}
