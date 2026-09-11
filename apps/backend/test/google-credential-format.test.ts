import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preflightGoogleTestCredential } from '../scripts/google-test-credential.js';
import { normalizeGoogleCredential, googleFormatReasons } from '../src/auth/google-verifier.js';
import { VerificationDiagnostics } from '../scripts/google-verification-diagnostics.js';

const cases = [
  ['', 'EMPTY_INPUT'], [' \r\n\t', 'EMPTY_INPUT'],
  ['"abc.def.ghi"', 'SURROUNDING_QUOTES'], ["'abc.def.ghi'", 'SURROUNDING_QUOTES'],
  ['\u201cabc.def.ghi\u201d', 'SURROUNDING_QUOTES'],
  ['abc.de f.ghi', 'EMBEDDED_WHITESPACE'], ['abc.de\rf.ghi', 'EMBEDDED_WHITESPACE'],
  ['abc.def', 'WRONG_SEGMENT_COUNT'], ['abc.def.ghi.jkl', 'WRONG_SEGMENT_COUNT'],
  ['abc..ghi', 'EMPTY_SEGMENT'], ['.def.ghi', 'EMPTY_SEGMENT'], ['abc.def.', 'EMPTY_SEGMENT'],
  ['abc.def.ghi=', 'INVALID_BASE64URL_CHARACTERS'], ['abc.def.gh+', 'INVALID_BASE64URL_CHARACTERS'],
  ['abc.def.gh/', 'INVALID_BASE64URL_CHARACTERS'], ['abc.def.ghi\u200b', 'INVALID_BASE64URL_CHARACTERS'],
  ['a'.repeat(12_000) + '.b.c', 'OTHER_FORMAT_ERROR'],
] as const;

test('credential format preflight classifies every rejection without exposing the input', () => {
  const seen = new Set<string>();
  for (const [input, reason] of cases) {
    const environment = { AKGEBEYA_GOOGLE_TEST_ID_TOKEN: input };
    const result = preflightGoogleTestCredential(environment);
    assert.deepEqual(result, { stage: 'private credential input', code: 'TOKEN_FORMAT_INVALID', reason });
    assert.ok(!Object.hasOwn(environment, 'AKGEBEYA_GOOGLE_TEST_ID_TOKEN'));
    const lines: string[] = [];
    const d = new VerificationDiagnostics(line => lines.push(line));
    d.enter('private credential input');
    assert.throws(() => normalizeGoogleCredential(input), error => { d.report(error); return true; });
    assert.deepEqual(JSON.parse(lines.at(-1)!), result);
    if (input.trim()) assert.ok(!lines.join('\n').includes(input));
    seen.add(reason);
  }
  assert.deepEqual([...seen].sort(), [...googleFormatReasons].sort());
  assert.equal(preflightGoogleTestCredential({}).reason, 'EMPTY_INPUT');
});

test('credential format preflight accepts base64url segments without decoding or repairing contents', () => {
  const raw = 'abc.DEF-123.ghi_456';
  assert.ok(normalizeGoogleCredential(' \t' + raw + '\r\n') === raw);
  const environment = { AKGEBEYA_GOOGLE_TEST_ID_TOKEN: ' \t' + raw + '\r\n' };
  assert.deepEqual(preflightGoogleTestCredential(environment),
    { stage: 'private credential input', code: 'FORMAT_ACCEPTABLE', reason: 'FORMAT_ACCEPTABLE' });
  assert.ok(!Object.hasOwn(environment, 'AKGEBEYA_GOOGLE_TEST_ID_TOKEN'));
});

test('CLI preflight exits locally with safe output and does not load config, contact Google or start backend', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const guard = 'import net from "node:net"; globalThis.fetch=()=>{throw new Error("NETWORK_FORBIDDEN")}; net.Server.prototype.listen=function(){throw new Error("SERVER_FORBIDDEN")};';
  for (const [input, expectedCode, reason] of [
    ['abc.DEF-123.ghi_456', 0, 'FORMAT_ACCEPTABLE'],
    ['"PRIVATE_CREDENTIAL_MATERIAL"', 1, 'SURROUNDING_QUOTES'],
    [undefined, 1, 'EMPTY_INPUT'],
  ] as const) {
    const env = { ...process.env, NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'invalid',
      DATABASE_URL: 'invalid', AUTH_JWT_SECRET: 'invalid', AKGEBEYA_GOOGLE_TEST_ID_TOKEN: input };
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(guard),
      '--import', 'tsx', 'apps/backend/scripts/verify-google.ts', '--credential-preflight-env'],
      { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 20_000 });
    assert.equal(result.status, expectedCode);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { stage: 'private credential input',
      code: expectedCode === 0 ? 'FORMAT_ACCEPTABLE' : 'TOKEN_FORMAT_INVALID', reason });
    assert.ok(!result.stdout.includes('PRIVATE_CREDENTIAL_MATERIAL'));
  }
});
