# Phone OTP authentication — Step 4.3

Phone login uses `POST /api/v1/auth/phone/request-otp` and
`POST /api/v1/auth/phone/verify-otp`. User lookup/creation happens only after
successful verification. Sessions use the existing AuthService and JWT implementation.

## Production and development behavior

No SMS provider was configured in the existing backend. This step adds no real SMS
integration. The default `PHONE_OTP_TRANSPORT=disabled` makes valid phone requests
and verifications return **503** with
`{"error":{"code":"SERVICE_UNAVAILABLE","message":"Service unavailable"}}`.
It does not pretend a message was delivered or create an OTP/user/session.

The private `test-ipc` transport requires development/test mode and a parent IPC
channel; startup rejects it in production. It sends generated OTPs only to the
verification harness's memory. No application endpoint returns an OTP, even in
development. No OTP is printed, written to a fixture file, or stored in the database.

The manual harness creates a separate loopback-only fixture server authenticated
by a random fixture key. That server can retrieve a test delivery and adjust the
expiry/cooldown of its one temporary phone challenge. It is script-only tooling,
not part of the backend routes or production build. It rejects browser Origin
headers and other phone numbers. Use only the configured Neon development branch.

## Configuration

All settings are parsed centrally:

| Setting | Default / allowed values |
| --- | --- |
| PHONE_OTP_TRANSPORT | disabled; test-ipc for private development fixtures |
| PHONE_OTP_HASH_SECRET | Required for test-ipc: canonical base64url, at least 32 random bytes; separate from JWT secret |
| PHONE_OTP_TTL_SECONDS | 300; 30–600 |
| PHONE_OTP_COOLDOWN_SECONDS | 60; 10–300 and no greater than TTL |
| PHONE_OTP_MAX_ATTEMPTS | 5; 1–10 |

The verification harness generates temporary keys in memory and preserves local
.env settings. Never commit real keys or place OTPs/JWTs in shell arguments or logs.
Changing the hash secret invalidates outstanding challenges.

## Normalization and challenge lifecycle

Accepted inputs are `09XXXXXXXX`, `07XXXXXXXX`, `+2519XXXXXXXX`, and
`+2517XXXXXXXX`, with optional surrounding whitespace. Storage always uses
`+251[79]` followed by eight digits. Other country codes, fixed-line numbers,
internal separators, extensions and ambiguous bare numbers are rejected.

The new PhoneOtp table has ten columns: UUID id, unique normalized phone, otpHash,
expiresAt, resendAvailableAt, attemptCount, nullable consumedAt/revokedAt, and
createdAt/updatedAt. Four indexes support primary-key and phone uniqueness, expiry
cleanup and active-challenge scans. Seven CHECK constraints enforce normalized
phone, hash format, nonnegative attempts and valid timestamp relationships.

One row represents the current challenge for a phone. Resend replaces it with a
new UUID and fresh random six-digit code after the cooldown. The HMAC-SHA-256 hash
binds a separate secret key, version label, UUID, normalized phone and code. The
secret protects short codes against offline guessing from a database-only leak.
Verification compares fixed-length hashes in constant time.

Request and verification operations take a transaction-scoped PostgreSQL advisory
lock for the normalized phone, including when no row exists. Concurrent requests
cannot bypass cooldown; failed attempts commit under the same lock. Reaching the
attempt limit sets revokedAt. Incorrect, expired, consumed, revoked, exhausted or
replaced challenges return the same safe 401. A resend begins a new challenge and
attempt budget; this is not a global/IP rate limiter.

Consumption, verified user lookup/creation and AuthService session insertion use
one transaction. A session/database failure rolls back consumption; a successful
commit consumes the OTP exactly once. Inactive users cannot receive sessions.
Existing user profiles/roles are preserved. Client IDs, roles and extra fields
are rejected. No account-linking behavior is added.

The migration `20260911010000_phone_otp` creates only this table, its constraints
and indexes in akgebeya. All previous models and applied migrations are unchanged.
Before/after snapshots verified identical data in all 22 pre-existing tables.
Prisma migrate diff found no difference; live tests independently check SQL constraints.

## Repeatable verification

From the repository root:

```powershell
npm run prisma:validate --workspace apps/backend
npm run prisma:generate --workspace apps/backend
npm run typecheck --workspace apps/backend
npm test --workspace apps/backend
npm run test:database --workspace apps/backend
npm run build --workspace apps/backend
node --import tsx apps/backend/scripts/verify-phone.ts
```

