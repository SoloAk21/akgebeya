import { AuthError } from './auth-security.js';

export interface ChapaInput { amount: string; currency: 'ETB'; reference: string; returnUrl: string }
export interface ChapaGateway {
  assertConfigured(): void;
  initialize(input: ChapaInput): Promise<{ checkoutUrl: string }>;
}
export class ChapaError extends AuthError {
  constructor(status: number, code: string, message: string, public readonly outcome: 'FAILED' | 'UNKNOWN' = 'UNKNOWN') {
    super(status, code, message);
  }
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function validChapaCheckout(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://checkout.chapa.co' && !url.username && !url.password && !url.port
      && !url.search && !url.hash && /^\/(?:checkout\/payment|payment)\/[A-Za-z0-9_-]+$/.test(url.pathname)
      && url.href === value;
  } catch { return false; }
}

// This milestone deliberately accepts v1 sandbox keys only. A live key must not
// silently turn a development checkout into a real financial transaction.
export function createChapaGateway(options: { key?: () => string | undefined; fetch?: typeof fetch; timeoutMs?: number } = {}): ChapaGateway {
  const key = options.key ?? (() => process.env['CHAPA_SECRET_KEY']);
  function configuredKey() {
    const value = key();
    if (!value || !/^CHASECK_TEST-[A-Za-z0-9_-]{8,200}$/.test(value)) {
      throw new ChapaError(503, 'CHAPA_NOT_CONFIGURED', 'Chapa test checkout is not configured. Ask the operator to configure a Chapa v1 test secret key.', 'FAILED');
    }
    return value;
  }
  return {
    assertConfigured() { configuredKey(); },
    async initialize(input) {
      const secret = configuredKey();
      let returnUrl: URL;
      try { returnUrl = new URL(input.returnUrl); } catch { throw new ChapaError(503, 'CHAPA_RETURN_URL_INVALID', 'The checkout return address is not configured.', 'FAILED'); }
      if (returnUrl.username || returnUrl.password || (returnUrl.protocol !== 'https:'
        && !(returnUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(returnUrl.hostname)))
        || input.currency !== 'ETB' || !/^[1-9]\d{0,11}\.\d{2}$/.test(input.amount)
        || !/^akg-[0-9a-f-]{36}$/.test(input.reference)) {
        throw new ChapaError(503, 'CHAPA_INPUT_INVALID', 'The checkout request could not be prepared.', 'FAILED');
      }
      try {
        const response = await (options.fetch ?? fetch)('https://api.chapa.co/v1/transaction/initialize', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: input.amount, currency: input.currency, tx_ref: input.reference,
            return_url: returnUrl.href, customization: { title: 'AkGebeya', description: 'Test listing fee' } }),
        });
        // Never echo provider bodies or credentials. Timeouts/5xx/ambiguous responses
        // may follow successful creation, so the service must not initiate again.
        if (!response.ok) {
          await response.body?.cancel();
          const definite = [400, 401, 403, 422].includes(response.status);
          throw new ChapaError(502, 'CHAPA_INITIALIZATION_FAILED', 'Chapa could not prepare this test checkout.', definite ? 'FAILED' : 'UNKNOWN');
        }
        if (!response.body) throw new Error('Missing body');
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 16384) { await reader.cancel(); throw new Error('Oversized body'); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!record(data) || data['status'] !== 'success' || !record(data['data']) || !validChapaCheckout(data['data']['checkout_url'])) throw new Error('Invalid response');
        return { checkoutUrl: data['data']['checkout_url'] };
      } catch (error) {
        if (error instanceof ChapaError) throw error;
        throw new ChapaError(502, 'CHAPA_RESULT_UNKNOWN', 'The checkout result could not be confirmed. Reload its status; do not create another payment.');
      }
    },
  };
}
