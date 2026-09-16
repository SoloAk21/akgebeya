type Listing = {
  id: string; title: string; transactionType: 'RENT' | 'SALE';
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL'; status: 'DRAFT';
  createdAt: string; updatedAt: string;
  location: { countryId: string; regionId: string; cityId: string; subcityId: string;
    latitude: number; longitude: number; address: { formattedAddress: string } | null };
};
const transactions: Record<string, string> = { RENT: 'For rent', SALE: 'For sale' };
const properties: Record<string, string> = { APARTMENT: 'Apartment', HOUSE: 'House', LAND: 'Land', COMMERCIAL: 'Commercial' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validListing(value: unknown): value is Listing {
  if (!value || typeof value !== 'object') return false;
  const item = value as Listing;
  return typeof item.id === 'string' && uuid.test(item.id) && typeof item.title === 'string'
    && Object.hasOwn(transactions, item.transactionType) && Object.hasOwn(properties, item.propertyType) && item.status === 'DRAFT'
    && Number.isFinite(Date.parse(item.createdAt)) && Number.isFinite(Date.parse(item.updatedAt))
    && Boolean(item.location) && Number.isFinite(item.location.latitude) && Number.isFinite(item.location.longitude)
    && typeof item.location.subcityId === 'string'
    && (item.location.address === null || typeof item.location.address?.formattedAddress === 'string');
}

export function listingsPanel(callbacks: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  function node<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing listing control: ${id}`);
    return found as T;
  }
  const form = node<HTMLFormElement>('listing-form');
  const title = node<HTMLInputElement>('listing-title');
  const transaction = node<HTMLSelectElement>('listing-transaction');
  const property = node<HTMLSelectElement>('listing-property');
  const create = node<HTMLButtonElement>('listing-create');
  const reload = node<HTMLButtonElement>('listing-reload');
  const feedback = node('listing-feedback');
  const eligibility = node('listing-eligibility');
  const list = node<HTMLUListElement>('listing-list');
  const detail = node('listing-detail');
  let ready = false, blocked = true, eligible = false, version = 0;
  let controller = new AbortController();
  let retry: { payload: string; requestId: string } | undefined;
  let listings: Listing[] = [];
  function setBusy(value: boolean) {
    blocked = value;
    for (const field of [title, transaction, property, create]) field.disabled = value || !ready || !eligible;
    reload.disabled = value;
    for (const button of list.querySelectorAll('button')) button.disabled = value;
    form.setAttribute('aria-busy', String(value));
  }
  function reset() {
    version++; controller.abort(); controller = new AbortController();
    ready = false; eligible = false; retry = undefined; listings = [];
    form.reset(); title.setCustomValidity('');
    list.replaceChildren(); detail.replaceChildren(); detail.hidden = true;
    feedback.textContent = ''; eligibility.textContent = ''; setBusy(true);
  }
  async function request(path: string, data?: unknown) {
    const current = version;
    const response = await fetch(path, { method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
    const result = await response.json();
    if (current !== version) throw new DOMException('Cancelled', 'AbortError');
    if (response.status === 401) { await callbacks.expired(); throw new DOMException('Session ended', 'AbortError'); }
    if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : 'Unable to load your drafts.');
    return result;
  }
  function showDetail(item: Listing) {
    detail.replaceChildren(); detail.hidden = false;
    const heading = document.createElement('h4'); heading.textContent = item.title;
    const description = document.createElement('p');
    description.textContent = `${transactions[item.transactionType]} · ${properties[item.propertyType]} · Private draft`;
    const fields = document.createElement('dl');
    const location = item.location;
    for (const [label, value] of [
      ['Saved address', location.address?.formattedAddress ?? 'No address available; exact coordinates are saved.'],
      ['Subcity', location.subcityId], ['Latitude', String(location.latitude)], ['Longitude', String(location.longitude)],
      ['Created', new Date(item.createdAt).toLocaleString()], ['Last updated', new Date(item.updatedAt).toLocaleString()],
    ]) {
      const row = document.createElement('div'), term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = label!; description.textContent = value!; row.append(term, description); fields.append(row);
    }
    detail.append(heading, description, fields);
  }
  function errorMessage(error: unknown) {
    return error instanceof Error && !['TimeoutError', 'TypeError', 'AbortError', 'SyntaxError'].includes(error.name)
      ? error.message : 'We couldn’t confirm the request. Check your connection and try again.';
  }
  async function select(id: string) {
    if (blocked) return;
    const current = version;
    callbacks.busy(true); feedback.textContent = 'Loading draft…';
    detail.hidden = true;
    try {
      const data = await request(`/api/listings/${encodeURIComponent(id)}`);
      if (current !== version) return;
      if (!validListing(data.listing) || data.listing.id !== id) throw new Error('Draft details were incomplete. Select the draft to retry.');
      showDetail(data.listing); feedback.textContent = 'Your private draft. Its saved location stays unchanged when you update your account location.';
    } catch (error) { if (current === version) feedback.textContent = `${errorMessage(error)} Select the draft to retry.`; }
    finally { if (current === version) callbacks.busy(false); }
  }
  function renderList() {
    list.replaceChildren();
    for (const item of listings) {
      const row = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary'; button.disabled = blocked;
      button.textContent = `${item.title} — ${transactions[item.transactionType]} · ${properties[item.propertyType]} · Draft`;
      button.addEventListener('click', () => { void select(item.id); }); row.append(button); list.append(row);
    }
  }
  async function load() {
    const current = version;
    ready = false; feedback.textContent = 'Loading your drafts…'; setBusy(blocked);
    eligibility.textContent = 'Checking whether you can create a new draft…';
    try {
      const [data, provider, location] = await Promise.all([
        request('/api/listings'), request('/api/provider-application'), request('/api/location'),
      ]);
      if (current !== version) return;
      if (!Array.isArray(data.listings) || data.listings.length > 50 || !data.listings.every(validListing)) throw new Error('Draft list was incomplete. Reload to try again.');
      listings = data.listings; ready = true;
      eligible = provider.application?.status === 'APPROVED' && location.location?.confirmed === true && listings.length < 50;
      eligibility.textContent = listings.length >= 50 ? 'You have reached the limit of 50 private drafts. Your saved drafts are available above.'
        : provider.application?.status !== 'APPROVED'
        ? 'An approved provider application is required to create a draft. Your existing drafts remain private and accessible.'
        : !location.location?.confirmed ? 'Save a confirmed property location above, then reload drafts to continue.'
          : 'Ready to create. Your currently saved account location will be copied into this draft.';
      renderList(); feedback.textContent = listings.length ? `Showing your ${listings.length} most recent drafts. Select one to view its saved details.` : 'No drafts yet. Create your first private property draft below.';
    } catch (error) {
      if (current === version) {
        feedback.textContent = `${errorMessage(error)} Reload drafts to retry.`;
        eligibility.textContent = 'Reload drafts to check whether you can create a new draft.';
      }
    }
    finally { if (current === version) setBusy(blocked); }
  }
  title.addEventListener('input', () => {
    title.setCustomValidity([...title.value.trim().normalize('NFC')].length > 120 ? 'Use no more than 120 characters.' : '');
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (blocked || !ready || !eligible) return;
    const normalized = title.value.trim().normalize('NFC');
    title.setCustomValidity(!normalized || [...normalized].length > 120 ? 'Enter a title using 1–120 characters.' : '');
    if (!form.reportValidity()) return;
    const payload = { title: normalized, transactionType: transaction.value, propertyType: property.value };
    const serialized = JSON.stringify(payload);
    if (!retry || retry.payload !== serialized) retry = { payload: serialized, requestId: crypto.randomUUID() };
    const requestId = retry.requestId, current = version;
    void (async () => {
      callbacks.busy(true); feedback.textContent = 'Saving your private draft…';
      try {
        const data = await request('/api/listings', { requestId, ...payload });
        if (current !== version) return;
        if (!validListing(data.listing)) throw new Error('The save response was incomplete. Retry with the same details to safely confirm the draft.');
        retry = undefined; form.reset();
        listings = [data.listing, ...listings.filter(item => item.id !== data.listing.id)].slice(0, 50);
        if (listings.length >= 50) { eligible = false; eligibility.textContent = 'You have reached the limit of 50 private drafts. Your saved drafts are available above.'; }
        renderList(); showDetail(data.listing);
        feedback.textContent = 'Draft saved privately. Its location is a copy of your saved account location at creation.';
      } catch (error) { if (current === version) feedback.textContent = `${errorMessage(error)} Retry the same details to safely confirm this draft, or reload your drafts.`; }
      finally { if (current === version) callbacks.busy(false); }
    })();
  });
  reload.addEventListener('click', () => {
    if (blocked) return;
    const current = version;
    void (async () => { callbacks.busy(true); try { await load(); } finally { if (current === version) callbacks.busy(false); } })();
  });
  return { reset, load, setBusy };
}