The last command executes actual curl requests and then the importable Postman
collection through the official Postman CLI. Each uses an isolated compiled
backend and temporary Neon records. It checks hashes, timestamps, consumed and
revoked states, repeat identity and cleanup. Postman runs locally with
`--no-report-events`, no login, no cloud-linked collection and no body-report exports.
The npm-installed CLI is a development dependency; no dependency version was
manually selected.

Use `--curl-only` or `--postman-only` to select a runner. These are local
collection runs, not a claim that the Postman desktop UI was driven automatically.

## Interactive curl manual testing

In terminal 1, start the private fixture:

```powershell
node --import tsx apps/backend/scripts/verify-phone.ts --serve
```

In terminal 2, load its connection settings without printing them. The temporary
collection contains no OTP or JWT:

```powershell
$fixture = Get-Content .git/phone-otp-active.postman.json -Raw | ConvertFrom-Json
$v = @{}
$fixture.variable | ForEach-Object { $v[$_.key] = $_.value }
$base = $v.baseUrl
$phone = $v.phone

function Invoke-PhonePost($path, $body) {
  $json = $body | ConvertTo-Json -Compress
  $lines = @($json | curl.exe --silent --show-error --request POST --header 'Content-Type: application/json' --data-binary '@-' --write-out '\n%{http_code}' "$base/$path")
  if ($LASTEXITCODE -ne 0) { throw 'curl failed' }
  [pscustomobject]@{ Status = [int]$lines[-1]; Body = ($lines[0] | ConvertFrom-Json) }
}
function Invoke-PhoneFixture($action, $extra = @{}) {
  $body = @{ phone = $phone } + $extra
  Invoke-RestMethod -Method POST -Uri "$($v.fixtureUrl)/$action" -Headers @{ Authorization = "Bearer $($v.fixtureKey)" } -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress)
}

# Request OTP: 200, challengeId + expiresAt + resendAvailableAt; no OTP.
$r = Invoke-PhonePost 'phone/request-otp' @{ phone = $phone }
$r.Status
$challenge = $r.Body.challengeId
$otp = (Invoke-PhoneFixture 'delivery' @{ challengeId = $challenge }).otp

# Invalid phone: 400.
$r = Invoke-PhonePost 'phone/request-otp' @{ phone = 'invalid' }
$r.Status

# Wrong OTP: 401; attemptCount increases.
$wrong = [string](([int]::Parse($otp.Substring(0, 1)) + 1) % 10) + $otp.Substring(1)
$r = Invoke-PhonePost 'phone/verify-otp' @{ phone = $phone; challengeId = $challenge; otp = $wrong }
$r.Status

# Correct OTP: 200, token + expiresAt. Keep the response private.
$r = Invoke-PhonePost 'phone/verify-otp' @{ phone = $phone; challengeId = $challenge; otp = $otp }
$r.Status
$session = $r.Body

# Reused OTP: 401.
$r = Invoke-PhonePost 'phone/verify-otp' @{ phone = $phone; challengeId = $challenge; otp = $otp }
$r.Status

# Current user: 200. Logout: 200. Current user after logout: 401.
"Authorization: Bearer $($session.token)" | curl.exe --silent --show-error --include --header '@-' "$base/me"
"Authorization: Bearer $($session.token)" | curl.exe --silent --show-error --include --request POST --header '@-' "$base/logout"
"Authorization: Bearer $($session.token)" | curl.exe --silent --show-error --include --header '@-' "$base/me"

# Expired OTP: create a fresh challenge, then expire only this fixture's row.
$null = Invoke-PhoneFixture 'allow-resend'
$r = Invoke-PhonePost 'phone/request-otp' @{ phone = $phone }
$challenge = $r.Body.challengeId
$otp = (Invoke-PhoneFixture 'delivery' @{ challengeId = $challenge }).otp
$null = Invoke-PhoneFixture 'expire'
$r = Invoke-PhonePost 'phone/verify-otp' @{ phone = $phone; challengeId = $challenge; otp = $otp }
$r.Status
```

Press Ctrl+C in terminal 1 to stop both local servers and remove its PhoneOtp,
User and cascading Session records. Remove the terminal variables afterward.
Do not print OTP/session variables, save response bodies, or sync fixture data.

## Postman manual testing

