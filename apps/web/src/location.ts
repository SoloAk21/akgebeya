import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { currentPosition, validPlace, type Address, type Place } from './location-client.js';

interface Location { countryId: string; regionId: string; cityId: string; subcityId: string; latitude: number; longitude: number; confirmed: true; updatedAt: string; address: Address | null }
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
  const search = get<HTMLInputElement>('location-search');
  const language = get<HTMLSelectElement>('location-language');
  const suggestions = get('location-suggestions');
  const searchStatus = get('location-search-status');
  const device = get<HTMLButtonElement>('location-device');
  const deviceStatus = get('location-device-status');
  const addressText = get('location-address');
  const reverseRetry = get<HTMLButtonElement>('location-address-retry');
  const recentList = get('location-recent');
  const clearRecent = get<HTMLButtonElement>('location-clear-recent');
  let options: Options | undefined;
  let map: L.Map | undefined;
  let marker: L.Marker | undefined;
  let ready = false, blocked = true, resolving = false, detecting = false, composing = false;
  let quotaUntil = 0;
  let results: Place[] = [], recent: Place[] = [];
  let active = -1, searchVersion = 0, pointVersion = 0, deviceVersion = 0;
  let searchAbort: AbortController | undefined, pointAbort: AbortController | undefined;
  let deviceAbort: AbortController | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined, pointTimer: ReturnType<typeof setTimeout> | undefined;
  function setBusy(value: boolean) {
    blocked = value;
    for (const control of [country, region, city, subcity, latitude, longitude, search, language]) control.disabled = value || !ready;
    confirmed.disabled = value || !ready || resolving;
    save.disabled = value || !ready || resolving || detecting;
    device.disabled = value || !ready || detecting;
    reverseRetry.disabled = value || !ready || resolving;
    reload.disabled = value;
    if (value || !ready) marker?.dragging?.disable(); else marker?.dragging?.enable();
    form.setAttribute('aria-busy', String(value || resolving));
  }
  function closeSuggestions() {
    results = []; active = -1; suggestions.replaceChildren(); suggestions.hidden = true;
    search.setAttribute('aria-expanded', 'false'); search.removeAttribute('aria-activedescendant');
  }
  function cancelSearch() { searchVersion++; searchAbort?.abort(); clearTimeout(searchTimer); search.removeAttribute('aria-busy'); searchStatus.textContent = ''; closeSuggestions(); }
  function cancelPoint() { pointVersion++; deviceVersion++; deviceAbort?.abort(); detecting = false; pointAbort?.abort(); clearTimeout(pointTimer); resolving = false; }
  function reset() {
    cancelSearch(); cancelPoint(); ready = false; options = undefined; recent = [];
    form.reset();
    for (const select of [country, region, city, subcity]) select.replaceChildren();
    for (const node of [feedback, mapStatus, addressText, deviceStatus, searchStatus, recentList]) node.textContent = '';
    search.value = ''; clearRecent.hidden = true; reverseRetry.hidden = true;
    map?.remove(); map = undefined; marker = undefined; setBusy(true);
  }
  async function request(path: string, data?: unknown, signal?: AbortSignal, method = 'POST') {
    if (['/api/location-search', '/api/location-reverse'].includes(path) && Date.now() < quotaUntil) {
      throw new Error(`Address lookups are paused. Try again in ${Math.ceil((quotaUntil - Date.now()) / 1000)} seconds.`);
    }
    const response = await fetch(path, { method: data ? method : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(20000) });
    const result = await response.json();
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'));
      quotaUntil = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60) * 1000;
    }
    if (response.status === 401) await callbacks.expired();
    if (!response.ok) throw new Error(response.status === 429 ? `Location service is busy. Try again in ${Math.ceil((quotaUntil - Date.now()) / 1000)} seconds.` : result.message ?? 'Location service is unavailable.');
    return result;
  }
  function point() {
    const lat = latitude.valueAsNumber, lon = longitude.valueAsNumber;
    return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180 ? { latitude: lat, longitude: lon } : undefined;
  }
  function supported() { const p = point(), b = options?.bounds; return p && b && p.latitude >= b.south && p.latitude <= b.north && p.longitude >= b.west && p.longitude <= b.east; }
  function draw(center = false) {
    const p = point();
    if (!map || !p) { marker?.remove(); marker = undefined; return; }
    const ll = L.latLng(p.latitude, p.longitude);
    if (marker) marker.setLatLng(ll);
    else {
      marker = L.marker(ll, { draggable: !blocked, autoPan: true, title: 'Drag to adjust exact location',
        icon: L.divIcon({ className: 'location-pin', html: '<span></span>', iconSize: [30, 38], iconAnchor: [15, 38] }) }).addTo(map);
      marker.on('dragstart', () => { cancelPoint(); confirmed.checked = false; addressText.textContent = 'Moving pin…'; resolving = true; setBusy(blocked); });
      marker.on('dragend', () => { if (marker) { const p = marker.getLatLng(); choosePoint(p.lat, p.lng, false); } });
    }
    if (center) map.setView(ll, 16);
  }
  function createMap() {
    if (map) { map.invalidateSize(); return; }
    mapStatus.textContent = '';
    map = L.map('location-map', { scrollWheelZoom: false }).setView([9.01, 38.76], 12);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }).addTo(map);
    tiles.on('tileerror', () => { mapStatus.textContent = 'Map images could not load. Search or enter coordinates below; reload the map to retry.'; });
    map.on('click', (event: L.LeafletMouseEvent) => { if (!blocked && ready) choosePoint(event.latlng.lat, event.latlng.lng, false); });
  }
  function showAddress(value: Address | null) {

    addressText.textContent = value ? value.formattedAddress : 'No address found for this pin. You can still confirm the exact coordinates.';
  }
  async function reverse(version: number) {
    const p = point(); if (!p) return;
    const abort = new AbortController(); pointAbort = abort;
    try {
      const data = await request('/api/location-reverse', { ...p, language: language.value }, abort.signal);
      if (version !== pointVersion) return;
      if (data.result !== null && (!validPlace(data.result) || Math.abs(data.result.latitude - p.latitude) > 1e-6 || Math.abs(data.result.longitude - p.longitude) > 1e-6)) throw new Error('Address response did not match this pin.');
      showAddress(data.result?.address ?? null);
    } catch (error) {
      if (version !== pointVersion || abort.signal.aborted) return;
      addressText.textContent = `${error instanceof Error ? error.message : 'Address lookup failed.'} The coordinates are unchanged; you can retry or save the pin without an address.`;
      reverseRetry.hidden = false;
    } finally { if (version === pointVersion) { resolving = false; setBusy(blocked); } }
  }
  function refreshPoint(center = false) {
    cancelPoint(); cancelSearch(); confirmed.checked = false; reverseRetry.hidden = true;
    deviceStatus.textContent = ''; draw(center);
    const p = point();
    feedback.textContent = supported() ? 'Adjust the pin if needed, then confirm your exact location.' : 'This point is outside our current Addis Ababa service area. You can explore it, but saving is not available there yet.';
    if (!p) { addressText.textContent = 'Enter valid coordinates or choose a point on the map.'; setBusy(blocked); return; }
    addressText.textContent = 'Finding the address for this pin…'; resolving = true; setBusy(blocked);
    const version = pointVersion; pointTimer = setTimeout(() => { void reverse(version); }, 350);
  }
  function choosePoint(lat: number, lon: number, center: boolean) {
    latitude.value = String(Math.round(lat * 1e6) / 1e6); longitude.value = String(Math.round(lon * 1e6) / 1e6);
    refreshPoint(center);
  }
  function renderRecent() {
    recentList.replaceChildren(); clearRecent.hidden = recent.length === 0;
    for (const p of recent) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'recent-location'; button.textContent = p.address.formattedAddress;
      button.addEventListener('click', () => { if (!blocked && ready) selectPlace(p); }); recentList.append(button);
    }
  }
  function selectPlace(p: Place) {
    search.value = p.address.formattedAddress;
    recent = [p, ...recent.filter(r => r.latitude !== p.latitude || r.longitude !== p.longitude)].slice(0, 5); renderRecent();
    choosePoint(p.latitude, p.longitude, true);
    searchStatus.textContent = 'Place selected. Check the pin and its nearest address before confirming.';
  }
  function highlight(index: number) {
    active = index;
    Array.from(suggestions.children).forEach((node, i) => node.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) search.setAttribute('aria-activedescendant', `location-result-${active}`); else search.removeAttribute('aria-activedescendant');
  }
  async function autocomplete(version: number) {
    const abort = new AbortController(); searchAbort = abort;
    searchStatus.textContent = 'Searching Ethiopian locations…'; search.setAttribute('aria-busy', 'true');
    try {
      const p = point();
      const data = await request('/api/location-search', { query: search.value.trim(), language: language.value, ...(p && p.latitude >= 3 && p.latitude <= 15 && p.longitude >= 32 && p.longitude <= 48 ? { proximity: p } : {}) }, abort.signal);
      if (version !== searchVersion) return;
      if (!Array.isArray(data.results) || !data.results.every(validPlace)) throw new Error('Search returned an invalid response. Please try again.');
      results = data.results; suggestions.replaceChildren(); active = -1;
      results.forEach((p, i) => {
        const option = document.createElement('button'); option.type = 'button'; option.id = `location-result-${i}`; option.role = 'option'; option.tabIndex = -1; option.setAttribute('aria-selected', 'false'); option.textContent = p.address.formattedAddress;
        option.addEventListener('click', () => { if (!blocked && ready) selectPlace(p); }); suggestions.append(option);
      });
      suggestions.hidden = results.length === 0; search.setAttribute('aria-expanded', String(results.length > 0));
      searchStatus.textContent = results.length ? `${results.length} suggestions. Use arrow keys and Enter to choose. Results favor the selected map point.` : 'No matching locations. Try another spelling, a nearby landmark, or choose a map point.';
    } catch (error) { if (version === searchVersion && !abort.signal.aborted) searchStatus.textContent = error instanceof Error ? error.message : 'Search failed. Please try again.'; }
    finally { if (version === searchVersion) search.removeAttribute('aria-busy'); }
  }
  function searchChanged() {
    if (detecting) { deviceVersion++; deviceAbort?.abort(); detecting = false; deviceStatus.textContent = 'Device lookup canceled. Continue with manual search.'; setBusy(blocked); }
    cancelSearch(); search.removeAttribute('aria-busy');
    if (composing || search.value.trim().length < 2) { searchStatus.textContent = 'Type at least two characters. English and Amharic are supported where map data is available.'; return; }
    const version = searchVersion;
    searchTimer = setTimeout(() => { void autocomplete(version); }, 350);
  }
  search.addEventListener('input', searchChanged);
  search.addEventListener('compositionstart', () => { composing = true; cancelSearch(); });
  search.addEventListener('compositionend', () => { composing = false; searchChanged(); });
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { cancelSearch(); return; }
    if (event.key === 'Enter') { event.preventDefault(); const selected = results[active]; if (selected) selectPlace(selected); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && results.length) {
      event.preventDefault(); highlight(active < 0 ? (event.key === 'ArrowDown' ? 0 : results.length - 1)
        : (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    }
  });
  language.addEventListener('change', () => { if (point()) refreshPoint(); searchChanged(); });
  clearRecent.addEventListener('click', () => { recent = []; renderRecent(); });
  device.addEventListener('click', () => {
    cancelPoint(); cancelSearch(); const version = ++deviceVersion; detecting = true; setBusy(blocked); deviceStatus.textContent = 'Finding your current location… Your browser may ask for permission.';
    deviceAbort = new AbortController();
    void currentPosition(navigator.geolocation, { signal: deviceAbort.signal, onFallback: () => {
      if (version === deviceVersion) deviceStatus.textContent = 'A precise location was not available. Trying standard accuracy…';
    } }).then(p => {
      if (version !== deviceVersion) return;
      choosePoint(p.latitude, p.longitude, true);
      deviceStatus.textContent = `Device accuracy: approximately ${Math.round(p.accuracy)} metres. Check and adjust the pin before confirming.`;
    }).catch(error => {
      if (version !== deviceVersion) return;
      deviceStatus.textContent = error instanceof Error ? error.message : 'Unable to find your location.';
      if (point()) { addressText.textContent = 'Your previous pin is unchanged. Retry its address lookup if needed.'; reverseRetry.hidden = false; }
    })
      .finally(() => { if (version === deviceVersion) { detecting = false; setBusy(blocked); } });
  });
  function fill(select: HTMLSelectElement, entries: { id: string; name: string }[], placeholder?: string) {
    select.replaceChildren(); if (placeholder) select.add(new Option(placeholder, ''));
    for (const entry of entries) select.add(new Option(entry.name, entry.id));
  }
  function render(location: Location | null) {
    if (!options) return;
    cancelPoint(); cancelSearch();
    fill(country, [options.country]); fill(region, [options.region]); fill(city, [options.city]); fill(subcity, options.subcities, 'Choose a subcity');
    const b = options.bounds; latitude.min = String(b.south); latitude.max = String(b.north); longitude.min = String(b.west); longitude.max = String(b.east);
    subcity.value = location?.subcityId ?? ''; latitude.value = location ? String(location.latitude) : ''; longitude.value = location ? String(location.longitude) : '';
    confirmed.checked = Boolean(location); ready = true; createMap(); draw(true); showAddress(location?.address ?? null); reverseRetry.hidden = !location || Boolean(location.address);
    feedback.textContent = location ? `Saved location: ${options.subcities.find(s => s.id === location.subcityId)?.name}. ${location.latitude}, ${location.longitude}.` : 'Search for a place, use your device location, or choose a point on the map.';
    if (!location) addressText.textContent = 'No location selected yet.';
  }
  async function load() {
    ready = false; cancelPoint(); cancelSearch(); feedback.textContent = 'Loading your location…';
    try {
      const catalog = await request('/api/location-options') as Options;
      const result = await request('/api/location') as { location: Location | null };
      if (!catalog.country?.id || !catalog.region?.id || !catalog.city?.id || !Array.isArray(catalog.subcities) || !catalog.bounds
        || !Object.hasOwn(result, 'location') || (result.location !== null && (!Number.isFinite(result.location.latitude) || !Number.isFinite(result.location.longitude)
          || result.location.confirmed !== true || !catalog.subcities.some(s => s.id === result.location?.subcityId)))) throw new Error('Location response was incomplete. Please reload.');
      options = catalog; render(result.location);
    } catch (error) { feedback.textContent = error instanceof Error ? error.message : 'Location could not be loaded. Please reload.'; }
  }
  for (const control of [country, region, city, subcity]) control.addEventListener('input', () => { confirmed.checked = false; feedback.textContent = 'Selection changed. Confirm the pin again before saving.'; });
  for (const control of [latitude, longitude]) control.addEventListener('input', () => refreshPoint(true));
  reverseRetry.addEventListener('click', () => refreshPoint());
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (blocked || !ready || resolving || detecting || !form.reportValidity() || !supported()) return;
    void (async () => {
      cancelSearch(); callbacks.busy(true); feedback.textContent = 'Saving your location…';
      try {
        const result = await request('/api/location', { countryId: country.value, regionId: region.value, cityId: city.value, subcityId: subcity.value,
          latitude: latitude.valueAsNumber, longitude: longitude.valueAsNumber, confirmed: confirmed.checked, addressLanguage: language.value }, undefined, 'PUT') as { location: Location };
        render(result.location);
        if (!result.location.address) feedback.textContent += ' Saved without an address; the exact pin is preserved.';
      } catch (error) { ready = false; feedback.textContent = `${error instanceof Error ? error.message : 'Save could not be confirmed.'} Reload your location before trying again.`; }
      finally { callbacks.busy(false); }
    })();
  });
  reload.addEventListener('click', () => { void (async () => {
    callbacks.busy(true); try { map?.remove(); map = undefined; marker = undefined; await load(); } finally { callbacks.busy(false); }
  })(); });
  return { reset, load, setBusy };
}
