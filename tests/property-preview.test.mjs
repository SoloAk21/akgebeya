import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePropertyPreview, previewText, formatPropertyAmount } from '../apps/web/src/property-view.ts';

const id = '54a682ca-ab2a-482e-a55c-b4c04bddbc5e', photoId = 'f239cb2a-42d9-4832-a1f1-9223c3c79bd0';
const data = () => ({ listing: { id, title: 'A saved home', description: 'The original saved description.', transactionType: 'RENT', propertyType: 'APARTMENT',
  status: 'COMPLETE', priceEtb: '25000.00', areaSqm: '90.25', bedrooms: 2, bathrooms: 1, version: 2, missingFields: [],
  location: { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city', subcityId: 'bole', latitude: 8.995123, longitude: 38.785456, address: null } },
  media: [{ id: photoId, url: `/api/listings/${id}/media/${photoId}`, width: 100, height: 80, byteSize: 1200, createdAt: '2026-09-16T00:00:00.000Z' }],
  mediaVersion: 2, copy: { en: { title: 'Generated title', description: 'The English generated description.' }, am: { title: 'አፓርታማ', description: 'በቦሌ የሚገኝ አፓርታማ ለኪራይ ቀርቧል።' },
    sourceVersion: 2, model: 'test-model', generatedAt: '2026-09-16T00:00:00.000Z' }, copyStale: false,
  provider: { displayName: 'Test provider', providerType: 'OWNER' } });

test('preview accepts saved complete/incomplete records and only authenticated same-listing media paths', () => {
  const value = data(); assert.deepEqual(parsePropertyPreview(value, id), value);
  const draft = data(); Object.assign(draft.listing, { status: 'DRAFT', priceEtb: null, areaSqm: null, bedrooms: null, bathrooms: null, description: '', missingFields: ['priceEtb', 'areaSqm'] });
  Object.assign(draft, { media: [], copy: null }); assert.deepEqual(parsePropertyPreview(draft, id), draft);
  for (const url of ['javascript:alert(1)', 'https://tracking.example/photo.jpg', `//tracking.example/${photoId}`, `/api/listings/${photoId}/media/${photoId}`]) {
    const unsafe = data(); unsafe.media[0].url = url; assert.throws(() => parsePropertyPreview(unsafe, id));
  }
  assert.throws(() => parsePropertyPreview(value, photoId));
  const duplicate = data(); duplicate.media.push(duplicate.media[0]); assert.throws(() => parsePropertyPreview(duplicate, id));
});

test('preview rejects malformed quantities, unsupported types and inconsistent copy versions', () => {
  for (const change of [{ priceEtb: '-1.00' }, { priceEtb: 'NaN' }, { bedrooms: 101 }, { propertyType: 'constructor' }, { transactionType: ['RENT'] }, { propertyType: ['HOUSE'] }, { status: ['COMPLETE'] }, { version: 0 }, { missingFields: ['unknown'] }]) {
    const value = data(); Object.assign(value.listing, change); assert.throws(() => parsePropertyPreview(value, id));
  }
  for (const change of [{ latitude: null }, { longitude: 181 }, { subcityId: 'constructor' }, { subcityId: ['bole'] }]) {
    const value = data(); Object.assign(value.listing.location, change); assert.throws(() => parsePropertyPreview(value, id));
  }
  const stale = data(); stale.copy.sourceVersion = 1; assert.throws(() => parsePropertyPreview(stale, id));
  stale.copyStale = true; assert.deepEqual(parsePropertyPreview(stale, id), stale);
  const missing = data(); delete missing.copy; assert.throws(() => parsePropertyPreview(missing, id));
});

test('preview language selection never presents stale AI text as the current listing', () => {
  const value = data(); assert.deepEqual(previewText(value, 'en'), value.copy.en); assert.deepEqual(previewText(value, 'am'), value.copy.am);
  const original = { title: value.listing.title, description: value.listing.description };
  assert.deepEqual(previewText(value, 'original'), original);
  value.copyStale = true; assert.deepEqual(previewText(value, 'am'), original);
  value.copyStale = false; value.copy.sourceVersion = 1; assert.deepEqual(previewText(value, 'en'), original);
  value.copy = null; assert.deepEqual(previewText(value, 'am'), original);
});

test('price and area formatting preserve exact decimal digits without floating point rounding', () => {
  assert.equal(formatPropertyAmount('25000.00'), '25,000');
  assert.equal(formatPropertyAmount('999999999999.99'), '999,999,999,999.99');
  assert.equal(formatPropertyAmount('90.25'), '90.25');
  assert.equal(formatPropertyAmount(null), 'Not provided');
});
