type Application = { accountId: string; providerType: string; status: string; submittedAt: string;
  account: { email: string; displayName: string | null };
  review: { reason: string | null; reviewedAt: string; decision: string } | null };

export function adminPanel(options: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  function node<T extends HTMLElement>(id: string) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing admin control: ${id}`);
    return element as T;
  }
  const panel = node('admin-panel');
  const feedback = node('admin-feedback');
  const list = node('admin-list');
  const next = node<HTMLButtonElement>('admin-next');
  const reload = node<HTMLButtonElement>('admin-reload');
  const selected = node('admin-selected');
  const form = node<HTMLFormElement>('admin-review-form');
  const decision = node<HTMLSelectElement>('admin-decision');
  const reason = node<HTMLTextAreaElement>('admin-reason');
  const refresh = node<HTMLButtonElement>('admin-refresh-selected');
  let current: Application | null = null;
  let nextCursor: string | null = null;
  let uncertain = false;

  function setBusy(value: boolean) {
    for (const element of panel.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button, select, textarea')) element.disabled = value;
    if (!value) for (const element of form.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button, select, textarea')) {
      element.disabled = uncertain || current?.status !== 'PENDING';
    }
    panel.setAttribute('aria-busy', String(value));
  }
  function reset() {
    panel.hidden = true; list.replaceChildren(); selected.hidden = true;
    current = null; nextCursor = null; next.hidden = true; feedback.textContent = '';
    node('admin-selected-title').textContent = ''; node('admin-selected-details').textContent = '';
    decision.value = ''; reason.value = ''; uncertain = false;
  }
  async function request(path: string, data?: unknown) {
    const response = await fetch(`/api/admin/${path}`, {
      method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
      ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
    });
    const result = await response.json();
    if (response.status === 401) { await options.expired(); throw new Error('Please sign in again.'); }
    if (response.status === 403) reset();
    if (!response.ok) throw new Error(result.message ?? 'Review service is unavailable.');
    return result;
  }
  function show(application: Application) {
    current = application; uncertain = false; selected.hidden = false;
    node('admin-selected-title').textContent = application.account.displayName || application.account.email;
    node('admin-selected-details').textContent = `${application.account.email} · ${application.providerType} · ${application.status} · Submitted ${new Date(application.submittedAt).toLocaleString()}${application.review ? ` · Reviewed ${new Date(application.review.reviewedAt).toLocaleString()}${application.review.reason ? ` · ${application.review.reason}` : ''}` : ''}`;
    form.hidden = application.status !== 'PENDING'; decision.value = ''; reason.value = ''; reason.required = false;
  }
  async function load(cursor?: string) {
    const access = await request('access');
    if (!access.isAdmin) { reset(); return; }
    panel.hidden = false;
    const data = await request(`provider-applications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`) as { applications: Application[]; nextCursor: string | null };
    list.replaceChildren(); current = null; selected.hidden = true;
    nextCursor = data.nextCursor; next.hidden = !nextCursor;
    for (const application of data.applications) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary';
      button.textContent = `Review ${application.account.email} (${application.providerType})`;
      button.addEventListener('click', () => { show(application); setBusy(false); });
      item.append(button); list.append(item);
    }
    feedback.textContent = data.applications.length ? 'Select an application to review.' : 'No pending applications to review.';
  }
  async function run(operation: () => Promise<void>) {
    options.busy(true);
    try { await operation(); }
    catch (error) {
      feedback.textContent = error instanceof Error && !['TimeoutError', 'TypeError'].includes(error.name)
        ? error.message : 'Request could not be confirmed. Reload before trying again.';
    } finally { options.busy(false); }
  }
  async function initialize() {
    try { await load(); }
    catch { panel.hidden = false; feedback.textContent = 'Review access could not be checked. Reload to try again.'; }
  }
  reload.addEventListener('click', () => { void run(() => load()); });
  next.addEventListener('click', () => { if (nextCursor) void run(() => load(nextCursor!)); });
  refresh.addEventListener('click', () => { if (current) void run(async () => {
    const data = await request(`provider-applications/${current!.accountId}`); show(data.application);
    feedback.textContent = 'Application status refreshed.';
  }); });
  decision.addEventListener('change', () => { reason.required = decision.value === 'REJECTED'; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!current || uncertain || current.status !== 'PENDING' || !form.reportValidity()) return;
    const accountId = current.accountId;
    void run(async () => {
      uncertain = true;
      feedback.textContent = 'Saving decision…';
      const data = await request(`provider-applications/${accountId}`, { decision: decision.value, reason: reason.value });
      show(data.application);
      // Remove stale queue buttons; reloading retrieves only pending applications.
      list.replaceChildren(); next.hidden = true;
      feedback.textContent = 'Decision saved. The provider can now see it. Reload the queue to review another application.';
    });
  });
  return { reset, initialize, setBusy };
}
