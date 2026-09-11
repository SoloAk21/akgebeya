# Provider verification foundation (Step 4.5)

## Scope and trust

The backend supports provider profiles, review requests, review status and ADMIN
decisions. ProviderRole is OWNER, BROKER, AGENT, AGENCY or DEVELOPER; it is separate
from UserRole (USER/ADMIN). Creating a provider never grants administrative rights.

All six routes use existing database-backed authentication. Client-supplied userId,
status, verified flags, reviewerId and extra request fields are rejected. Owner
routes always resolve the authenticated user's provider. Admin routes use current
database roles, recheck active ADMIN state inside the transaction, and forbid
approving or rejecting the administrator's own provider.

Controllers validate HTTP with Zod and call services. Services own transitions and
authorization; repositories own Prisma access. Responses omit subject user IDs,
reviewer IDs, token hashes and private verification media. All responses on these
routes use Cache-Control: no-store. Names/descriptions have separate En/Am fields.

## Database and lifecycle

The new migration adds nullable Provider.role, ProviderRole and the PROVIDER
verification purpose. Existing provider roles remain null; every new API-created
profile requires a valid role. Legacy null roles cannot submit or pass provider
authorization. No existing User, Session or authentication identity field changes.

Verification already belongs to User. Provider.userId is unique, so this relation
identifies one provider safely. Database triggers require a provider for PROVIDER
records and prevent deleting/reassigning that provider while its review history
exists. A partial unique index on Verification.userId WHERE type=PROVIDER AND
status=PENDING prevents duplicate pending requests, including expired requests
until the service explicitly marks them EXPIRED. Existing contact/identity
verification constraints remain effective.

Provider row locks serialize submissions and decisions. A decision must name the
current pending verification ID, so a delayed request cannot decide a newer
submission. The review update also checks pending state and expiry atomically.
A second concurrent decision receives 409. Review records retain their history.

| API verification state | Meaning |
| --- | --- |
| UNVERIFIED | No review, expired review/approval, or approval currently blocked by operational status/invalid role |
| PENDING | Latest review is pending and unexpired |
| VERIFIED | Latest review approved and unexpired, provider ACTIVE, valid provider role |
| REJECTED | Latest review rejected; rejection remains visible until resubmission |

The boolean verification.verified is derived server-side from the same state.
Approval sets Provider.status=ACTIVE; rejection sets PENDING. SUSPENDED overrides
authorization and prevents submissions/decisions. Suspension management is not an
endpoint in this step. An approved record alone never bypasses suspension.

Existing Verification.expiresAt is required. Central configuration defaults:
PROVIDER_PENDING_TTL_SECONDS=604800 (7 days, range 60..2592000);
PROVIDER_APPROVAL_TTL_SECONDS=7776000 (90 days, range 60..31536000).
Approval sets a new approval lifetime; pending expiry blocks decisions. Expired
pending records can be replaced under the provider lock. These are configurable
foundation defaults, not a legal verification policy.

The existing model has reviewedAt and reviewerId but no rejection-reason field;
this step does not add one. There is no verifiedAt column: reviewedAt on the
approved record is the decision timestamp. No document upload is implemented.
Submission requests administrative review; it does not claim to have verified
documents automatically.

The migration commits the enum addition before SQL uses its new value, as PostgreSQL
requires. Remaining changes run in a transaction with lock/statement timeouts.
Before/after private snapshots verified all 23 existing application/public tables
were preserved. The new schema has 48 indexes and 33 CHECK constraints.
Previously applied migration files remain unchanged. The preservation runner
scripts/verify-provider-migration.ts is for initial deployment verification, before
any new provider roles are assigned; it is not an everyday migration command.

## HTTP contract

Default base URL: http://127.0.0.1:3000/api/v1.
Headers: Authorization: Bearer <session> and Content-Type: application/json.
Never put a session in the URL, shell history, exported collection or screenshot.

| Method | Exact URL | JSON body | Success |
| --- | --- | --- | --- |
| POST | `http://127.0.0.1:3000/api/v1/providers` | {"role":"OWNER","nameEn":"Example provider","nameAm":"????"} | 201, provider object |
| GET | `http://127.0.0.1:3000/api/v1/providers/me` | None | 200, provider object |
| POST | `http://127.0.0.1:3000/api/v1/providers/me/verification` | {} | 201, verification object (PENDING) |
| GET | `http://127.0.0.1:3000/api/v1/providers/me/verification` | None | 200, verification object |
| POST | `http://127.0.0.1:3000/api/v1/admin/providers/<providerId>/verification/approve` | {"verificationId":"<pending-verification-uuid>"} | 200, verification object (VERIFIED) |
| POST | `http://127.0.0.1:3000/api/v1/admin/providers/<providerId>/verification/reject` | {"verificationId":"<pending-verification-uuid>"} | 200, verification object (REJECTED) |

