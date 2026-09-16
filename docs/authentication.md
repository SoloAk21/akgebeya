# Feature 4 — Session Authentication

## Tangible capability

A user creates an email/password account, signs in, refreshes and remains signed in,
and signs out. Sessions are verified against Neon on every session lookup. The UI
does not store passwords or session tokens in localStorage/sessionStorage.

This is the independently usable session-authentication milestone. Telegram initData
requires a configured bot and reliable Telegram testing and is not implemented here.
Email is a sign-in identifier; ownership is **not verified**. No verified-email claims,
password recovery, account linking, privileged roles, or legacy-account import is added.

## Schema and migration

The additive transaction creates `account`, `session`, and `auth_attempt` only in
`akgebeya_foundation`. Existing `public`, `akgebeya`, and `pgboss` schemas and history
remain outside this repository's ownership. Accounts are unique by normalized email;
sessions reference accounts with a cascading foreign key. Account/session creation is
atomic, and duplicate registration cannot leave a partial account or session.

```bash
npm ci
npm run db:migrate
npm run db:status
npm run dev
```

Use `AUTH_ORIGIN=http://127.0.0.1:3000` locally (the development default).
In production set NODE_ENV=production and an explicit HTTPS AUTH_ORIGIN. A missing
or non-HTTPS production origin fails startup. Never relax the origin check to `*`.
Cookies use HttpOnly, SameSite=Lax, Path=/, and a seven-day absolute lifetime. HTTPS
uses Secure and the `__Host-` prefix. HTTP cookies are intended only for local testing.

## Manual browser test

1. Open http://127.0.0.1:3000.
2. Click **Create an account instead**.
3. Email: `auth-manual@example.test`.
4. Password: `AkGebeya manual passphrase 2026!` (disposable sample only).
5. Click **Create account**. Expect “You’re signed in.” and the email address.
6. Refresh. Expect the same authenticated account, with no password re-entry.
7. Click **Sign out**. Expect “You’ve signed out.” Refresh; expect the sign-in form.
8. Click **Sign in instead** if the form still shows Create account. Enter the same
   email and password, submit, and expect success.
9. Sign out, enter the same email with `Incorrect sample passphrase!`, and submit.
   Expect “Email or password is incorrect.” The password field is cleared.
10. At 390-pixel mobile width, repeat sign-in, refresh, and sign-out. Expect readable
    controls and no horizontal overflow. Keyboard Tab must reach each form control.

If that disposable email already exists, test the duplicate-registration message and
use sign-in with its sample password; choose a new disposable address if needed.

## Exact Git Bash API tests

The API must be running. A temporary cookie jar holds only this test session.
Use a new disposable email for each full run if the sample already exists.

```bash
COOKIE_JAR="$(mktemp)"
curl -i -c "$COOKIE_JAR" -H 'Origin: http://127.0.0.1:3000' \
  -H 'Content-Type: application/json' \
  --data '{"email":"auth-curl@example.test","password":"AkGebeya curl passphrase 2026!"}' \
  http://127.0.0.1:3001/api/auth/register
```

Expected: HTTP 201; `user.id`, `user.email`; a session Set-Cookie with HttpOnly,
SameSite=Lax, Path=/, Max-Age=604800. No password/hash/token appears in JSON.

```bash
curl -i -b "$COOKIE_JAR" http://127.0.0.1:3001/api/auth/session
curl -i http://127.0.0.1:3001/api/auth/session
```

Expected: first HTTP 200 with the same user; second HTTP 401 with
`error: "UNAUTHENTICATED"`. Responses have Cache-Control: no-store.

```bash
curl -i -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"email":"auth-curl@example.test","password":"AkGebeya curl passphrase 2026!"}' \
  http://127.0.0.1:3001/api/auth/register
```

Expected duplicate: HTTP 409, `error: "REGISTRATION_UNAVAILABLE"`; one account remains
and no duplicate session is created by the failed request.

```bash
curl -i -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"email":"auth-curl@example.test","password":"Incorrect sample passphrase!"}' \
  http://127.0.0.1:3001/api/auth/login
curl -i -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"email":"bad-email","password":"short"}' \
  http://127.0.0.1:3001/api/auth/register
curl -i -H 'Origin: https://attacker.example' -H 'Content-Type: application/json' \
  --data '{}' http://127.0.0.1:3001/api/auth/logout
```

