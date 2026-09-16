import { parseListingFee, formatListingFee, type ListingFee } from './listing-fee.js';
type Source = { id: string; version: number; status: 'DRAFT' | 'COMPLETE' };
type Payment = { id: string; listingId: string; sourceVersion: number; amount: string; currency: 'ETB'; policyRevision: string; status: 'INITIALIZING' | 'READY' | 'UNKNOWN' | 'FAILED'; checkoutUrl: string | null; createdAt: string };
export type PaymentResult = { payment: Payment | null; currentVersion: number; stale: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validCheckoutUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && /^https:\/\/checkout\.chapa\.co\/(?:checkout\/payment|payment)\/[A-Za-z0-9_-]+$/.test(value);
}
export function parseListingPayment(value: unknown, expectedId: string): PaymentResult {
  const invalid = () => new Error('The payment response was incomplete. Reload test payment status to check it.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const data = value as PaymentResult;
  if (!Number.isInteger(data.currentVersion) || data.currentVersion < 1 || data.currentVersion > 2147483647 || typeof data.stale !== 'boolean') throw invalid();
  if (data.payment === null) { if (data.stale) throw invalid(); return data; }
  const payment = data.payment;
  if (!payment || typeof payment.id !== 'string' || !uuid.test(payment.id) || payment.listingId !== expectedId
    || !['INITIALIZING', 'READY', 'UNKNOWN', 'FAILED'].includes(payment.status)
    || typeof payment.createdAt !== 'string' || !Number.isFinite(Date.parse(payment.createdAt))
    || (payment.checkoutUrl !== null && (!validCheckoutUrl(payment.checkoutUrl) || payment.status !== 'READY'))
    || (data.stale && payment.checkoutUrl !== null)
    || (payment.status === 'READY' && !data.stale && payment.checkoutUrl === null)) throw invalid();
  parseListingFee({ ...payment, calculatedAt: payment.createdAt }, expectedId, payment.sourceVersion);
  if (payment.sourceVersion !== data.currentVersion && !data.stale) throw invalid();
  return data;
}

export function listingPaymentPanel(callbacks: { busy: (value: boolean) => void; expired: () => Promise<void> }) {
  const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = node('listing-payment'), status = node('listing-payment-status'), readiness = node('listing-payment-readiness');
  const amount = node('listing-payment-amount'), consent = node<HTMLInputElement>('listing-payment-consent');
  const start = node<HTMLButtonElement>('listing-payment-start'), reload = node<HTMLButtonElement>('listing-payment-reload');
  const link = node<HTMLAnchorElement>('listing-payment-checkout');
  let source: Source | undefined, data: PaymentResult | undefined, fee: ListingFee | undefined;
  let blocked = true, approved = false, dirty = false, loading = false, loaded = false, epoch = 0;
  let controller = new AbortController(), requestId: string | undefined;
  function setBusy(value: boolean, canWrite = approved, unsaved = dirty) {
    blocked = value; approved = canWrite; dirty = unsaved;
    const eligible = source?.status === 'COMPLETE' && approved && !dirty && data?.currentVersion === source.version && !data.stale;
    consent.disabled = value || loading || !loaded || !eligible || Boolean(data?.payment) || !fee;
    start.disabled = consent.disabled || !consent.checked;
    reload.disabled = value || loading || !source;
    link.hidden = value || loading || !loaded || !eligible || data?.payment?.status !== 'READY' || !data.payment.checkoutUrl;
    link.removeAttribute('href');
    if (!link.hidden && validCheckoutUrl(data?.payment?.checkoutUrl)) link.href = data.payment.checkoutUrl;
    readiness.textContent = dirty ? 'Save or discard your property changes before starting or opening test checkout.'
      : !approved ? 'An approved provider account is required to start or open test checkout.'
        : source?.status !== 'COMPLETE' ? 'Mark the saved property complete before starting test checkout.'
          : data?.stale || (data && data.currentVersion !== source.version) ? 'The saved property or photos changed. This test checkout cannot be used. Reload the saved property and test payment status.'
            : 'Sandbox only. Returning from Chapa does not confirm payment or publish your property.';
    if (dirty) { consent.checked = false; amount.textContent = ''; }
    panel.setAttribute('aria-busy', String(loading));
  }
  function reset() {
    epoch++; controller.abort(); controller = new AbortController(); source = undefined; data = undefined; fee = undefined;
    loading = false; loaded = false; requestId = undefined; consent.checked = false; panel.hidden = true;
    status.textContent = ''; amount.textContent = ''; link.hidden = true; link.removeAttribute('href'); setBusy(true, false, false);
  }
  function describe() {
    const payment = data?.payment;
    amount.textContent = payment ? `${formatListingFee({ ...payment, calculatedAt: payment.createdAt })} per listing (test payment)` : fee ? `${formatListingFee(fee)} per listing (test payment)` : '';
    status.textContent = data?.stale ? 'This saved test checkout is out of date and cannot be opened. The existing attempt needs operator review before another checkout can be created.'
      : !payment ? 'No test payment has been started for this property.'
      : payment.status === 'READY' ? 'Test checkout is ready. Open Chapa using the link below when available. No payment has been verified.'
        : payment.status === 'INITIALIZING' ? 'Test checkout is being prepared. Reload its status later. Do not start another payment.'
          : payment.status === 'UNKNOWN' ? 'The test checkout result is uncertain. Reload its status to check. Another payment cannot be started for this property.'
            : 'Test checkout initialization failed. Another payment cannot be started for this property in this step.';
  }
  async function request(path: string, body?: unknown) {
    const current = epoch;
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(body ? 65000 : 20000)]) });
    if (current !== epoch) throw new DOMException('Cancelled', 'AbortError');
    if (response.status === 401) { await callbacks.expired(); throw new DOMException('Session ended', 'AbortError'); }
    const result = await response.json();
    if (current !== epoch) throw new DOMException('Cancelled', 'AbortError');
    if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message : 'Test payment is unavailable.');
    return result;
  }
  async function run(create: boolean, globalBusy: boolean) {
    if (!source || loading || (create && (start.disabled || blocked || dirty || !consent.checked))) return;
    const current = epoch, id = source.id, version = source.version;
    if (create) requestId ??= crypto.randomUUID();
    loading = true; loaded = false; data = undefined; fee = undefined; amount.textContent = ''; setBusy(blocked); if (globalBusy) callbacks.busy(true);
    status.textContent = create ? 'Preparing Chapa test checkout…' : 'Checking saved test payment status…';
    try {
      const result = await request(`/api/listings/${id}/payment`, create ? { version, requestId, consent: true } : undefined);
      if (current !== epoch) return;
      data = parseListingPayment(result, id); fee = undefined;
      describe();
      if (!data.payment && approved && source.status === 'COMPLETE' && data.currentVersion === version) {
        fee = parseListingFee(await request(`/api/listings/${id}/fee`), id, version);
        if (current !== epoch) return;
      }
      loaded = true; describe();
      if (data.payment) consent.checked = false;
    } catch (error) {
      if (current !== epoch) return;
      loaded = false;
      amount.textContent = '';
      const message = error instanceof Error && !['TypeError', 'SyntaxError', 'AbortError', 'TimeoutError'].includes(error.name)
        ? error.message : 'We couldn’t confirm the test payment request. Check your connection.';
      status.textContent = `${message} Reload test payment status before trying anything else. This does not mean a payment succeeded.`;
    } finally { if (current === epoch) { loading = false; setBusy(blocked); if (globalBusy) callbacks.busy(false); } }
  }
  function select(next: Source, canWrite: boolean) {
    const previousBusy = blocked, previousRequestId = source?.id === next.id && source.version === next.version ? requestId : undefined;
    reset(); requestId = previousRequestId; source = { id: next.id, version: next.version, status: next.status };
    panel.hidden = false; setBusy(previousBusy, canWrite, false); void run(false, false);
  }
  consent.addEventListener('change', () => { setBusy(blocked); });
  start.addEventListener('click', () => { void run(true, true); });
  reload.addEventListener('click', () => { if (!blocked) void run(false, true); });
  function invalidate() {
    epoch++; controller.abort(); controller = new AbortController(); loading = false;
    loaded = false; consent.checked = false; amount.textContent = ''; fee = undefined;
    status.textContent = 'Property photos changed. Reload test payment status before starting or opening checkout.';
    setBusy(blocked);
  }
  return { reset, select, setBusy, invalidate };
}