Provider response (201 creation; 200 retrieval):
```json
{"provider":{"id":"<uuid>","role":"OWNER","nameEn":"Example provider","nameAm":"????","descriptionEn":null,"descriptionAm":null,"status":"PENDING","verification":{"id":null,"state":"UNVERIFIED","verified":false,"reviewedAt":null,"expiresAt":null}}}
```
Verification response:
```json
{"verification":{"id":"<uuid>","state":"PENDING","verified":false,"reviewedAt":null,"expiresAt":"<UTC timestamp>"}}
```
After approval: state VERIFIED, verified true, reviewedAt a UTC timestamp.
After rejection: state REJECTED, verified false, reviewedAt a UTC timestamp.

| HTTP | JSON |
| --- | --- |
| 400 | {"error":{"code":"BAD_REQUEST","message":"Invalid request"}} |
| 401 | {"error":{"code":"UNAUTHORIZED","message":"Authentication required"}} |
| 403 | {"error":{"code":"FORBIDDEN","message":"Access denied"}} |
| 404 | {"error":{"code":"PROVIDER_NOT_FOUND","message":"Provider profile not found"}} |
| 409 | {"error":{"code":"PROVIDER_CONFLICT","message":"Provider state conflicts with this request"}} |

Duplicate profiles, duplicate live pending submissions and stale/repeated decisions
return 409. Invalid provider roles and injected ownership/status fields return 400.
Missing/expired/revoked sessions return 401. USER decisions, self-review, suspended
providers and failed provider authorization return 403. Existing safe JSON parser
and internal-server errors remain shared.

## Executed local manual workflow

From the repository root with the existing ignored development backend .env:
```powershell
npm run typecheck --workspace apps/backend
npm test --workspace apps/backend
npm run test:database --workspace apps/backend
npm run build --workspace apps/backend
node --import tsx apps/backend/scripts/verify-provider.ts
npm audit
```

The manual runner refuses production, starts the compiled backend on a free
loopback port, and creates isolated development users with USER/ADMIN roles in
Neon. It issues sessions through the existing trusted internal authentication
service. Roles are never faked in headers or client JSON. It executes 22 curl
requests and the same 22 Postman requests on separate temporary fixtures.

The runner also directly inspects Neon ownership, provider role, review decision,
reviewer/timestamp, uniqueness and session hashes. A separate loopback-only harness
executes the real authentication and provider middleware through curl: anonymous
401, unverified/rejected/suspended/null-role providers 403, wrong owner 403, active
verified provider 200. No capability-test endpoint is added to the application.

Only sanitized pass/failure stages are printed. Curl receives tokens via stdin.
Postman obtains tokens from a random-key-protected loopback fixture and keeps them
in runtime-local variables. The CLI runs with --no-report-events --silent. A
temporary collection file contains only fixture connection settings, never
application session tokens, and is removed. User/profile/review/session fixtures
are deleted in finally blocks; existing authentication identities are checked for
changes. Never run the runner against production.

## Exact individual curl commands (PowerShell)

The automated command above executes these operations against its private users.
For interactive checks on port 3000, privately obtain current owner, second-user
and ADMIN sessions from trusted authentication. Keep them in $ownerSession,
$otherSession and $adminSession; do not paste credentials as literal commands.
The ADMIN session must belong to a database ADMIN.

