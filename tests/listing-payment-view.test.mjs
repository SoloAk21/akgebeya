import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListingPayment, validCheckoutUrl } from '../apps/web/src/listing-payment.ts';
const id = '12345678-1234-1234-1234-123456789012';
const payment = { id: '22345678-1234-1234-1234-123456789012', listingId: id, sourceVersion: 3, amount: '1000.00', currency: 'ETB', policyRevision: 'flat-etb-1000-v1', status: 'READY', checkoutUrl: 'https://checkout.chapa.co/checkout/payment/test_123', createdAt: '2026-09-16T10:00:00Z' };
test('checkout links allow only exact Chapa HTTPS routes without credentials or redirect data', () => {
  for (const url of [payment.checkoutUrl, 'https://checkout.chapa.co/payment/test-123']) assert.equal(validCheckoutUrl(url), true);
  for (const url of ['http://checkout.chapa.co/payment/x', 'https://checkout.chapa.co.evil.test/payment/x', 'https://user@checkout.chapa.co/payment/x', 'https://checkout.chapa.co:443/payment/x', 'https://checkout.chapa.co/payment/x?next=evil', 'https://checkout.chapa.co/payment/x#other', 'https://checkout.chapa.co/payment/%2F', 'https://checkout.chapa.co/other/x', '//checkout.chapa.co/payment/x', null]) assert.equal(validCheckoutUrl(url), false);
});
test('payment parser accepts ready and uncertain states without claiming settlement', () => {
  assert.equal(parseListingPayment({ payment, currentVersion: 3, stale: false }, id).payment.status, 'READY');
  for (const status of ['INITIALIZING', 'UNKNOWN', 'FAILED']) {
    assert.equal(parseListingPayment({ payment: { ...payment, status, checkoutUrl: null }, currentVersion: 3, stale: false }, id).payment.status, status);
  }
  assert.equal(parseListingPayment({ payment: null, currentVersion: 3, stale: false }, id).payment, null);
  assert.equal(parseListingPayment({ payment: { ...payment, checkoutUrl: null }, currentVersion: 4, stale: true }, id).stale, true);
});
test('payment parser rejects unsafe, unrelated and inconsistent responses', () => {
  for (const change of [{ status: 'PAID' }, { amount: 1000 }, { currency: 'USD' }, { listingId: payment.id }, { checkoutUrl: 'https://evil.test/payment/x' }, { checkoutUrl: null }, { status: ['READY'] }]) {
    assert.throws(() => parseListingPayment({ payment: { ...payment, ...change }, currentVersion: 3, stale: false }, id));
  }
  assert.throws(() => parseListingPayment({ payment, currentVersion: 4, stale: false }, id));
  assert.throws(() => parseListingPayment({ payment, currentVersion: 3, stale: true }, id));
  assert.throws(() => parseListingPayment({ payment: null, currentVersion: 3, stale: true }, id));
});
