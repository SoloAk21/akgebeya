import { parsePropertyPreview, renderPropertyView, type PropertyPreview } from './property-view.js';

export function listingPreviewPanel(callbacks: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  function node<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing preview control: ${id}`);
    return element as T;
  }
  const open = node<HTMLButtonElement>('listing-preview-open');
  const help = node('listing-preview-help'), dialog = node<HTMLDialogElement>('listing-preview-dialog');
  const close = node<HTMLButtonElement>('listing-preview-close'), reload = node<HTMLButtonElement>('listing-preview-reload');
  const language = node<HTMLSelectElement>('listing-preview-language');
  const status = node('listing-preview-status'), copyNotice = node('listing-preview-copy-notice');
  const incomplete = node('listing-preview-incomplete'), content = node('listing-preview-content');
  let selectedId: string | undefined, data: PropertyPreview | undefined, epoch = 0;
  let blocked = true, dirty = false, loading = false, ownsBusy = false;
  let controller = new AbortController();
  let returnFocus: HTMLElement | undefined;
  function setBusy(value: boolean, unsaved = dirty) {
    blocked = value; dirty = unsaved;
    open.disabled = value || dirty || !selectedId;
    open.hidden = !selectedId;
    help.hidden = !selectedId;
    help.textContent = dirty ? 'Save or discard your property edits before previewing the saved property.' : 'Preview the latest saved details privately. This does not publish your property.';
    reload.disabled = value || loading || !selectedId;
    language.disabled = value || loading || !data;
    content.setAttribute('aria-busy', String(loading));
  }
  function clearContent() {
    for (const image of content.querySelectorAll('img')) image.removeAttribute('src');
    content.replaceChildren(); data = undefined;
    status.textContent = ''; copyNotice.textContent = ''; incomplete.textContent = ''; incomplete.hidden = true;
  }
  function finishClose(releaseBusy = true, restoreFocus = true) {
    epoch++; controller.abort(); controller = new AbortController();
    loading = false; const release = ownsBusy; ownsBusy = false;
    clearContent(); language.value = 'original';
    if (dialog.open) dialog.close();
    if (release && releaseBusy) callbacks.busy(false);
    setBusy(blocked);
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = undefined;
  }
  function reset() { finishClose(false, false); selectedId = undefined; dirty = false; setBusy(true); }
  function render() {
    if (!data) return;
    const freshCopy = data.copy !== null && !data.copyStale;
    for (const option of Array.from(language.options)) {
      if (option.value !== 'original') { option.hidden = !freshCopy; option.disabled = !freshCopy; }
    }
    if (!freshCopy) language.value = 'original';
    copyNotice.textContent = data.copyStale ? 'Generated copy is out of date and is excluded from this preview. Showing your original saved text.'
      : freshCopy ? 'English and Amharic generated copy is available. Review facts and translation accuracy before using it.'
        : 'Showing your original saved text. No generated bilingual copy is available.';
    incomplete.hidden = data.listing.status === 'COMPLETE';
    incomplete.textContent = data.listing.status === 'COMPLETE' ? '' : 'This property is still a draft. Some required details may be missing.';
    for (const image of content.querySelectorAll('img')) image.removeAttribute('src');
    renderPropertyView(content, data, language.value as 'original' | 'en' | 'am');
  }
  async function load() {
    if (!selectedId || loading || !dialog.open) return;
    const id = selectedId, current = ++epoch;
    controller.abort(); controller = new AbortController();
    clearContent(); loading = true; ownsBusy = true; callbacks.busy(true);
    status.textContent = 'Loading your saved property preview…';
    try {
      const response = await fetch(`/api/listings/${id}/preview`, { credentials: 'same-origin', cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (current !== epoch) return;
      if (response.status === 401) { await callbacks.expired(); return; }
      const result = await response.json();
      if (current !== epoch) return;
      if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : 'Your property preview is unavailable.');
      data = parsePropertyPreview(result, id); render();
      status.textContent = 'Latest saved property loaded. This preview is visible only to you.';
    } catch (error) {
      if (current !== epoch) return;
      const message = error instanceof Error && !['TypeError', 'SyntaxError', 'AbortError', 'TimeoutError'].includes(error.name)
        ? error.message : 'We couldn’t load your property preview. Check your connection.';
      status.textContent = `${message} Use Refresh preview to try again. Your editor changes are untouched.`;
    } finally {
      if (current === epoch) { loading = false; ownsBusy = false; callbacks.busy(false); }
    }
  }
  function select(id: string) {
    if (selectedId !== id) finishClose(false, false);
    selectedId = id; setBusy(blocked);
  }
  open.addEventListener('click', () => {
    if (blocked || dirty || !selectedId) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : open;
    dialog.showModal(); close.focus(); void load();
  });
  close.addEventListener('click', () => { finishClose(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); finishClose(); });
  reload.addEventListener('click', () => { if (!blocked) void load(); });
  language.addEventListener('change', render);
  return { reset, select, setBusy };
}
