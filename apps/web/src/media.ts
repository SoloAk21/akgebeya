type Photo = { id: string; url: string; width: number; height: number; byteSize: number; createdAt: string };
type Collection = { media: Photo[]; version: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class MediaError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export function mediaPanel(callbacks: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  function node<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing photo control: ${id}`);
    return element as T;
  }
  const panel = node('listing-media'), list = node('listing-media-list'), status = node('listing-media-status');
  const input = node<HTMLInputElement>('listing-media-file'), upload = node<HTMLButtonElement>('listing-media-upload');
  const reload = node<HTMLButtonElement>('listing-media-reload'), clear = node<HTMLButtonElement>('listing-media-clear');
  const selectedFile = node('listing-media-selected');
  let listingId: string | undefined, epoch = 0, collection: Collection | undefined;
  let approved = false, blocked = true, loading = false, stale = false;
  let controller = new AbortController();
  let pending: { file: File; uploadId: string; attempted: boolean } | undefined;
  const path = () => `/api/listings/${listingId}/media`;
  function setBusy(value: boolean, canWrite = approved) {
    blocked = value; approved = canWrite;
    const disabled = value || loading || !listingId;
    input.disabled = disabled || !approved || !collection || stale || collection.media.length >= 10;
    upload.disabled = disabled || !approved || !collection || stale || !pending || (collection.media.length >= 10 && !pending.attempted);
    clear.disabled = disabled || !pending;
    reload.disabled = disabled;
    for (const button of list.querySelectorAll<HTMLButtonElement>('button')) {
      button.disabled = disabled || !approved || stale || button.dataset['boundary'] === 'true';
    }
    panel.setAttribute('aria-busy', String(loading));
  }
  function clearFile() { pending = undefined; input.value = ''; selectedFile.textContent = ''; setBusy(blocked); }
  function reset() {
    epoch++; controller.abort(); controller = new AbortController();
    listingId = undefined; collection = undefined; approved = false; loading = false; stale = false;
    for (const image of list.querySelectorAll('img')) image.removeAttribute('src');
    list.replaceChildren(); panel.hidden = true; status.textContent = ''; clearFile(); setBusy(true);
  }
  function validCollection(value: unknown): value is Collection {
    if (!value || typeof value !== 'object') return false;
    const data = value as Collection;
    return Number.isInteger(data.version) && data.version >= 0 && Array.isArray(data.media) && data.media.length <= 10
      && new Set(data.media.map(photo => photo?.id)).size === data.media.length
      && data.media.every(photo => photo && typeof photo.id === 'string' && uuid.test(photo.id)
        && photo.url === `${path()}/${photo.id}` && Number.isInteger(photo.width) && photo.width > 0
        && Number.isInteger(photo.height) && photo.height > 0 && Number.isInteger(photo.byteSize) && photo.byteSize > 0
        && Number.isFinite(Date.parse(photo.createdAt)));
  }
  async function request(method = 'GET', body?: unknown, suffix = '', file?: File, uploadId?: string) {
    const current = epoch;
    const response = await fetch(`${path()}${suffix}`, { method, credentials: 'same-origin', cache: 'no-store',
      ...(file ? { headers: { 'Content-Type': file.type, 'X-Upload-Id': uploadId! }, body: file }
        : body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(file ? 60000 : 20000)]) });
    if (current !== epoch) throw new DOMException('Cancelled', 'AbortError');
    if (response.status === 401) { await callbacks.expired(); throw new DOMException('Session ended', 'AbortError'); }
    const data = await response.json();
    if (current !== epoch) throw new DOMException('Cancelled', 'AbortError');
    if (!response.ok) throw new MediaError(typeof data.message === 'string' ? data.message : 'The photo request could not be completed.', typeof data.error === 'string' ? data.error : '');
    if (!validCollection(data)) throw new Error('The photo response was incomplete. Reload photos to check the saved collection.');
    return data;
  }
  function message(error: unknown) {
    return error instanceof Error && !['TypeError', 'SyntaxError', 'TimeoutError', 'AbortError'].includes(error.name)
      ? error.message : 'We couldn’t confirm the photo request. Check your connection and retry.';
  }
  function render() {
    for (const image of list.querySelectorAll('img')) image.removeAttribute('src');
    list.replaceChildren();
    for (const [index, photo] of (collection?.media ?? []).entries()) {
      const item = document.createElement('li'), heading = document.createElement('strong');
      heading.textContent = index === 0 ? 'Photo 1 · Cover' : `Photo ${index + 1}`;
      const image = document.createElement('img'); image.alt = `Property photo ${index + 1}${index === 0 ? ', cover photo' : ''}`;
      image.width = photo.width; image.height = photo.height; image.decoding = 'async';
      const imageStatus = document.createElement('p'); imageStatus.className = 'note'; imageStatus.textContent = 'Loading photo…';
      image.addEventListener('load', () => { imageStatus.textContent = `${photo.width} × ${photo.height} pixels`; });
      image.addEventListener('error', () => { imageStatus.textContent = 'This photo could not load. Reload photos to try again.'; });
      image.src = photo.url;
      const controls = document.createElement('div'); controls.className = 'photo-actions';
      for (const [label, delta] of [['Move earlier', -1], ['Move later', 1]] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
        button.textContent = label; button.setAttribute('aria-label', `${label}: photo ${index + 1}`);
        button.dataset['boundary'] = String(index + delta < 0 || index + delta >= collection!.media.length);
        button.addEventListener('click', () => {
          if (!collection || blocked || loading || stale || !approved) return;
          const ids = collection.media.map(item => item.id), target = index + delta;
          if (target < 0 || target >= ids.length) return;
          [ids[index], ids[target]] = [ids[target]!, ids[index]!];
          void change('PUT', { version: collection.version, mediaIds: ids }, '', 'Photo order saved. The first photo is the cover.');
        }); controls.append(button);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary';
      remove.textContent = 'Remove photo'; remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
      remove.addEventListener('click', () => {
        if (!collection || blocked || loading || stale || !approved) return;
        void change('DELETE', { version: collection.version }, `/${photo.id}`, 'Photo removed.');
      }); controls.append(remove);
      item.append(heading, image, imageStatus, controls); list.append(item);
    }
    setBusy(blocked);
  }
  async function load(globalBusy: boolean) {
    if (!listingId || loading) return;
    const current = epoch; loading = true; setBusy(blocked); if (globalBusy) callbacks.busy(true);
    status.textContent = 'Loading private photos…';
    try {
      const data = await request(); if (current !== epoch) return;
      collection = data; stale = false; render();
      status.textContent = data.media.length ? `${data.media.length} of 10 photos saved. The first photo is the cover.` : 'No photos yet. Add the first photo for this property.';
      if (!approved) status.textContent += ' An approved provider account is required to change photos.';
    } catch (error) { if (current === epoch) { stale = true; status.textContent = `${message(error)} Reload photos to retry.`; } }
    finally { if (current === epoch) { loading = false; setBusy(blocked); if (globalBusy) callbacks.busy(false); } }
  }
  async function change(method: 'PUT' | 'DELETE' | 'POST', body: unknown, suffix: string, success: string) {
    if (!listingId || blocked || loading || !approved || stale) return;
    const current = epoch, file = method === 'POST' ? pending : undefined;
    if (method === 'POST' && !file) return;
    if (file) file.attempted = true;
    loading = true; callbacks.busy(true); status.textContent = file ? 'Uploading and preparing your photo…' : 'Saving photo changes…';
    try {
      const data = await request(method, body, suffix, file?.file, file?.uploadId); if (current !== epoch) return;
      collection = data; stale = false;
      if (file) clearFile(); render(); status.textContent = success;
    } catch (error) {
      if (current !== epoch) return;
      if (error instanceof MediaError && error.code === 'MEDIA_VERSION_CONFLICT') {
        stale = true; status.textContent = 'Photos changed elsewhere. Reload photos before making another change. Your property text edits are unchanged.';
      } else status.textContent = `${message(error)} ${file ? 'Retry uploading the same selected file to safely confirm it, or reload photos.' : 'Reload photos to check the saved order before trying again.'}`;
    } finally { if (current === epoch) { loading = false; callbacks.busy(false); } }
  }
  input.addEventListener('change', () => {
    const file = input.files?.[0]; clearFile();
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 8 * 1024 * 1024) {
      status.textContent = 'Choose a JPEG, PNG, or WebP photo no larger than 8 MiB.'; return;
    }
    pending = { file, uploadId: crypto.randomUUID(), attempted: false };
    selectedFile.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MiB). Choose Upload photo to save it.`;
    status.textContent = 'Photo selected. It has not been uploaded.'; setBusy(blocked);
  });
  clear.addEventListener('click', clearFile);
  upload.addEventListener('click', () => { void change('POST', undefined, '', 'Photo saved privately. The first photo is the cover.'); });
  reload.addEventListener('click', () => { if (!blocked) void load(true); });
  function select(id: string, canWrite: boolean) {
    if (listingId === id) { setBusy(blocked, canWrite); return; }
    const previousBusy = blocked; reset(); listingId = id; approved = canWrite; panel.hidden = false; setBusy(previousBusy); void load(false);
  }
  return { reset, select, setBusy };
}
