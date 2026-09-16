# Feature 5 — User profile

Signed-in users can read and update their own display name. Email remains read-only.
Existing accounts start with an empty display name and retain their sessions.
Names are trimmed, accept local scripts, and must contain 1–80 UTF-16 code units;
control and formatting characters are rejected. Avatars, phone numbers, public
profiles, and account credential changes are outside this milestone.

## Database and API

The additive migration `20260916000300_user_profile` adds nullable `displayName`
to `akgebeya_foundation.account`, with a database length/nonblank constraint.
It does not modify legacy schemas. Deploy the migration before starting the updated
API: `npm run db:migrate`, `npm run db:generate`, then `npm run build`.

- `GET /api/profile`: returns `{ "profile": { "id", "email", "displayName" } }`.
- `PUT /api/profile`: accepts only `{ "displayName": "Selam Tesfaye" }`.
- Both require a current session; missing, expired, or revoked sessions return 401.
- Writes require the exact configured Origin and JSON content type. Foreign/missing
  Origin returns 403; invalid input 400; oversized bodies 413; wrong media type 415.
- Unsupported methods return 405. Profiles cannot be selected by an ID in the URL.
- Responses use `no-store`. Database failures return a generic 503 without details.

Account IDs come exclusively from the authenticated session. Strict input validation
rejects injected IDs, email, password, and role fields. The API selects only public
profile fields; the browser assigns names to an input value, never HTML. Repeated
identical saves update one account and do not create duplicate records. Concurrent
valid edits use last-write-wins semantics.

## Automated verification

```bash
npm run verify
npm run test:profile
npm run test:auth
npm run test:database
npm run db:status
```

The profile integration test runs real HTTP requests and Neon reads/writes with two
disposable accounts. It verifies account isolation, session expiry/revocation,
strict validation, rejected credential/role changes, CSRF protection, safe output,
idempotent saves, and persistence after both server and database-client restart.
Its cleanup removes only its own fixture accounts and cascading sessions.

## Exact browser check

1. Open `http://127.0.0.1:3000/` with the API and web server running.
2. Sign in as the disposable sample account `auth-manual@example.test` with password
   `AkGebeya manual passphrase 2026!` (create it first if this is a fresh database).
3. Enter `Selam Tesfaye` in **Display name** and click **Save profile**.
4. Expect **Profile saved.** Refresh; expect `Selam Tesfaye` in the field.
5. Enter three spaces and save. Expect a validation error. Refresh and expect the
   previous saved name, unchanged.
6. Sign out and sign back in; expect the same saved display name.
7. Repeat at a 390-pixel mobile viewport; expect readable controls without horizontal
   overflow. Restore the normal viewport afterward.
8. If a profile request fails, expect **Reload profile**. Retry after the API recovers.

## Exact Git Bash API check

Use the local disposable account above. These commands keep the cookie in a shell
variable rather than a repository file. Do not print or share its value.

```bash
BASE=http://127.0.0.1:3000
COOKIE=$(curl -sS -D - -o /dev/null "$BASE/api/auth/login" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"email":"auth-manual@example.test","password":"AkGebeya manual passphrase 2026!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' | tr -d '\r')
curl -i "$BASE/api/profile" -H "Cookie: $COOKIE"
curl -i -X PUT "$BASE/api/profile" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"displayName":"Selam Tesfaye"}'
# Expect 200 and the saved name on both write and fresh read.
curl -i "$BASE/api/profile" -H "Cookie: $COOKIE"
# Expect 400, no profile change.
curl -i -X PUT "$BASE/api/profile" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"displayName":"Wrong","id":"another-account"}'
# Expect 403.
curl -i -X PUT "$BASE/api/profile" -H "Cookie: $COOKIE" \
  -H 'Origin: https://attacker.example' -H 'Content-Type: application/json' \
  --data '{"displayName":"Wrong"}'
# Expect 401 without a session.
curl -i "$BASE/api/profile"
curl -i "$BASE/api/auth/logout" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{}'
unset COOKIE
```

## Verification record — 2026-09-16

- Typecheck, lint, all 11 local tests, and production builds passed.
- Profile, authentication, and PostgreSQL/PostGIS integration suites each passed
  against Neon; no tests were skipped. All three migrations are applied.
- Browser: saved `Selam Tesfaye`, refreshed, rejected a whitespace-only edit,
  reloaded the unchanged name, signed out, and signed back in successfully.
- Profile loading failure exposed a working retry control while the API was being
  updated. After restart, retry loaded the profile successfully.
- Mobile: a 390×844 viewport override produced a 375-pixel content viewport;
  content and scroll widths matched, and form controls remained readable/usable.
- An independent HTTP login/read/logout and a direct database read both confirmed
  `Selam Tesfaye` on the disposable manual account.
- Security review found no account selector accepted from input, credential fields
  in profile output, HTML interpolation of names, or secrets in intended changes.
