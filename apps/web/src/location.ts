import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface Location { countryId: string; regionId: string; cityId: string; subcityId: string; latitude: number; longitude: number; confirmed: true; updatedAt: string }
interface Options { country: { id: string; name: string }; region: { id: string; name: string }; city: { id: string; name: string }; subcities: { id: string; name: string }[]; bounds: { south: number; north: number; west: number; east: number } }
export function locationPanel(callbacks: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const form = get<HTMLFormElement>('location-form');
  const country = get<HTMLSelectElement>('location-country');
  const region = get<HTMLSelectElement>('location-region');
  const city = get<HTMLSelectElement>('location-city');
  const subcity = get<HTMLSelectElement>('location-subcity');
  const latitude = get<HTMLInputElement>('location-latitude');
  const longitude = get<HTMLInputElement>('location-longitude');
  const confirmed = get<HTMLInputElement>('location-confirmed');
  const save = get<HTMLButtonElement>('location-save');
  const reload = get<HTMLButtonElement>('location-reload');
  const feedback = get('location-feedback');
  const mapStatus = get('location-map-status');
  let options: Options | undefined;
  let map: L.Map | undefined;
  let marker: L.CircleMarker | undefined;
  let ready = false;
  let blocked = true;
  function setBusy(value: boolean) {
    blocked = value;
    for (const control of [country, region, city, subcity, latitude, longitude, confirmed, save]) control.disabled = value || !ready;
    reload.disabled = value;
    form.setAttribute('aria-busy', String(value));
  }
  function reset() {
    ready = false;
    options = undefined;
    form.reset();
    for (const select of [country, region, city, subcity]) select.replaceChildren();
    feedback.textContent = '';
    mapStatus.textContent = '';
    map?.remove(); map = undefined; marker = undefined;
    setBusy(true);
  }
  async function request(path: string, data?: unknown) {
    const response = await fetch(path, { method: data ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (response.status === 401) await callbacks.expired();
    if (!response.ok) throw new Error(result.message ?? 'Location could not be loaded.');
    return result;
  }
  function point() {
    const lat = latitude.valueAsNumber, lon = longitude.valueAsNumber;
    const b = options?.bounds;
    return b && Number.isFinite(lat) && Number.isFinite(lon) && lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east ? L.latLng(lat, lon) : undefined;
  }
  function draw(center = false) {
    const p = point();
    if (!map || !p) { marker?.remove(); marker = undefined; return; }
    if (marker) marker.setLatLng(p);
    else marker = L.circleMarker(p, { radius: 9, color: '#123d35', fillColor: '#bd762b', fillOpacity: 1, weight: 3 }).addTo(map);
    if (center) map.setView(p, 14);
  }
  function createMap() {
    if (map) { map.invalidateSize(); return; }
    mapStatus.textContent = '';
    map = L.map('location-map', { scrollWheelZoom: false }).setView([9.01, 38.76], 12);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }).addTo(map);
    tiles.on('tileerror', () => { mapStatus.textContent = 'Map tiles could not load. Enter coordinates below; retry the map when your connection returns.'; });
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (blocked || !ready) return;
      latitude.value = event.latlng.lat.toFixed(6); longitude.value = event.latlng.lng.toFixed(6);
      confirmed.checked = false; draw();
      feedback.textContent = point() ? 'Pin moved. Confirm the location before saving.' : 'Choose a point inside the supported Addis Ababa service area.';
    });
  }
  function fill(select: HTMLSelectElement, entries: { id: string; name: string }[], placeholder?: string) {
    select.replaceChildren();
    if (placeholder) select.add(new Option(placeholder, ''));
    for (const entry of entries) select.add(new Option(entry.name, entry.id));
  }
  function render(location: Location | null) {
    if (!options) return;
    fill(country, [options.country]); fill(region, [options.region]); fill(city, [options.city]);
    fill(subcity, options.subcities, 'Choose a subcity');
    const b = options.bounds;
    latitude.min = String(b.south); latitude.max = String(b.north);
    longitude.min = String(b.west); longitude.max = String(b.east);
    subcity.value = location?.subcityId ?? '';
    latitude.value = location ? String(location.latitude) : '';
    longitude.value = location ? String(location.longitude) : '';
    confirmed.checked = Boolean(location);
    ready = true; createMap(); draw(true);
    feedback.textContent = location ? `Saved location: ${options.subcities.find(s => s.id === location.subcityId)?.name}. ${location.latitude}, ${location.longitude}.` : 'Choose your subcity, then click the map or enter coordinates.';
  }
  async function load() {
    ready = false;
    feedback.textContent = 'Loading your location…';
    try {
      const catalog = await request('/api/location-options') as Options;
      const result = await request('/api/location') as { location: Location | null };
      if (!catalog.country?.id || !catalog.region?.id || !catalog.city?.id || !Array.isArray(catalog.subcities) || !catalog.bounds
        || !Object.hasOwn(result, 'location') || (result.location !== null && (!Number.isFinite(result.location.latitude)
          || !Number.isFinite(result.location.longitude) || result.location.confirmed !== true
          || !catalog.subcities.some(s => s.id === result.location?.subcityId)))) throw new Error('Location response was incomplete. Please reload.');
      options = catalog; render(result.location);
    } catch (error) { feedback.textContent = error instanceof Error ? error.message : 'Location could not be loaded. Please reload.'; }
  }
  for (const control of [country, region, city, subcity, latitude, longitude]) control.addEventListener('input', () => {
    confirmed.checked = false;
    draw(control === latitude || control === longitude);
    feedback.textContent = 'Changes are not saved. Confirm the pin before saving.';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (blocked || !ready || !form.reportValidity() || !point()) return;
    void (async () => {
      callbacks.busy(true); feedback.textContent = 'Saving your location…';
      try {
        const result = await request('/api/location', { countryId: country.value, regionId: region.value, cityId: city.value, subcityId: subcity.value,
          latitude: latitude.valueAsNumber, longitude: longitude.valueAsNumber, confirmed: confirmed.checked }) as { location: Location };
        render(result.location);
      } catch (error) {
        ready = false;
        feedback.textContent = `${error instanceof Error ? error.message : 'Save could not be confirmed.'} Reload your location before trying again.`;
      } finally { callbacks.busy(false); }
    })();
  });
  reload.addEventListener('click', () => { void (async () => {
    callbacks.busy(true);
    try { map?.remove(); map = undefined; marker = undefined; await load(); }
    finally { callbacks.busy(false); }
  })(); });
  return { reset, load, setBusy };
}
