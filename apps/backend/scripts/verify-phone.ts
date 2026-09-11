import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withPhoneVerification } from './phone-verification-fixture.js';

async function command(executable: string, args: string[], input?: string) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', value => { output += String(value); });
    child.stderr.on('data', () => {}); // No diagnostic payload or credential logging.
    child.once('error', () => reject(new Error('Verification process failed')));
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Verification timed out')); }, 180_000);
    child.once('close', code => { clearTimeout(timeout); resolve({ code, output }); });
    child.stdin.end(input);
  });
}
async function verifyCurl() {
  await withPhoneVerification(async f => {
    async function curl(path: string, expected: number, body?: unknown, token?: string) {
      const args = ['--silent', '--show-error', '--max-time', '20', '--write-out', '\n%{http_code}'];
      let input: string | undefined;
      if (body !== undefined) {
        args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
        input = JSON.stringify(body);
      } else if (token) {
        args.push('--header', '@-');
        input = 'Authorization: Bearer ' + token + '\n';
        if (path === 'logout') args.push('--request', 'POST');
      }
      args.push(f.base + '/' + path);
      const result = await command(process.platform === 'win32' ? 'curl.exe' : 'curl', args, input);
      assert.equal(result.code, 0);
      const split = result.output.lastIndexOf('\n');
      assert.equal(Number(result.output.slice(split + 1)), expected);
      const parsed = JSON.parse(result.output.slice(0, split)) as Record<string, string>;
      console.log('curl ' + path + ': HTTP ' + expected + ' passed');
      return parsed;
    }
    await curl('phone/request-otp', 400, { phone: 'invalid' });
    const request = async () => {
      const response = await curl('phone/request-otp', 200, { phone: f.phone });
      assert.deepEqual(Object.keys(response).sort(), ['challengeId', 'expiresAt', 'resendAvailableAt']);
      assert.ok(response.challengeId);
      const delivery = f.delivery(response.challengeId);
      return { phone: f.phone, challengeId: response.challengeId, otp: delivery.otp };
    };
    let input = await request();
    await curl('phone/request-otp', 429, { phone: f.phone });
    const wrong = (otp: string) => String((Number(otp[0]) + 1) % 10) + otp.slice(1);
    await curl('phone/verify-otp', 401, { ...input, otp: wrong(input.otp) });
    const session = await curl('phone/verify-otp', 200, input);
    assert.ok(session.token && session.expiresAt);
    await f.checkSession(session.token, session.expiresAt);
    const me = await curl('me', 200, undefined, session.token);
    assert.equal((me.user as unknown as { phone: string }).phone, f.phone);
    await curl('phone/verify-otp', 401, input);
    await curl('logout', 200, undefined, session.token);
    await f.checkRevoked(session.token);
    await curl('me', 401, undefined, session.token);
    await curl('me', 401);
    await f.allowResend(); input = await request();
    const again = await curl('phone/verify-otp', 200, input);
    assert.ok(again.token && again.expiresAt && again.token !== session.token);
    await f.checkSession(again.token, again.expiresAt);
    await f.allowResend(); input = await request(); await f.expire();
    await curl('phone/verify-otp', 401, input);
    await f.allowResend(); input = await request();
    for (let i = 0; i < 5; i++) await curl('phone/verify-otp', 401, { ...input, otp: wrong(input.otp) });
    await curl('phone/verify-otp', 401, input);
    await f.checkExhausted();
    console.log('curl and Neon checks passed: normalized phone, OTP/session hashes, expiry, consumption, revocation and repeat identity.');
  });
}
async function writeCollection(path: string, values: Record<string, string>) {
  const collection = JSON.parse(await readFile(new URL('../../../docs/postman/phone-otp.postman_collection.json', import.meta.url), 'utf8')) as {
    variable: { key: string; value: string }[];
  };
  for (const variable of collection.variable) variable.value = values[variable.key] ?? '';
  await writeFile(path, JSON.stringify(collection), { flag: 'wx' });
}
async function serveManual() {
  await withPhoneVerification(async f => {
    const path = fileURLToPath(new URL('../../../.git/phone-otp-active.postman.json', import.meta.url));
    await writeCollection(path, { baseUrl: f.base, fixtureUrl: f.fixtureUrl, fixtureKey: f.fixtureKey, phone: f.phone });
    try {
      console.log('Local phone verification is ready. Import .git/phone-otp-active.postman.json into Postman Local View.');
      console.log('Use the curl commands in docs/PHONE_OTP.md. Press Ctrl+C to clean up temporary records and stop.');
      await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
    } finally { await unlink(path); }
  });
}

async function verifyPostman() {
  await withPhoneVerification(async f => {

    // The temporary collection contains fixture connection details, never an OTP or JWT.
    const path = fileURLToPath(new URL('../../../.git/phone-otp-' + randomUUID() + '.postman.json', import.meta.url));
    try {
      await writeCollection(path, { baseUrl: f.base, fixtureUrl: f.fixtureUrl, fixtureKey: f.fixtureKey, phone: f.phone });
      const result = await command(process.execPath, [
        fileURLToPath(new URL('../../../node_modules/postman-cli/bin/postman.js', import.meta.url)),
        'collection', 'run', path, '--no-report-events', '--disable-unicode',
      ]);
      assert.ok(result.code === 0, 'Postman collection failed');
      assert.ok(/21/.test(result.output), 'Expected collection request count');
      console.log('Postman CLI: all 21 local requests and collection assertions passed, including Neon state assertions.');
    } finally { await unlink(path).catch(() => {}); }
  });
}
async function main() {
  if (process.argv.includes('--serve')) { await serveManual(); return; }
  if (!process.argv.includes('--postman-only')) await verifyCurl();
  if (!process.argv.includes('--curl-only')) await verifyPostman();
}
main().catch(() => { console.error('Phone verification failed; OTPs, tokens and secrets were not logged.'); process.exitCode = 1; });