Expected: HTTP 401 `INVALID_CREDENTIALS`; HTTP 400 `INVALID_EMAIL`; HTTP 403
`ORIGIN_REJECTED`. Missing Origin is also 403. Both unknown accounts and incorrect
passwords use the same sign-in response.

```bash
curl -i -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  --data '{"email":"auth-curl@example.test","password":"AkGebeya curl passphrase 2026!"}' \
  http://127.0.0.1:3001/api/auth/login
curl -i -b "$COOKIE_JAR" -c "$COOKIE_JAR" -H 'Origin: http://127.0.0.1:3000' \
  -H 'Content-Type: application/json' --data '{}' \
  http://127.0.0.1:3001/api/auth/logout
curl -i -b "$COOKIE_JAR" http://127.0.0.1:3001/api/auth/session
```

Expected: login 200 and a freshly generated cookie; logout 200 with
`status: "signed_out"` and cleared cookie; final lookup 401. Reusing the old cookie
also returns 401 because logout deletes its database session. Repeated logout is 200.

## Boundaries and security verification

- Passwords: 15–128 UTF-16 code units, maximum 512 UTF-8 bytes; never trimmed/truncated.
- JSON: 4096-byte limit (413); malformed JSON/extra fields (400); non-JSON (415);
  unsupported endpoint methods (405 with Allow).
- Atomic PostgreSQL attempt counters: 10 attempts per normalized email and 30 per
  socket IP per 15-minute window; excess returns 429 and Retry-After: 900. These
  counters survive restarts. Forwarded client-IP headers are not trusted. Behind a
  proxy, users share the proxy's IP limit; trusted-proxy configuration is future
  deployment work, not an invitation to trust arbitrary X-Forwarded-For headers.
- At most two simultaneous scrypt operations per API process to bound memory usage.
- CSRF: exact configured Origin on every state-changing endpoint, plus SameSite
  cookies. No permissive CORS. Session lookup is bound only to the opaque cookie;
  callers cannot select another account by a URL parameter or body field.
- Sessions: random 256-bit tokens; SHA-256 hashes only in the database; rotated at
  sign-in, expired server-side after seven days, and revoked on logout. No JWT or
  client-provided user identity is accepted.
- Passwords: salted scrypt (N=131072, r=8, p=1), constant-time hash comparison, and
  equivalent password derivation for unknown accounts. Registration conflict status
  reveals email availability; sign-in errors do not distinguish unknown accounts.
- Database failures return a generic 503; no SQL, credentials, password hashes, or
  session tokens are logged or returned in JSON. UI renders account data as text.

```bash
npm run verify
npm run test:database
npm run test:auth
```

The authentication integration test creates a unique disposable `@example.test`
account, runs the real HTTP/Prisma/Neon chain, checks stored hashes and relationships,
duplicate atomicity, persisted sessions after server restart, rotation, expiry,
revocation, production cookie flags, CSRF, malformed/oversized input, and rate limits.
It removes only its own account (cascading its sessions) and identified test counters.
Manual demo accounts are retained for read-back. Production deployment, email delivery,
Telegram, and password recovery are not claimed by this milestone.

References: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Verification record — 2026-09-16

- Additive authentication migration applied successfully in `akgebeya_foundation`.
- Typecheck, lint, all 10 regression tests, and production build passed.
- `test:auth` passed against real Neon: registration, duplicate atomicity, invalid
  input, wrong-password rejection, session persistence after HTTP server restart,
  rotation, expiry, logout and replay rejection, secure-cookie flags, origin checks,
  body limits, and persistent rate limiting.
- Existing PostGIS/persistence/constraint/rollback regression (`test:database`) passed.
- Browser: created `auth-manual@example.test`, refreshed with its session intact,
  signed out, refreshed signed out, rejected an incorrect password, signed in again,
  and repeated refresh/sign-out at a 390 × 844 mobile viewport.
- Mobile document/client widths matched at 375 px, with no horizontal overflow.
  Keyboard Tab moved from the email control to the password control.
- Read-back confirmed the manual account exists and its stored password is a scrypt
  hash. Live integration checks confirmed session-token hashes and the account foreign
  key. Test-generated accounts were removed; the disposable manual account is retained.
- Security review covered request validation, cookie/session handling, CSRF, lack of
  permissive CORS, parameterized database operations, hash storage, expiration,
  revocation, rate limits, transaction boundaries, and text-only account rendering.
- A frontend TypeScript global-name conflict was fixed by making the account script
  an explicit module; typecheck and the complete suite passed after that fix.
