# Google authentication ? Step 4.4

## Endpoint and verification

`POST /api/v1/auth/google` accepts only JSON `{"idToken":"<Google ID token>"}`.
POST keeps credentials out of URLs. No profile, email, role, user ID, query fields,
authorization codes or Google access tokens are accepted as authentication input.
The response is `200 {"token":"<AkGebeya JWT>","expiresAt":"<UTC ISO timestamp>"}`.

The existing jose library verifies RS256 signatures using Google's fixed HTTPS JWKS
endpoint, including key rotation, issuer (`accounts.google.com` or
`https://accounts.google.com`), exact configured single-string audience, expiration
without clock tolerance, required issued-at and a nonfuture issued-at.
If present, authorized-party (`azp`) must also equal the configured client ID.
The verified payload must contain a nonblank bounded subject and a valid email
with boolean `email_verified: true`. Email is trimmed and lowercased, matching
the database's existing normalization. No client-supplied profile is trusted.

Configuration is centralized: set `GOOGLE_CLIENT_ID` privately in the ignored
`apps/backend/.env` or inject it through the environment. Omit it to leave Google
login unavailable (503). An invalid configured client ID fails startup safely.
The endpoint needs no GOOGLE_CLIENT_SECRET and performs no code exchange.
Production has no injected keys, synthetic-token switch or token-disclosure route.

Controller ? service ? repository boundaries are preserved. The repository resolves
the identity and the existing AuthService issues its database-backed session within
the same transaction. Only hashed session identifiers are stored. Google tokens,
access tokens, authorization codes and raw JWTs are not persisted or logged.
Use HTTPS outside loopback development. This endpoint returns a bearer token and
sets no authentication cookie. A future browser integration must protect its Google
credential acquisition against login CSRF; it is outside this backend-only step.

## Identity and conflicts

The new migration adds nullable unique `User.googleSub VARCHAR(255)` and a CHECK
rejecting empty/whitespace-only subjects. No other model or applied migration changes.
The email/phone/telegram identity CHECK remains unchanged. The migration uses the
existing akgebeya schema, a transaction, and bounded lock/statement timeouts.

- Existing verified googleSub: use exactly that User, provided the verified email
  does not belong to a different User. Preserve all local profile/contact fields.
- New googleSub and unused verified email: create a User with both identities and
  database-default USER/ACTIVE permissions.
- New googleSub with an existing email: 409; no automatic linking or duplicate user.
- Existing googleSub with another account's email: 409; no merge or overwrite.
- Inactive/deleted users: 401 and no session.
- Changed verified Google email without a conflict: authenticate the same subject;
  do not silently change the stored local email.

Authenticated account linking is a later separate task. Phone and Telegram
identities are never attached, cleared or changed by Google login.
Transaction-scoped advisory locks and database unique constraints prevent duplicate
first-login users. Bounded retries handle unique races and transient lock/deadlock
failures. Session failure rolls back a newly created user.

## Automated and synthetic manual checks

From the repository root:

```powershell
npm run prisma:validate --workspace apps/backend
npm run prisma:generate --workspace apps/backend
npm run db:status --workspace apps/backend
npm run typecheck --workspace apps/backend
npm test --workspace apps/backend
npm run test:database --workspace apps/backend
npm run build --workspace apps/backend
npm audit
node --import tsx apps/backend/scripts/verify-google.ts
```

The live suite runs files sequentially to avoid unrelated suites contending for
the remote development database. Google/phone concurrency tests still issue
parallel requests inside their tests. A shared bounded transaction retry also handles
phone lock-acquisition timeouts before OTP processing starts; it never retries a
phone transaction after delivery/verification begins.

The last command runs actual curl, the importable Postman collection through the
official Postman CLI, and direct Neon inspection. Synthetic signing keys are injected
only into a script-owned app; production's verifier always uses Google's keys.
The private fixture runs on loopback, rejects browser Origin headers, requires a
random authorization key, and keeps credentials in memory. Temporary Postman files
under .git contain only connection settings and are removed. No cloud login,
collection sync, telemetry reporting or body export is used.
Synthetic verification does not satisfy the real-Google final gate.

## Obtain a legitimate development credential

