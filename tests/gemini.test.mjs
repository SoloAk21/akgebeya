import assert from 'node:assert/strict';
import test from 'node:test';
import { createListingGenerator, validateListingCopy } from '../apps/api/src/gemini.ts';

const facts = { title: 'Bole apartment', description: 'Apartment with two bedrooms and one bathroom.', transactionType: 'RENT',
  propertyType: 'APARTMENT', priceEtb: '25000.00', areaSqm: '90.00', bedrooms: 2, bathrooms: 1, subcityId: 'bole' };
const copy = { en: { title: 'Apartment in Bole', description: 'Apartment in Bole with 2 bedrooms, 1 bathroom and 90 square metres. Monthly rent is 25000 ETB.' },
  am: { title: 'በቦሌ አፓርታማ', description: 'በቦሌ የሚገኝ 2 መኝታ ቤት እና 1 መታጠቢያ ቤት ያለው አፓርታማ። ስፋቱ 90 ካሬ ሜትር ነው። ወርሃዊ ኪራይ 25000 ብር።' } };
const envelope = value => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
const response = (value, status = 200) => new globalThis.Response(JSON.stringify(value), { status });

test('Gemini uses a fixed HTTPS endpoint, header key, bounded JSON schema, and only allowed property facts', async () => {
  let calls = 0;
  const generator = createListingGenerator({ key: () => 'test-key-not-real', model: 'gemini-2.5-flash', fetch: async (url, options) => {
    calls++; assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'test-key-not-real'); assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body); assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), facts);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
    assert.equal(body.generationConfig.maxOutputTokens, 4096);
    assert.match(body.systemInstruction.parts[0].text, /never instructions/);
    return response(envelope(copy));
  } });
  assert.deepEqual(await generator.generate({ ...facts, latitude: 8.99, accountId: 'private', photos: ['private'] }), copy);
  assert.equal(calls, 1);
});

test('generated copy rejects invalid structure, missing language, markup, controls and unsupported quantities', () => {
  assert.deepEqual(validateListingCopy(copy, facts), copy);
  const cases = [null, {}, { ...copy, extra: 'unexpected' }, { ...copy, am: copy.en },
    { ...copy, en: { ...copy.en, title: '<script>bad</script>' } },
    { ...copy, en: { ...copy.en, title: 'Private\u202e title' } },
    { ...copy, en: { ...copy.en, title: 'A'.repeat(121) } },
    { ...copy, en: { ...copy.en, description: 'Rent this property for 99999 ETB monthly.' } },
    { ...copy, en: { ...copy.en, description: 'Rent this property for -25000 ETB monthly.' } },
    { ...copy, en: { ...copy.en, description: 'Contact owner at private@example.test today.' } }];
  for (const item of cases) assert.throws(() => validateListingCopy(item, facts), { code: 'AI_INVALID_RESPONSE' });
});

test('Gemini safely rejects provider errors, blocked or truncated output, oversized bodies and malformed JSON', async () => {
  const cases = [
    [() => response({ error: 'SECRET-SENTINEL' }, 401), 'AI_UNAVAILABLE'],
    [() => response({ error: 'SECRET-SENTINEL' }, 429), 'AI_RATE_LIMITED'],
    [() => response({ promptFeedback: { blockReason: 'SAFETY' } }), 'AI_INVALID_RESPONSE'],
    [() => response({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }), 'AI_INVALID_RESPONSE'],
    [() => new globalThis.Response('x'.repeat(66000)), 'AI_INVALID_RESPONSE'],
    [() => new globalThis.Response('{broken'), 'AI_INVALID_RESPONSE'],
    [() => { throw new Error('SECRET-SENTINEL'); }, 'AI_UNAVAILABLE'],
  ];
  for (const [fetcher, code] of cases) {
    const generator = createListingGenerator({ key: () => 'SECRET-SENTINEL', fetch: fetcher });
    await assert.rejects(generator.generate(facts), error => { assert.equal(error.code, code); assert.doesNotMatch(error.message, /SECRET-SENTINEL/); return true; });
  }
});

test('missing configuration and cancellation avoid provider requests; timeout is actionable', async () => {
  let calls = 0; const fetcher = async () => { calls++; return response(envelope(copy)); };
  await assert.rejects(createListingGenerator({ key: () => '', fetch: fetcher }).generate(facts), { code: 'AI_NOT_CONFIGURED' });
  await assert.rejects(createListingGenerator({ key: () => 'test', model: '../../leak', fetch: fetcher }).generate(facts), { code: 'AI_NOT_CONFIGURED' });
  await assert.rejects(createListingGenerator({ key: () => 'test', fetch: fetcher }).generate(facts, globalThis.AbortSignal.abort()), { code: 'AI_CANCELLED' });
  assert.equal(calls, 0);
  const timeoutGenerator = createListingGenerator({ key: () => 'test', timeoutMs: 1, fetch: async (_url, options) => {
    await new Promise(resolve => globalThis.setTimeout(resolve, 15)); options.signal.throwIfAborted();
    return response(envelope(copy));
  } });
  await assert.rejects(timeoutGenerator.generate(facts), { code: 'AI_TIMEOUT' });
});