This helper passes headers and JSON together through curl's stdin:
```powershell
function Invoke-ProviderCurl {
  param([string]$Method, [string]$Path, [string]$Session = '', $Body = $null)
  $lines = @(('request = "' + $Method + '"'), 'header = "Content-Type: application/json"')
  if ($Session) { $lines += 'header = ' + (ConvertTo-Json -InputObject ("Authorization: Bearer " + $Session) -Compress) }
  if ($null -ne $Body) {
    $jsonBody = ConvertTo-Json -InputObject $Body -Compress
    $lines += 'data = ' + (ConvertTo-Json -InputObject $jsonBody -Compress)
  }
  $raw = ($lines -join "`n") | curl.exe --silent --show-error --config - --write-out "`n%{http_code}" ("http://127.0.0.1:3000/api/v1" + $Path)
  if ($LASTEXITCODE -ne 0) { throw 'curl failed' }
  $text = $raw -join "`n"
  $split = $text.LastIndexOf("`n")
  [pscustomobject]@{ Status = [int]$text.Substring($split + 1); Body = ($text.Substring(0, $split) | ConvertFrom-Json) }
}
# 401
Invoke-ProviderCurl POST /providers '' @{role='OWNER';nameEn='Example provider'}
# 201, then 200 UNVERIFIED
$created = Invoke-ProviderCurl POST /providers $ownerSession @{role='OWNER';nameEn='Example provider'}
$providerId = $created.Body.provider.id
Invoke-ProviderCurl GET /providers/me $ownerSession
# 201 PENDING, then 200 PENDING; repeating submission returns 409
$submitted = Invoke-ProviderCurl POST /providers/me/verification $ownerSession @{}
$verificationId = $submitted.Body.verification.id
Invoke-ProviderCurl GET /providers/me/verification $ownerSession
# 403; role comes from the authenticated database User
Invoke-ProviderCurl POST "/admin/providers/$providerId/verification/approve" $ownerSession @{verificationId=$verificationId}
# 200 VERIFIED, then 200 profile with verification.verified=true
Invoke-ProviderCurl POST "/admin/providers/$providerId/verification/approve" $adminSession @{verificationId=$verificationId}
Invoke-ProviderCurl GET /providers/me $ownerSession
# Separate rejection case: 201, 201, 200 REJECTED, 200 REJECTED
$second = Invoke-ProviderCurl POST /providers $otherSession @{role='BROKER';nameEn='Second provider'}
$secondReview = Invoke-ProviderCurl POST /providers/me/verification $otherSession @{}
Invoke-ProviderCurl POST ("/admin/providers/" + $second.Body.provider.id + "/verification/reject") $adminSession @{verificationId=$secondReview.Body.verification.id}
Invoke-ProviderCurl GET /providers/me/verification $otherSession
Remove-Variable ownerSession,otherSession,adminSession -ErrorAction SilentlyContinue
```

## Postman

Import [the collection](postman/provider-verification.postman_collection.json).
Each request includes method, URL, headers, body, expected status and expected JSON
in its description, plus assertions. Run sequentially using isolated fixtures.
The runner above executes the collection locally with the existing Postman CLI.
For desktop use, use local unsynced session variables ownerToken, otherToken,
adminToken and baseUrl; pre-populating ownerToken avoids the private fixture
bootstrap. Never save/export the populated tokens.

## Neon inspection

The runner executes equivalent parameterized queries privately for its own
fixture IDs, then cleans up. In a private Neon SQL session, use only temporary
test IDs for these checks; do not copy results containing user identities.

```sql
SELECT id, "userId", role, status FROM akgebeya.providers
WHERE "userId" = '<temporary-user-uuid>'::uuid;

SELECT id, "userId", type, status, "reviewerId", "reviewedAt", "expiresAt",
       ("target" IS NULL AND "tokenHash" IS NULL) AS no_contact_credentials
FROM akgebeya.verifications
WHERE "userId" = '<temporary-user-uuid>'::uuid AND type = 'PROVIDER';

SELECT count(*) <= 1 AS single_pending FROM akgebeya.verifications
WHERE "userId" = '<temporary-user-uuid>'::uuid
  AND type = 'PROVIDER' AND status = 'PENDING';

SELECT bool_and("tokenHash" ~ '^[0-9a-f]{64}$') AS hash_only
FROM akgebeya.sessions WHERE "userId" = '<temporary-user-uuid>'::uuid;

SELECT indexdef FROM pg_indexes WHERE schemaname = 'akgebeya'
AND indexname = 'verifications_provider_pending_key';
```

Unauthorized HTTP attempts must leave the pending record and provider unchanged.
Approved/rejected records must name the authenticated ADMIN as reviewer. Cleanup
must delete only the explicitly tracked fixture reviews, then providers, then
users (sessions cascade); never delete arbitrary users or review history.

The provider middleware is a foundation for later capabilities. Every future
provider action must authenticate and check owned provider, allowed provider role,
current approval and operational status. No listing behavior is implemented here.