1. In [Google Cloud's Google Auth Platform](https://console.cloud.google.com/auth/clients),
   select a development project, configure Branding/Audience, and add your development
   Google account as a test user if the app is in Testing.
2. Create an OAuth client of type **Web application**. Add the exact authorized
   redirect URI `https://developers.google.com/oauthplayground`.
3. Privately add that client's ID as GOOGLE_CLIENT_ID in apps/backend/.env.
   Keep the client's secret in your local secret manager; the backend does not need it.
   Do not paste either credential into this conversation or a shell command.
4. Open [Google's OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
   In its settings select **Use your own OAuth credentials** and privately enter
   this development client's ID and secret. Use only your development project/account.
5. Enter scopes `openid email`, authorize with the test account, and exchange the
   authorization code. Copy the returned **id_token**, not access_token.
   Do not save/export the exchange, record the screen, log it, or commit the response.
6. Immediately run the following local command. The prompt masks the credential;
   its value never enters shell history or process arguments:

```powershell
$googleCredential = Read-Host 'Paste the development Google ID token privately' -AsSecureString
$googlePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($googleCredential)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($googlePointer) |
    node --import tsx apps/backend/scripts/verify-google.ts --real
  if ($LASTEXITCODE -ne 0) { throw 'Real Google verification failed' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($googlePointer)
  $googleCredential.Dispose()
  Remove-Variable googleCredential, googlePointer
}
```

This checks the real credential with Google's public keys and the exact configured
audience, starts the **compiled backend**, executes curl and ten Postman requests,
checks actual User/Session state in Neon, and cleans up only its own temporary
sessions/user. Existing users and their pre-existing sessions are preserved.
Use a dedicated development account whose email has no conflicting application user.
A real email conflict is deliberately rejected rather than merged.
Invalid-claim/signature and conflict fixtures remain synthetic tests; a legitimate
Google credential cannot be edited to produce Google-signed invalid claims.

The helper prints only sanitized pass/fail outcomes. A successful real run must end
with `PASS: REAL Google credential verified against Google keys and configured audience.`
Do not claim this gate passed from synthetic results.
After testing, remove Playground access for the test client if no longer needed.

## Safe failure diagnostics

The verifier reports only fixed stage names, HTTP statuses (when available),
allowlisted internal codes and fixed reasons. It never prints exception messages,
stacks, response bodies, identity claims, headers or credentials. Cleanup errors
are reported separately and do not replace the original failed stage.

`JWKS_LOOKUP_FAILED` means Google's public-key lookup failed before signature
verification completed; inspect network access to Google's JWKS endpoint.
`TOKEN_FORMAT_INVALID` identifies invalid JWT format. Structural validity alone
is not proof of a valid signature or claims.
The private Google verifier now reports one of TOKEN_FORMAT_INVALID, SIGNATURE_INVALID,
JWKS_LOOKUP_FAILED, ISSUER_INVALID, AUDIENCE_INVALID, TOKEN_EXPIRED,
TOKEN_NOT_YET_VALID, EMAIL_MISSING, EMAIL_NOT_VERIFIED, SUBJECT_MISSING,
CLAIMS_INVALID or UNKNOWN_VERIFICATION_FAILURE. Only the first rejected condition
is reported, never expected or received values. Public API errors remain generic 401.
Clipboard clearing is omitted from the command; it is not required by verification.
At an HTTP stage, the reported status and allowlisted API code identify the failing
endpoint. Database errors retain only allowlisted Prisma codes, never query details.
Postman failures identify the collection stage while keeping CLI output private.

Use a fresh credential with the masked command above. Share only the sanitized
stage/code/status lines if a run fails. Do not share the credential or response body.
A real Google pass is still required; passing synthetic diagnostics is not a substitute.

## Exact standalone curl requests

Start the normally configured backend with `npm start --workspace apps/backend`.
Privately hold a fresh legitimate ID token in $googleIdToken (for example, obtain it
with the masked Read-Host/Marshal pattern above; never type a token literal).
These PowerShell commands capture token responses instead of printing them:

```powershell
$base = 'http://127.0.0.1:3000/api/v1/auth'
function Invoke-GoogleLogin($body) {
  $json = $body | ConvertTo-Json -Compress
  $lines = @($json | curl.exe --silent --show-error --header 'Content-Type: application/json' --data-binary '@-' --write-out '\n%{http_code}' "$base/google")
  if ($LASTEXITCODE -ne 0) { throw 'curl failed' }
  [pscustomobject]@{ Status = [int]$lines[-1]; Body = ($lines[0] | ConvertFrom-Json) }
}
# Valid Google login: 200, token + expiresAt. Do not print the body.
$login = Invoke-GoogleLogin @{ idToken = $googleIdToken }
$login.Status

# Missing body field: 400 BAD_REQUEST.
$r = Invoke-GoogleLogin @{}
$r.Status
$r.Body | ConvertTo-Json -Compress

# Invalid token: 401 UNAUTHORIZED.
$r = Invoke-GoogleLogin @{ idToken = 'invalid' }
$r.Status
$r.Body | ConvertTo-Json -Compress

# Malformed JSON: 400 INVALID_JSON.
'{' | curl.exe --silent --show-error --include --header 'Content-Type: application/json' --data-binary '@-' "$base/google"

# Authenticated user: 200 + user.
"Authorization: Bearer $($login.Body.token)" | curl.exe --silent --show-error --include --header '@-' "$base/me"

# Logout: 200 {"status":"ok"}.
"Authorization: Bearer $($login.Body.token)" | curl.exe --silent --show-error --include --request POST --header '@-' "$base/logout"

# After logout: 401 UNAUTHORIZED.
"Authorization: Bearer $($login.Body.token)" | curl.exe --silent --show-error --include --header '@-' "$base/me"
Remove-Variable googleIdToken, login, r
```

The verification helper executes these equivalent requests without printing user
profile data. Standalone requests create real development records; use a dedicated
test account and inspect/delete only records created for that test.

## Postman collection and expected responses

Import [google-auth.postman_collection.json](postman/google-auth.postman_collection.json)
into Postman Local View. The helper executes this same collection locally and supplies
its private fixture settings. For a standalone desktop request, disable its private
fixture prerequest script and set idToken/sessionToken only in local runtime variables.
Do not sync/export populated variables or save token responses. CLI execution is
documented accurately as a local collection run, not automated desktop interaction.

Every Google request below is **POST http://127.0.0.1:3000/api/v1/auth/google**
with **Content-Type: application/json**. For signed-token cases, body is
`{"idToken":"{{idToken}}"}`; the harness privately supplies the corresponding token.

| Collection request | Body or verified fixture | Status / JSON |
| --- | --- | --- |
| Malformed body | `{` | 400 INVALID_JSON |
| Missing token | `{}` | 400 BAD_REQUEST |
| Untrusted role | `{"idToken":"invalid","role":"ADMIN"}` | 400 BAD_REQUEST |
| Invalid token | `{"idToken":"invalid"}` | 401 UNAUTHORIZED |
| Invalid signature | Different private signing key | 401 UNAUTHORIZED |
| Wrong audience | Different aud | 401 UNAUTHORIZED |
| Wrong issuer | Different iss | 401 UNAUTHORIZED |
| Expired token | Past exp | 401 UNAUTHORIZED |
| Unverified email | email_verified=false | 401 UNAUTHORIZED |
| Valid Google authentication | Valid signed verified identity | 200 session response |
| Repeat Google login | Same verified googleSub | 200 new session, same user |
| Existing email conflict | New sub, existing account email | 409 ACCOUNT_LINKING_CONFLICT |
| Cross-account conflict | Existing sub, another account email | 409 ACCOUNT_LINKING_CONFLICT |

| Collection request | Method and exact URL | Headers | Body | Expected |
| --- | --- | --- | --- | --- |
| Current user | GET http://127.0.0.1:3000/api/v1/auth/me | Authorization: Bearer {{sessionToken}} | None | 200 user response |
| Logout | POST http://127.0.0.1:3000/api/v1/auth/logout | Authorization: Bearer {{sessionToken}} | None | 200 `{"status":"ok"}` |
| Current user after logout | GET http://127.0.0.1:3000/api/v1/auth/me | Authorization: Bearer {{sessionToken}} | None | 401 UNAUTHORIZED |
| Repeat current user | GET http://127.0.0.1:3000/api/v1/auth/me | Authorization: Bearer {{sessionToken}} | None | 200 same user ID |

Exact response bodies (placeholders indicate runtime values):

```json
{"token":"<AkGebeya JWT>","expiresAt":"<UTC ISO timestamp>"}
{"user":{"id":"<UUID>","email":"<stored normalized email>","phone":null,"displayName":"AkGebeya user","role":"USER","preferredLocale":"en"}}
{"error":{"code":"INVALID_JSON","message":"Invalid JSON body"}}
{"error":{"code":"BAD_REQUEST","message":"Invalid request"}}
{"error":{"code":"UNAUTHORIZED","message":"Authentication required"}}
{"error":{"code":"ACCOUNT_LINKING_CONFLICT","message":"Account linking required"}}
{"error":{"code":"SERVICE_UNAVAILABLE","message":"Service unavailable"}}
```

Current-user fields reflect preserved local profile values for an existing user.
No response exposes googleSub or raw Google credentials. Auth-route responses have
Cache-Control: no-store; malformed JSON is rejected earlier by the shared parser.

## Direct Neon inspection

The migration was applied with before/after data snapshots of all 23 existing tables.
Existing data remained unchanged; the application schema adds one unique index and
one CHECK, totaling 47 indexes and 32 CHECK constraints.

Use only your own development test User ID in these SQL queries. They do not select
bearer values or session hashes:

```sql
SELECT column_name, data_type, character_maximum_length, is_nullable
FROM information_schema.columns
WHERE table_schema='akgebeya' AND table_name='users' AND column_name='googleSub';

SELECT indexdef FROM pg_indexes
WHERE schemaname='akgebeya' AND indexname='users_googleSub_key';

SELECT conname, pg_get_constraintdef(oid), convalidated FROM pg_constraint
WHERE connamespace='akgebeya'::regnamespace
AND conname IN ('users_google_sub_check','users_identity_check');

SELECT id, email, "googleSub", phone, "telegramId"
FROM akgebeya.users WHERE id='<test-user-uuid>';

SELECT "googleSub", count(*) FROM akgebeya.users
WHERE "googleSub" IS NOT NULL GROUP BY "googleSub" HAVING count(*) > 1;

SELECT id, "userId", "expiresAt", "revokedAt",
       ("tokenHash" ~ '^[a-f0-9]{64}$') AS hash_format_valid
FROM akgebeya.sessions WHERE "userId"='<test-user-uuid>';
```

Expect nullable VARCHAR(255), a valid unique index, validated blank/identity checks,
zero duplicate subjects, one stable user, and revokedAt after logout.
The manual helper also checks exact SHA-256 session-identifier equality in memory,
absence of the Google token from User/Session data, and preservation of existing
user fields. The schema has no raw Google-token storage field.

The helper removes newly created test users and their sessions, or only its new
sessions when testing an existing user; it preserves pre-existing sessions.
Automated conflict fixtures and concurrency fixtures are also cleaned up.
Do not delete other users or alter Telegram/phone identities for manual testing.

For drift, run from apps/backend so Prisma loads the correct local environment:

```powershell
node ../../node_modules/prisma/build/index.js migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Google reference: [server-side ID-token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
and [OpenID Connect development setup](https://developers.google.com/identity/openid-connect/openid-connect).

## Alternative private input: --real-env

This development/test-only verification mode bypasses PowerShell's stdin pipeline.
It reads AKGEBEYA_GOOGLE_TEST_ID_TOKEN from the invoking process environment only,
before dotenv loading; do not put this credential in .env or any file.
The entry is consumed and removed, and child processes do not inherit it.
Application runtime does not read this variable. The same trim-only normalization,
three-segment format checks and full Google cryptographic verification apply.
Do not combine --real and --real-env.

From the repository root, use a fresh credential in the masked prompt:

```powershell
$credential = Read-Host 'New Google ID token' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential)
try {
  $env:AKGEBEYA_GOOGLE_TEST_ID_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  node --import tsx apps/backend/scripts/verify-google.ts --real-env
  if ($LASTEXITCODE -ne 0) { throw 'Real Google verification failed' }
} finally {
  Remove-Item Env:\AKGEBEYA_GOOGLE_TEST_ID_TOKEN -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $credential.Dispose()
  Remove-Variable credential, pointer
}
```

This sets only the current PowerShell process environment, not a persistent user
or machine variable. Never print/export the environment value.

## Local credential-format preflight

Use the masked process-environment command above with --credential-preflight-env
instead of --real-env to classify format only. The preflight removes the environment
entry immediately, does not load backend configuration, contact Google, start a
server or decode JWT claims. Exit 0 reports FORMAT_ACCEPTABLE; exit 1 reports
TOKEN_FORMAT_INVALID with EMPTY_INPUT, SURROUNDING_QUOTES, EMBEDDED_WHITESPACE,
WRONG_SEGMENT_COUNT, EMPTY_SEGMENT, INVALID_BASE64URL_CHARACTERS or
OTHER_FORMAT_ERROR. The existing input-size bound remains enforced.
Only boundary whitespace is trimmed; nothing inside the credential is repaired.
A format pass is not proof of a valid signature or Google identity.
