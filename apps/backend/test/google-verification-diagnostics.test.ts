import { GoogleVerifier, GoogleVerificationFailure, googleFailureCategories, type GoogleFailureCategory } from '../src/auth/google-verifier.js';
import { googleFixture } from './google-fixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VerificationDiagnostics } from '../scripts/google-verification-diagnostics.js';

test('Google tooling diagnostics suppress arbitrary error, identity, token and database details', () => {
  const lines: string[] = [];
  const d = new VerificationDiagnostics(line => lines.push(line));
  const privateMarker = 'PRIVATE_MARKER_MUST_NOT_APPEAR';
  d.enter('Google signature/claims verification');
  d.report(Object.assign(new Error(privateMarker), { code: privateMarker, cause: { token: privateMarker } }));
  d.report(Object.assign(new Error(privateMarker), { code: 'UNAUTHORIZED', payload: { email: privateMarker } }));
  d.enter('POST /api/v1/auth/google');
  assert.throws(() => d.expectHttp({ status: 409, body: { error: { code: 'ACCOUNT_LINKING_CONFLICT', message: privateMarker } } }, 200),
    error => { d.report(error); return true; });
  assert.throws(() => d.expectHttp({ status: 500, body: { error: { code: privateMarker }, token: privateMarker } }, 200),
    error => { d.report(error); return true; });
  assert.ok(!lines.join('\n').includes(privateMarker));
  const reports = lines.map(line => JSON.parse(line) as Record<string, unknown>);
  assert.ok(reports.every(r => Object.keys(r).every(k => ['stage', 'httpStatus', 'code', 'reason'].includes(k))));
  assert.ok(reports.some(r => r.code === 'ACCOUNT_LINKING_CONFLICT' && r.httpStatus === 409));
  assert.ok(reports.some(r => r.code === 'HTTP_UNEXPECTED' && r.httpStatus === 500));
});
test('Google tooling preserves primary stage and HTTP status when cleanup fails', () => {
  const lines: string[] = [];
  const d = new VerificationDiagnostics(line => lines.push(line));
  d.enter('POST /api/v1/auth/google'); d.http(401);
  const primary = d.capture({ code: 'UNAUTHORIZED' });
  d.enter('cleanup'); d.report({ code: 'P1001', message: 'withheld' });
  d.report(primary);
  const final = JSON.parse(lines.at(-1)!) as Record<string, unknown>;
  assert.equal(final.stage, 'POST /api/v1/auth/google');
  assert.equal(final.httpStatus, 401); assert.equal(final.code, 'UNAUTHORIZED');
  d.enter('Google signature/claims verification'); d.mark('JWKS_LOOKUP_FAILED');
  d.report({ code: 'UNAUTHORIZED', cause: 'withheld' });
  assert.equal(JSON.parse(lines.at(-1)!).code, 'JWKS_LOOKUP_FAILED');
});

test('Google private diagnostics distinguish every category without revealing claim values or credentials', async () => {
  const f = await googleFixture();
  const marker = 'PRIVATE_VALUE_NOT_FOR_OUTPUT';
  const valid = await f.sign();
  const parts = valid.split('.');
  const signature = parts[2]!;
  const tampered = parts[0] + '.' + parts[1] + '.' + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  const now = Math.floor(Date.now() / 1000);
  const cases: [string, GoogleFailureCategory][] = [
    ['invalid', 'TOKEN_FORMAT_INVALID'],
    [tampered, 'SIGNATURE_INVALID'],
    [await f.sign({ iss: marker }), 'ISSUER_INVALID'],
    [await f.sign({ aud: marker }), 'AUDIENCE_INVALID'],
    [await f.sign({ azp: marker }), 'AUDIENCE_INVALID'],
    [await f.sign({ aud: [f.clientId] }), 'AUDIENCE_INVALID'],
    [await f.sign({ exp: now - 1 }), 'TOKEN_EXPIRED'],
    [await f.sign({ iat: now + 120 }), 'TOKEN_NOT_YET_VALID'],
    [await f.sign({ nbf: now + 120 }), 'TOKEN_NOT_YET_VALID'],
    [await f.sign({ email: undefined }), 'EMAIL_MISSING'],
    [await f.sign({ email: '  ' }), 'EMAIL_MISSING'],
    [await f.sign({ email_verified: false }), 'EMAIL_NOT_VERIFIED'],
    [await f.sign({ email_verified: 'true' }), 'EMAIL_NOT_VERIFIED'],
    [await f.sign({ email_verified: undefined }), 'EMAIL_NOT_VERIFIED'],
    [await f.sign({ sub: undefined }), 'SUBJECT_MISSING'],
    [await f.sign({ sub: '  ' }), 'SUBJECT_MISSING'],
    [await f.sign({ email: marker }), 'CLAIMS_INVALID'],
    [await f.sign({ exp: undefined }), 'CLAIMS_INVALID'],
    [await f.sign({ iat: now - 0.5 }), 'CLAIMS_INVALID'],
  ];
  const observed = new Set<GoogleFailureCategory>();
  async function check(verifier: GoogleVerifier, token: string, expected: GoogleFailureCategory) {
    const lines: string[] = [];
    const diagnostics = new VerificationDiagnostics(line => lines.push(line));
    diagnostics.enter('Google signature/claims verification');
    await assert.rejects(verifier.verify(token), error => {
      assert.ok(error instanceof GoogleVerificationFailure);
      assert.equal(error.code, 'UNAUTHORIZED'); assert.equal(error.status, 401);
      assert.equal(error.category, expected);
      assert.ok(!('cause' in error) && !('payload' in error));
      diagnostics.report(error);
      observed.add(error.category);
      return true;
    });
    const output = lines.join('\n');
    for (const privateValue of [marker, token, f.email, f.sub, f.clientId]) assert.ok(!output.includes(privateValue));
    const result = JSON.parse(lines.at(-1)!);
    assert.deepEqual(result, { stage: 'Google signature/claims verification', code: expected, reason: expected === 'TOKEN_FORMAT_INVALID' ? 'WRONG_SEGMENT_COUNT' : expected });
  }
  for (const [token, expected] of cases) await check(f.verifier, token, expected);
  await check(new GoogleVerifier({ clientId: f.clientId }, async () => {
    throw Object.assign(new Error(marker), { payload: { sub: marker, email: marker }, headers: { Authorization: marker } });
  }), valid, 'JWKS_LOOKUP_FAILED');
  await check(new GoogleVerifier({ clientId: f.clientId }, f.keys, () => { throw new Error(marker); }),
    valid, 'UNKNOWN_VERIFICATION_FAILURE');
  assert.deepEqual([...observed].sort(), [...googleFailureCategories].sort());
});
