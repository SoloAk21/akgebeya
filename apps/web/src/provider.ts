type Application = { providerType: string; status: string; submittedAt: string };
const types: Record<string, string> = { OWNER: 'Owner', BROKER: 'Broker', AGENT: 'Agent', AGENCY: 'Agency', DEVELOPER: 'Developer' };
const statuses: Record<string, string> = { PENDING: 'Pending review', APPROVED: 'Approved', REJECTED: 'Rejected' };

export function providerPanel(options: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  function node<T extends HTMLElement>(id: string) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing provider control: ${id}`);
    return element as T;
  }
  const form = node<HTMLFormElement>('provider-form');
  const type = node<HTMLSelectElement>('provider-type');
  const submit = node<HTMLButtonElement>('provider-submit');
  const reload = node<HTMLButtonElement>('provider-reload');
  const feedback = node('provider-feedback');
  const details = node('provider-details');
  let ready = false;
  let application: Application | null = null;

  function setBusy(value: boolean) {
    type.disabled = value || !ready || Boolean(application);
    submit.disabled = value || !ready || Boolean(application);
    reload.disabled = value;
    form.setAttribute('aria-busy', String(value));
  }
  function reset() {
    ready = false;
    application = null;
    type.value = '';
    feedback.textContent = '';
    details.hidden = true;
    form.hidden = true;
    reload.hidden = true;
    for (const id of ['provider-saved-type', 'provider-saved-status', 'provider-submitted']) node(id).textContent = '';
    setBusy(true);
  }
  async function request(save: boolean) {
    const response = await fetch('/api/provider-application', {
      method: save ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(save ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerType: type.value }) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json() as { application?: Application | null; message?: string };
    if (response.status === 401) { await options.expired(); return false; }
    if (!response.ok) throw new Error(data.message ?? 'Unable to check your application.');
    const saved = data.application;
    if (saved === undefined || (save && !saved) || (saved && (!types[saved.providerType]
      || !statuses[saved.status] || !Number.isFinite(Date.parse(saved.submittedAt))))) {
      throw new Error('The application response was incomplete. Reload to check your status.');
    }
    application = saved;
    ready = true;
    form.hidden = Boolean(saved);
    details.hidden = !saved;
    if (saved) {
      node('provider-saved-type').textContent = types[saved.providerType]!;
      node('provider-saved-status').textContent = statuses[saved.status]!;
      node('provider-submitted').textContent = new Date(saved.submittedAt).toLocaleString();
      feedback.textContent = saved.status === 'PENDING'
        ? 'Your application is saved and awaiting review. You are not verified yet.'
        : `Your application status is ${statuses[saved.status]!.toLowerCase()}.`;
    } else feedback.textContent = 'Choose the type that describes how you provide properties.';
    return true;
  }
  async function load() {
    ready = false;
    feedback.textContent = 'Checking your provider application…';
    reload.hidden = true;
    try { if (await request(false)) reload.hidden = false; }
    catch { feedback.textContent = 'We couldn’t load your application. Reload to try again.'; reload.hidden = false; }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!ready || application || !form.reportValidity()) return;
    void (async () => {
      options.busy(true);
      feedback.textContent = 'Submitting your application…';
      try { await request(true); }
      catch (error) {
        // A timed-out submission may have succeeded. Require a fresh read before retrying.
        ready = false;
        feedback.textContent = error instanceof Error && !['TimeoutError', 'TypeError'].includes(error.name)
          ? error.message : 'Submission could not be confirmed. Reload to check your status before trying again.';
        reload.hidden = false;
      } finally { options.busy(false); }
    })();
  });
  reload.addEventListener('click', () => {
    void (async () => { options.busy(true); try { await load(); } finally { options.busy(false); } })();
  });
  return { reset, load, setBusy };
}
