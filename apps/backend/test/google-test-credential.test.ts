import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readGoogleTestCredential } from '../scripts/google-test-credential.js';
import { VerificationDiagnostics } from '../scripts/google-verification-diagnostics.js';
import { googleFixture } from './google-fixture.js';

test('manual env input accepts signed tokens and boundary whitespace, consuming the environment entry', async () => {
  const f = await googleFixture();
  const token = await f.sign();
  for (const input of [token, ' \t' + token + '\r\n ']) {
    const environment = { AKGEBEYA_GOOGLE_TEST_ID_TOKEN: input };
    const normalized = readGoogleTestCredential(environment, 'development');
    assert.ok(normalized === token, 'Token characters must remain unchanged');
    assert.ok(!Object.hasOwn(environment, 'AKGEBEYA_GOOGLE_TEST_ID_TOKEN'));
    await f.verifier.verify(normalized);
  }
});
test('manual env input rejects quotes, embedded whitespace, missing values and malformed segments privately', async () => {
  const f = await googleFixture();
  const token = await f.sign();
  for (const input of [undefined, '', '"' + token + '"', "'" + token + "'",
    token.slice(0, 5) + ' ' + token.slice(5), token.slice(0, 5) + '\r\n' + token.slice(5),
    token.split('.').slice(0, 2).join('.'), token + '.extra', 'PRIVATE_INVALID_INPUT']) {
    const environment: NodeJS.ProcessEnv = { AKGEBEYA_GOOGLE_TEST_ID_TOKEN: input };
    const lines: string[] = [];
    const d = new VerificationDiagnostics(line => lines.push(line));
    d.enter('private credential input');
    assert.throws(() => readGoogleTestCredential(environment, 'test'), error => {
      d.report(error);
      return typeof error === 'object' && error !== null && 'category' in error && error.category === 'TOKEN_FORMAT_INVALID';
    });
    assert.ok(!Object.hasOwn(environment, 'AKGEBEYA_GOOGLE_TEST_ID_TOKEN'));
    const output = lines.join('\n');
    for (const secret of [token, f.sub, f.email, f.clientId, 'PRIVATE_INVALID_INPUT']) assert.ok(!output.includes(secret));
    const report = JSON.parse(lines.at(-1)!);
    assert.equal(report.stage, 'private credential input');
    assert.equal(report.code, 'TOKEN_FORMAT_INVALID');
    assert.ok(['EMPTY_INPUT', 'SURROUNDING_QUOTES', 'EMBEDDED_WHITESPACE', 'WRONG_SEGMENT_COUNT'].includes(report.reason));
  }
});
test('manual env input is forbidden in production and still removes the credential entry', () => {
  const environment = { AKGEBEYA_GOOGLE_TEST_ID_TOKEN: 'private-test-value' };
  assert.throws(() => readGoogleTestCredential(environment, 'production'), { code: 'SERVICE_UNAVAILABLE' });
  assert.ok(!Object.hasOwn(environment, 'AKGEBEYA_GOOGLE_TEST_ID_TOKEN'));
});
