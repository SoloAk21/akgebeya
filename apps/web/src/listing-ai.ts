type Source = { id: string; version: number; status: 'DRAFT' | 'COMPLETE' };
type Copy = { title: string; description: string };
type Content = { en: Copy; am: Copy; sourceVersion: number; model: string; generatedAt: string };
type Result = { content: Content | null; currentVersion: number; stale: boolean };

function validResult(value: unknown): value is Result {
  if (!value || typeof value !== 'object') return false;
  const result = value as Result;
  if (!Number.isInteger(result.currentVersion) || result.currentVersion < 1 || typeof result.stale !== 'boolean') return false;
  const content = result.content;
  if (content === null) return true;
  const validCopy = (copy: Copy) => copy && typeof copy.title === 'string' && copy.title.length > 0 && copy.title.length <= 1000
    && typeof copy.description === 'string' && copy.description.length > 0 && copy.description.length <= 20000;
  return Boolean(content) && validCopy(content.en) && validCopy(content.am) && Number.isInteger(content.sourceVersion)
    && content.sourceVersion >= 1 && typeof content.model === 'string' && Number.isFinite(Date.parse(content.generatedAt));
}

export function listingAiPanel(callbacks: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  function node<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing listing assistant control: ${id}`);
    return element as T;
  }
  const panel = node('listing-ai'), feedback = node('listing-ai-status'), readiness = node('listing-ai-readiness');
  const consent = node<HTMLInputElement>('listing-ai-consent'), generate = node<HTMLButtonElement>('listing-ai-generate');
  const reload = node<HTMLButtonElement>('listing-ai-reload'), output = node('listing-ai-output');
  let source: Source | undefined, result: Result | undefined, epoch = 0;
  let approved = false, blocked = true, dirty = false, loading = false, loaded = false;
  let controller = new AbortController(), requestId: string | undefined;
  function setBusy(value: boolean, canWrite = approved, unsaved = dirty) {
    blocked = value; approved = canWrite; dirty = unsaved;
    const outOfDate = result !== undefined && result.currentVersion !== source?.version;
    const eligible = Boolean(source) && approved && source?.status === 'COMPLETE' && !dirty && !outOfDate;
    consent.disabled = value || loading || !loaded || !eligible;
    generate.disabled = consent.disabled || !consent.checked;
    reload.disabled = value || loading || !source;
    panel.setAttribute('aria-busy', String(loading));
    readiness.textContent = dirty ? 'Save or discard your property edits before generating copy. The text below does not include your unsaved changes.'
      : !approved ? 'An approved provider account is required to generate copy. Saved copy remains private and readable.'
        : source?.status !== 'COMPLETE' ? 'Mark the property complete before generating copy.'
          : outOfDate ? 'The saved property changed elsewhere. Reload its saved details before generating copy.'
            : !loaded ? 'Reload saved copy to check the assistant before generating.'
              : 'Ready to generate from your saved, complete property. Your original details will stay unchanged.';
  }
  function render() {
    output.replaceChildren(); output.hidden = !result?.content;
    const content = result?.content;
    if (!content) return;
    const note = document.createElement('p'); note.className = 'note';
    note.textContent = result!.stale || content.sourceVersion !== source?.version
      ? 'This copy is out of date: your saved property details have changed. Review it and generate fresh copy after completing the property.'
      : 'Generated copy for the saved property. Review factual accuracy and the Amharic translation before using it.';
    output.append(note);
    for (const [language, label] of [['en', 'English'], ['am', 'አማርኛ / Amharic']] as const) {
      const block = document.createElement('div'); block.className = 'listing-ai-language'; block.lang = language;
      const heading = document.createElement('h5'), title = document.createElement('strong'), description = document.createElement('p');
      heading.textContent = label; title.textContent = content[language].title; description.textContent = content[language].description;
      block.append(heading, title, description); output.append(block);
    }
    const saved = document.createElement('p'); saved.className = 'note';
    saved.textContent = `Saved privately ${new Date(content.generatedAt).toLocaleString()}. This copy has not been published or inserted into your property details.`;
    output.append(saved);
  }
  function reset() {
    epoch++; controller.abort(); controller = new AbortController(); source = undefined; result = undefined;
    loading = false; loaded = false; requestId = undefined; consent.checked = false;
    panel.hidden = true; output.replaceChildren(); output.hidden = true; feedback.textContent = ''; readiness.textContent = '';
    setBusy(true, false, false);
  }
  function errorMessage(error: unknown) {
    return error instanceof Error && !['TypeError', 'SyntaxError', 'TimeoutError', 'AbortError'].includes(error.name)
      ? error.message : 'We couldn’t confirm the assistant request. Check your connection and retry.';
  }
  async function request(create: boolean) {
    const current = epoch;
    const response = await fetch(`/api/listings/${source!.id}/ai-content`, {
      method: create ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(create ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: source!.version, requestId, consent: true }) } : {}),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(create ? 65000 : 20000)]),
    });
    if (current !== epoch) throw new DOMException('Cancelled', 'AbortError');
    if (response.status === 401) { await callbacks.expired(); throw new DOMException('Session ended', 'AbortError'); }
    const data = await response.json();
    if (current !== epoch) throw new DOMException('Cancelled', 'AbortError');
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'The listing assistant is unavailable. Try again later.');
    if (!validResult(data)) throw new Error('The assistant response was incomplete. Reload saved copy to check whether generation succeeded.');
    return data;
  }
  async function run(create: boolean, globalBusy: boolean) {
    if (!source || loading || (create && (blocked || !approved || dirty || source.status !== 'COMPLETE' || !loaded || !consent.checked || result?.currentVersion !== source.version))) return;
    const current = epoch;
    if (create) requestId ??= crypto.randomUUID();
    loading = true; setBusy(blocked); if (globalBusy) callbacks.busy(true);
    feedback.textContent = create ? 'Generating and saving private English and Amharic copy…' : 'Loading saved bilingual copy…';
    try {
      const data = await request(create); if (current !== epoch) return;
      result = data; loaded = true; render();
      if (create) { requestId = undefined; consent.checked = false; }
      feedback.textContent = data.content ? create ? 'Bilingual copy saved privately. Review both languages below.' : 'Your saved bilingual copy.' : 'No bilingual copy has been generated yet.';
    } catch (error) {
      if (current !== epoch) return;
      if (!create) loaded = false;
      feedback.textContent = `${errorMessage(error)} ${create ? 'Your source details are unchanged. Retry with the same saved property, or reload saved copy to check the result.' : 'Use Reload saved copy to try again.'}`;
    } finally { if (current === epoch) { loading = false; setBusy(blocked); if (globalBusy) callbacks.busy(false); } }
  }
  function select(next: Source, canWrite: boolean) {
    if (source?.id === next.id && source.version === next.version) { source = next; setBusy(blocked, canWrite, false); render(); return; }
    const previousBusy = blocked, previous = source?.id === next.id ? result : undefined;
    reset(); source = { id: next.id, version: next.version, status: next.status }; result = previous;
    panel.hidden = false; setBusy(previousBusy, canWrite, false); render(); void run(false, false);
  }
  consent.addEventListener('change', () => { setBusy(blocked); });
  generate.addEventListener('click', () => { void run(true, true); });
  reload.addEventListener('click', () => { if (!blocked) void run(false, true); });
  return { reset, select, setBusy };
}