Start a **fresh** interactive fixture and import
`.git/phone-otp-active.postman.json` into Postman Local View. Run the collection in
order. Its scripts retrieve OTPs only from the private fixture and assert expected
HTTP responses and actual Neon state. Do not sync it to a cloud workspace or export
its populated runtime variables. Stop the harness with Ctrl+C when finished.

The same collection can be manually run from terminal 2:

```powershell
node node_modules/postman-cli/bin/postman.js collection run .git/phone-otp-active.postman.json --no-report-events --silent
if ($LASTEXITCODE -ne 0) { throw 'Postman collection failed' }
```

The imported baseUrl is the exact local address chosen by the harness. For a server
configured on port 3000, the endpoints are:

| Method | Exact URL | Headers | JSON body | Expected status / JSON |
| --- | --- | --- | --- | --- |
| POST | http://127.0.0.1:3000/api/v1/auth/phone/request-otp | Content-Type: application/json | {"phone":"{{phone}}"} | 200: {"challengeId":"<UUID>","expiresAt":"<UTC ISO timestamp>","resendAvailableAt":"<UTC ISO timestamp>"} |
| POST | http://127.0.0.1:3000/api/v1/auth/phone/verify-otp | Content-Type: application/json | {"phone":"{{phone}}","challengeId":"{{challengeId}}","otp":"{{otpValue}}"} | 200: {"token":"<JWT>","expiresAt":"<UTC ISO timestamp>"} |
| GET | http://127.0.0.1:3000/api/v1/auth/me | Authorization: Bearer {{token}} | None | 200: {"user":{"id":"<UUID>","email":null,"phone":"<normalized phone>","displayName":"AkGebeya user","role":"USER","preferredLocale":"en"}} |
| POST | http://127.0.0.1:3000/api/v1/auth/logout | Authorization: Bearer {{token}} | None | 200: {"status":"ok"} |

All auth responses use Cache-Control: no-store. Request/verify bodies are strict;
extra IDs/roles and query fields return 400.

| Scenario | Expected status and exact JSON |
| --- | --- |
| Invalid phone, missing fields, malformed code/challenge ID | 400: {"error":{"code":"BAD_REQUEST","message":"Invalid request"}} |
| Incorrect, expired, consumed/reused, revoked, exhausted or replaced OTP | 401: {"error":{"code":"UNAUTHORIZED","message":"Authentication required"}} |
| Missing/revoked bearer session | 401: {"error":{"code":"UNAUTHORIZED","message":"Authentication required"}} |
| Resend before cooldown | 429: {"error":{"code":"TOO_MANY_REQUESTS","message":"Please try again later"}} |
| Phone transport disabled | 503: {"error":{"code":"SERVICE_UNAVAILABLE","message":"Service unavailable"}} |
| Invalid JSON syntax | 400: {"error":{"code":"INVALID_JSON","message":"Invalid JSON body"}} |

## Neon inspection and cleanup

While the fixture is running, use its normalized phone from the private collection
variables. Replace the placeholder below locally. These queries never select OTP
hashes or bearer identifiers themselves:

```sql
SELECT id, phone, "expiresAt", "resendAvailableAt", "attemptCount",
       "consumedAt", "revokedAt", "createdAt", "updatedAt",
       ("otpHash" ~ '^[0-9a-f]{64}$') AS hash_format_valid
FROM akgebeya.phone_otps WHERE phone = '<fixture phone>';

SELECT id, phone, role FROM akgebeya.users WHERE phone = '<fixture phone>';

SELECT s.id, s."userId", s."expiresAt", s."revokedAt",
       (s."tokenHash" ~ '^[0-9a-f]{64}$') AS hash_format_valid
FROM akgebeya.sessions s JOIN akgebeya.users u ON u.id = s."userId"
WHERE u.phone = '<fixture phone>';
```

Before verification, no user is created. After success, consumedAt is set and one
user exists. Repeat login reuses that user with a new session. After logout, its
session revokedAt is set. Exhaustion sets attemptCount=5 and revokedAt; expired or
used challenges still return 401 through HTTP. The harness checks exact HMAC/session
hash equality in memory, expiry/cooldown durations and absence of plaintext fields.

After Ctrl+C, query PhoneOtp and User by the fixture phone again: both must return
zero rows. Session cleanup is asserted by the saved temporary user ID in the harness.
No existing user or unrelated challenge is deleted.
