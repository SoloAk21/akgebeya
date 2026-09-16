export type ListingFee = { listingId: string; sourceVersion: number; currency: 'ETB'; amount: string; policyRevision: string; calculatedAt: string };
export class FeeSourceChangedError extends Error {}
export function parseListingFee(value: unknown, expectedId: string, expectedVersion: number): ListingFee {
  const invalid = () => new Error('The fee response was incomplete. Check the listing fee again.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const fee = value as ListingFee;
  if (fee.listingId !== expectedId || typeof fee.listingId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fee.listingId)
    || !Number.isInteger(fee.sourceVersion) || fee.sourceVersion < 1 || fee.sourceVersion > 2147483647
    || fee.currency !== 'ETB' || typeof fee.amount !== 'string' || !/^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(fee.amount) || fee.amount === '0.00'
    || typeof fee.policyRevision !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(fee.policyRevision)
    || typeof fee.calculatedAt !== 'string' || !Number.isFinite(Date.parse(fee.calculatedAt))) throw invalid();
  if (fee.sourceVersion !== expectedVersion) throw new FeeSourceChangedError('The saved property changed elsewhere. Reload its saved details before checking the fee again.');
  return fee;
}
export function formatListingFee(fee: ListingFee) {
  const [whole, fraction] = fee.amount.split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction} ${fee.currency}`;
}

export function listingFeePanel(callbacks: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  function node<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing listing fee control: ${id}`);
    return element as T;
  }
  const panel = node('listing-fee'), check = node<HTMLButtonElement>('listing-fee-check');
  const status = node('listing-fee-status'), readiness = node('listing-fee-readiness');
  const result = node('listing-fee-result'), amount = node('listing-fee-amount'), checkedAt = node('listing-fee-checked');
  let source: { id: string; version: number; status: 'DRAFT' | 'COMPLETE' } | undefined;
  let blocked = true, approved = false, dirty = false, loading = false, outdated = false, epoch = 0;
  let controller = new AbortController();
  function clearResult() { result.hidden = true; amount.textContent = ''; checkedAt.textContent = ''; check.textContent = 'Check listing fee'; }
  function setBusy(value: boolean, canWrite = approved, unsaved = dirty) {
    blocked = value; approved = canWrite; dirty = unsaved;
    if (dirty || !approved) { clearResult(); status.textContent = ''; }
    check.disabled = value || loading || !source || !approved || dirty || outdated || source.status !== 'COMPLETE';
    readiness.textContent = dirty ? 'Save or discard your property changes before checking the fee. The previous fee display has been cleared.'
      : !approved ? 'An approved provider account is required to check the listing fee.'
        : source?.status !== 'COMPLETE' ? 'Mark the saved property complete before checking its listing fee.'
          : outdated ? 'Reload the saved property details before checking its fee again.'
            : 'Check the fee for this saved property. Rental and sale listings follow the same flat-fee policy.';
    panel.setAttribute('aria-busy', String(loading));
  }
  function reset() {
    epoch++; controller.abort(); controller = new AbortController();
    source = undefined; loading = false; outdated = false; clearResult(); status.textContent = ''; panel.hidden = true;
    setBusy(true, false, false);
  }
  function select(next: { id: string; version: number; status: 'DRAFT' | 'COMPLETE' }, canWrite: boolean) {
    const priorBlocked = blocked;
    reset(); source = { id: next.id, version: next.version, status: next.status }; panel.hidden = false;
    setBusy(priorBlocked, canWrite, false);
  }
  check.addEventListener('click', () => {
    if (!source || blocked || loading || dirty || !approved || outdated || source.status !== 'COMPLETE') return;
    const id = source.id, version = source.version, current = epoch;
    void (async () => {
      loading = true; clearResult(); callbacks.busy(true); status.textContent = 'Checking the listing fee…';
      try {
        const response = await fetch(`/api/listings/${id}/fee`, { credentials: 'same-origin', cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
        if (current !== epoch) return;
        if (response.status === 401) { await callbacks.expired(); return; }
        const data = await response.json();
        if (current !== epoch || dirty) return;
        if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'The listing fee is unavailable. Try again later.');
        const fee = parseListingFee(data, id, version);
        amount.textContent = `${formatListingFee(fee)} per listing`;
        checkedAt.textContent = `Checked ${new Date(fee.calculatedAt).toLocaleString()}.`;
        result.hidden = false; check.textContent = 'Refresh fee';
        status.textContent = 'Listing fee checked. No payment has been taken.';
      } catch (error) {
        if (current !== epoch) return;
        if (error instanceof FeeSourceChangedError) outdated = true;
        const message = error instanceof Error && !['TypeError', 'SyntaxError', 'TimeoutError', 'AbortError'].includes(error.name)
          ? error.message : 'We couldn’t check the listing fee. Check your connection and try again.';
        status.textContent = message;
      } finally { if (current === epoch) { loading = false; callbacks.busy(false); } }
    })();
  });
  return { reset, select, setBusy };
}
