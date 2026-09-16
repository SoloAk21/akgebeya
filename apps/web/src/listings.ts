import { mediaPanel } from './media.js';
import { listingAiPanel } from './listing-ai.js';
import { listingPreviewPanel } from './listing-preview.js';

type Listing = {
  id: string; title: string; transactionType: 'RENT' | 'SALE';
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL'; status: 'DRAFT' | 'COMPLETE';
  description: string; priceEtb: string | null; areaSqm: string | null;
  bedrooms: number | null; bathrooms: number | null; version: number; missingFields: string[];
  createdAt: string; updatedAt: string;
  location: { countryId: string; regionId: string; cityId: string; subcityId: string;
    latitude: number; longitude: number; address: { formattedAddress: string } | null };
};
const transactions: Record<string, string> = { RENT: 'For rent', SALE: 'For sale' };
const properties: Record<string, string> = { APARTMENT: 'Apartment', HOUSE: 'House', LAND: 'Land', COMMERCIAL: 'Commercial' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const editKeys = ['title', 'transactionType', 'propertyType', 'description', 'priceEtb', 'areaSqm', 'bedrooms', 'bathrooms'] as const;
type EditKey = typeof editKeys[number];
const fieldLabels: Record<string, string> = { description: 'description (at least 20 characters)', priceEtb: 'price', areaSqm: 'area', bedrooms: 'bedrooms', bathrooms: 'bathrooms' };
class ListingRequestError extends Error {
  constructor(message: string, readonly code: string, readonly fieldErrors: Record<string, string>) { super(message); }
}
function validListing(value: unknown): value is Listing {
  if (!value || typeof value !== 'object') return false;
  const item = value as Listing;
  return typeof item.id === 'string' && uuid.test(item.id) && typeof item.title === 'string'
    && Object.hasOwn(transactions, item.transactionType) && Object.hasOwn(properties, item.propertyType) && ['DRAFT', 'COMPLETE'].includes(item.status)
    && typeof item.description === 'string' && Number.isInteger(item.version) && item.version >= 1
    && Array.isArray(item.missingFields) && item.missingFields.every(field => typeof field === 'string')
    && (item.priceEtb === null || typeof item.priceEtb === 'string') && (item.areaSqm === null || typeof item.areaSqm === 'string')
    && (item.bedrooms === null || Number.isInteger(item.bedrooms)) && (item.bathrooms === null || Number.isInteger(item.bathrooms))
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
  const editor = node('listing-editor'), editForm = node<HTMLFormElement>('listing-edit-form');
  const editStatus = node('listing-edit-status'), missing = node('listing-missing');
  const editSave = node<HTMLButtonElement>('listing-edit-save'), editComplete = node<HTMLButtonElement>('listing-edit-complete');
  const discard = node<HTMLButtonElement>('listing-discard');
  const edits = Object.fromEntries(editKeys.map(key => [key, node<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`listing-edit-${key}`)])) as Record<EditKey, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  const media = mediaPanel(callbacks);
  const assistant = listingAiPanel(callbacks);
  const preview = listingPreviewPanel(callbacks);
  let ready = false, blocked = true, eligible = false, approved = false, version = 0;
  let selected: Listing | undefined, dirty = false, conflict = false;
  let controller = new AbortController();
  let retry: { payload: string; requestId: string } | undefined;
  let listings: Listing[] = [];
  function setBusy(value: boolean) {
    blocked = value;
    for (const field of [title, transaction, property, create]) field.disabled = value || !ready || !eligible;
    reload.disabled = value;
    for (const button of list.querySelectorAll('button')) button.disabled = value;
    form.setAttribute('aria-busy', String(value));
    const editBlocked = value || !ready || !approved || !selected;
    for (const key of editKeys) edits[key].disabled = editBlocked;
    edits.bedrooms.disabled ||= ['LAND', 'COMMERCIAL'].includes(edits.propertyType.value);
    edits.bathrooms.disabled ||= edits.propertyType.value === 'LAND';
    editSave.disabled = editBlocked || conflict; editComplete.disabled = editBlocked || conflict;
    discard.disabled = value || !selected;
    editForm.setAttribute('aria-busy', String(value));
    media.setBusy(value, approved && ready);
    assistant.setBusy(value, approved && ready, dirty);
    preview.setBusy(value, dirty);
  }
  function reset() {
    version++; controller.abort(); controller = new AbortController();
    ready = false; eligible = false; approved = false; retry = undefined; listings = [];
    selected = undefined; dirty = false; conflict = false; editForm.reset(); editor.hidden = true;
    media.reset();
    assistant.reset();
    preview.reset();
    editStatus.textContent = ''; missing.textContent = ''; clearErrors();
    form.reset(); title.setCustomValidity('');
    list.replaceChildren(); detail.replaceChildren(); detail.hidden = true;
    feedback.textContent = ''; eligibility.textContent = ''; setBusy(true);
  }
  async function request(path: string, data?: unknown, method = 'POST') {
    const current = version;
    const response = await fetch(path, { method: data ? method : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
    const result = await response.json();
    if (current !== version) throw new DOMException('Cancelled', 'AbortError');
    if (response.status === 401) { await callbacks.expired(); throw new DOMException('Session ended', 'AbortError'); }
    if (!response.ok) {
      const errors: Record<string, string> = {};
      if (result.fieldErrors && typeof result.fieldErrors === 'object') {
        for (const key of editKeys) if (typeof result.fieldErrors[key] === 'string') errors[key] = result.fieldErrors[key];
      }
      throw new ListingRequestError(typeof result.message === 'string' ? result.message : 'Unable to load your drafts.', typeof result.error === 'string' ? result.error : '', errors);
    }
    return result;
  }
  function showDetail(item: Listing) {
    detail.replaceChildren(); detail.hidden = false;
    const heading = document.createElement('h4'); heading.textContent = item.title;
    const description = document.createElement('p');
    description.textContent = `${transactions[item.transactionType]} · ${properties[item.propertyType]} · ${item.status === 'COMPLETE' ? 'Complete · Still private' : 'Private draft'}`;
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
    selected = item; dirty = false; conflict = false; editor.hidden = false;
    media.select(item.id, approved && ready);
    assistant.select(item, approved && ready);
    preview.select(item.id);
    for (const key of editKeys) edits[key].value = String(item[key] ?? '');
    clearErrors(); updateEditor();
    missing.textContent = item.missingFields.length
      ? `Still needed in the saved version: ${item.missingFields.map(key => fieldLabels[key] ?? key).join(', ')}.`
      : 'The saved property has all required details. It remains private.';
    editStatus.textContent = approved ? 'Edit your details below. Changes are saved only when you choose an action.' : 'An approved provider account is required to edit. Your saved property remains accessible.';
    setBusy(blocked);
  }
  function clearErrors() {
    for (const key of editKeys) { edits[key].removeAttribute('aria-invalid'); node(`listing-edit-${key}-error`).textContent = ''; }
  }
  function updateEditor() {
    node('listing-price-label').textContent = edits.transactionType.value === 'RENT' ? 'Monthly rent (ETB/month)' : 'Sale price (ETB)';
    node('listing-bedrooms-row').hidden = ['LAND', 'COMMERCIAL'].includes(edits.propertyType.value);
    node('listing-bathrooms-row').hidden = edits.propertyType.value === 'LAND';
    setBusy(blocked);
  }
  function canLeaveEditor(action = 'choosing another property') {
    if (!dirty) return true;
    feedback.textContent = `You have unsaved property changes. Save them, or use “Discard changes and reload saved property” before ${action}.`;
    editStatus.textContent = feedback.textContent;
    return false;
  }
  function errorMessage(error: unknown) {
    return error instanceof Error && !['TimeoutError', 'TypeError', 'AbortError', 'SyntaxError'].includes(error.name)
      ? error.message : 'We couldn’t confirm the request. Check your connection and try again.';
  }
  async function select(id: string, discardChanges = false) {
    if (blocked || (!discardChanges && !canLeaveEditor())) return;
    const current = version;
    callbacks.busy(true); feedback.textContent = 'Loading draft…';
    try {
      const data = await request(`/api/listings/${encodeURIComponent(id)}`);
      if (current !== version) return;
      if (!validListing(data.listing) || data.listing.id !== id) throw new Error('Draft details were incomplete. Select the draft to retry.');
      showDetail(data.listing); feedback.textContent = 'Your private property. Its saved location stays unchanged when you update your account location.';
    } catch (error) { if (current === version) feedback.textContent = `${errorMessage(error)} Select the draft to retry.`; }
    finally { if (current === version) callbacks.busy(false); }
  }
  function renderList() {
    list.replaceChildren();
    for (const item of listings) {
      const row = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary'; button.disabled = blocked;
      button.textContent = `${item.title} — ${transactions[item.transactionType]} · ${properties[item.propertyType]} · ${item.status === 'COMPLETE' ? 'Complete (private)' : 'Draft'}`;
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
      approved = provider.application?.status === 'APPROVED';
      eligible = approved && location.location?.confirmed === true && listings.length < 50;
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
    if (blocked || !ready || !eligible || !canLeaveEditor()) return;
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
  for (const key of editKeys) {
    edits[key].addEventListener('input', () => {
      dirty = true; edits[key].removeAttribute('aria-invalid'); node(`listing-edit-${key}-error`).textContent = '';
      assistant.setBusy(blocked, approved && ready, dirty);
      preview.setBusy(blocked, dirty);
      if (!conflict) editStatus.textContent = 'You have unsaved changes.';
      if (key === 'transactionType' || key === 'propertyType') updateEditor();
    });
  }
  discard.addEventListener('click', () => { if (selected) void select(selected.id, true); });
  window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });
  editForm.addEventListener('submit', event => {
    event.preventDefault();
    if (blocked || !ready || !approved || !selected || conflict) return;
    clearErrors();
    const complete = event.submitter === editComplete;
    const propertyType = edits.propertyType.value;
    for (const key of ['bedrooms', 'bathrooms'] as const) {
      const field = edits[key] as HTMLInputElement;
      if (!field.disabled && field.validity.badInput) {
        field.setAttribute('aria-invalid', 'true'); node(`listing-edit-${key}-error`).textContent = 'Enter a whole number from 0 to 100, or leave this empty.';
        editStatus.textContent = 'Check the highlighted field. Your changes have not been saved.';
        field.focus(); return;
      }
    }
    const numberOrNull = (key: 'bedrooms' | 'bathrooms') => edits[key].value.trim() ? Number(edits[key].value) : null;
    const payload = {
      version: selected.version, title: edits.title.value.trim().normalize('NFC'), transactionType: edits.transactionType.value,
      propertyType, description: edits.description.value.trim().normalize('NFC'),
      priceEtb: edits.priceEtb.value.trim() || null, areaSqm: edits.areaSqm.value.trim() || null,
      bedrooms: ['LAND', 'COMMERCIAL'].includes(propertyType) ? null : numberOrNull('bedrooms'),
      bathrooms: propertyType === 'LAND' ? null : numberOrNull('bathrooms'), complete,
    };
    const id = selected.id, current = version;
    void (async () => {
      callbacks.busy(true); editStatus.textContent = complete ? 'Checking and saving your complete property…' : 'Saving your changes as a draft…';
      let firstInvalid: HTMLElement | undefined;
      try {
        const data = await request(`/api/listings/${encodeURIComponent(id)}`, payload, 'PUT');
        if (current !== version) return;
        if (!validListing(data.listing) || data.listing.id !== id) throw new Error('The save response was incomplete. Reload the saved property to check whether changes were saved.');
        listings = listings.map(item => item.id === id ? data.listing : item);
        renderList(); showDetail(data.listing);
        editStatus.textContent = data.listing.status === 'COMPLETE' ? 'Property marked complete. It is still private and has not been published.' : 'Changes saved as a private draft.';
        feedback.textContent = editStatus.textContent;
      } catch (error) {
        if (current !== version) return;
        if (error instanceof ListingRequestError) {
          for (const key of editKeys) {
            if (!error.fieldErrors[key]) continue;
            edits[key].setAttribute('aria-invalid', 'true'); node(`listing-edit-${key}-error`).textContent = error.fieldErrors[key]!;
            firstInvalid ??= edits[key];
          }
          if (error.code === 'VERSION_CONFLICT') {
            conflict = true;
            editStatus.textContent = 'This property changed elsewhere. Your edits are still here. Copy anything you want to keep, then choose “Discard changes and reload saved property” before editing the latest version.';
          } else editStatus.textContent = `${errorMessage(error)} Your edits are unchanged.`;
        } else editStatus.textContent = `${errorMessage(error)} Your edits are still here. Retry, or explicitly reload the saved property to check its latest version.`;
      } finally { if (current === version) { callbacks.busy(false); firstInvalid?.focus(); } }
    })();
  });
  return { reset, load, setBusy, canSignOut: () => canLeaveEditor('signing out') };
}
