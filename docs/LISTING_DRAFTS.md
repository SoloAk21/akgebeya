# Listing draft foundation (Step 4.6)

## Contract and scope

Private provider-owned DRAFT CRUD only. No completion, AI, fees, payment,
publication, public listing API, search, uploads or other later lifecycle actions.

Authentication and the existing verified-provider authorization protect these
routes. The service rechecks ownership, role, current approval and ACTIVE provider
status inside the provider-locked transaction. ADMIN has no provider bypass.
Other providers, missing/deleted IDs and non-DRAFT reads return 404. Mutation of an
owned non-DRAFT record returns 409. Reads also require current provider authorization.

Controllers handle HTTP, services own validation/business rules, and repositories
own Prisma operations. The shared provider policy is reused. Clients cannot submit
userId, providerId, locationId, status, publishedAt, deletedAt, currency, payment,
media, verification flags or arbitrary extra fields.

## Taxonomy and partial data

Category and property type are distinct:

| Category | Property types |
| --- | --- |
| RESIDENTIAL | STUDIO, APARTMENT, CONDOMINIUM, VILLA, HOUSE, G_PLUS_1, G_PLUS_2 |
| COMMERCIAL | OFFICE, SHOP, WAREHOUSE, BUILDING, HOTEL |
| LAND | INDUSTRIAL_LAND, AGRICULTURAL_LAND, RESIDENTIAL_LAND, COMMERCIAL_LAND |

The existing field type represents purpose: SALE, RENT, BUY_REQUEST, RENT_REQUEST.
G_PLUS_1/G_PLUS_2 are API/database identifiers; G+1/G+2 are display labels only.
Generic LAND, COMMERCIAL and OTHER property types are removed.

POST accepts {}. ID, providerId, DRAFT status, timestamps and ETB currency are
server-owned. All property details are genuinely NULL until supplied.

Optional create/PATCH fields:
category, type, propertyType, titleEn, titleAm, descriptionEn, descriptionAm,
price, areaSqm, bedrooms, bathrooms, location.
Explicit null clears a field; omitted fields remain unchanged on PATCH.
PATCH requires at least one field. Supplied text must be nonblank and contain no
control characters. Titles: 200 characters; descriptions: 10000; existing total
JSON-body limit: 16 KiB. English and Amharic are independent for drafts.

Price is a positive decimal STRING, at most 16 integer digits and 2 fractional
digits, e.g. "1234.50". Area uses a positive decimal string with at most 10 integer
digits and 2 fractional digits. This avoids JavaScript money rounding. Bedrooms
and bathrooms are integers 0..32767 or null. NaN, Infinity, negatives, zero
price/area and excessive scale are rejected.

Category alone is valid. Property type requires a matching category. PATCH
validates the merged result: changing category may require changing/clearing
propertyType in the same request.

Location is null or a strict object requiring genuine regionEn and cityEn; optional
countryCode must be ET. regionAm/cityAm/subcityEn/subcityAm/addressEn/addressAm are
optional nullable strings. A supplied location creates a dedicated Location row;
clients cannot attach an arbitrary location ID or edit shared location records.
No coordinates API is added. Clearing/replacing a location retains its previous
row; this step does not perform location retention/garbage collection.

## Migration and preservation

The single new migration has a schema guard, bounded lock/statement timeouts and an
exclusive listing-table lock. If ANY listing row exists, including a soft-deleted
row, it aborts before schema changes. Inspection/application found zero listings.
Private before/after snapshots verified all 23 existing application/public tables.

It replaces PropertyType without CASCADE, extends ListingType, adds nullable
PropertyCategory and makes initial property details nullable. Existing indexes/FKs
are preserved. The application has 48 indexes and 36 CHECK constraints.

Database checks enforce category/type compatibility, nonblank supplied bilingual
text, positive finite price/area and non-negative dimensions. Non-DRAFT states
still require category, purpose, property type, English title/description,
location and positive price. The existing publication check remains; a new check
requires DRAFT publishedAt to be NULL. No transition is implemented.

scripts/verify-listing-migration.ts is the initial development deployment
preservation runner, not an everyday command to run against populated listings.

## Concurrency and deletion

Create/get/update return an ETag response header and listing.etag. Mine includes
an etag per listing. These are opaque quoted SHA-256 revisions derived from listing
ID and the full PostgreSQL updatedAt timestamp (microseconds).

PATCH and DELETE require exactly one strong If-Match value from that listing.
Missing: 428. Malformed/weak/wildcard/multiple: 400. Stale: 412.
On 412, retrieve the draft again and reconcile changes before retrying.

The repository locks provider then listing, checks the revision, writes
transactionally and advances updatedAt using the greater of database wall time and
the previous revision plus one microsecond. It does not round the revision through
JavaScript Date. Concurrent edits using one ETag cannot silently overwrite.
No version column or extra migration is needed.

DELETE sets deletedAt and advances the revision; status remains DRAFT. Deleted
drafts disappear from mine and return 404 on read/mutation. Records with attached
payments or media are not mutable/deletable through this foundation (409).
Soft deletion does not delete providers, locations, media or payments.

## Endpoints and responses

Default base URL: http://127.0.0.1:3000/api/v1/listings.
Headers: Authorization: Bearer <session>; Content-Type: application/json for JSON.
PATCH/DELETE additionally require If-Match: "<opaque revision>".
Responses use Cache-Control: no-store. CORS supports PATCH/DELETE/If-Match and
exposes ETag to configured origins.

| Method | URL suffix | Body | Expected success |
| --- | --- | --- | --- |
| POST | /listings | {} or allowed partial fields | 201 {"listing":...} |
| GET | /listings/mine?limit=20&offset=0 | None | 200 {"listings":[...],"limit":20,"offset":0} |
| GET | /listings/<listingId> | None | 200 {"listing":...} |
| PATCH | /listings/<listingId> | Nonempty partial fields | 200 {"listing":...}, new ETag |
| DELETE | /listings/<listingId> | None or {} | 200 {"status":"ok"} |

URL suffixes above follow http://127.0.0.1:3000/api/v1.
Mine limit is 1..50 (default 20), offset 0..10000 (default 0), ordered by
createdAt descending and ID descending. There is no public listing endpoint.

Empty draft response:
```json
{"listing":{"id":"<uuid>","category":null,"type":null,"propertyType":null,"titleEn":null,"titleAm":null,"descriptionEn":null,"descriptionAm":null,"price":null,"currency":"ETB","bedrooms":null,"bathrooms":null,"areaSqm":null,"location":null,"status":"DRAFT","createdAt":"<UTC timestamp>","updatedAt":"<UTC timestamp>","etag":"\"<opaque revision>\""}}
```

Updates return the same shape with supplied values; decimal values serialize as
two-decimal strings. No user identity, payment records or media records are returned.

| HTTP | JSON |
| --- | --- |
| 400 | {"error":{"code":"BAD_REQUEST","message":"Invalid request"}} |
| 401 | {"error":{"code":"UNAUTHORIZED","message":"Authentication required"}} |
| 403 | {"error":{"code":"FORBIDDEN","message":"Access denied"}} |
| 404 | {"error":{"code":"LISTING_NOT_FOUND","message":"Listing not found"}} |
| 409 | {"error":{"code":"LISTING_CONFLICT","message":"Listing is not an editable draft"}} |
| 428 | {"error":{"code":"PRECONDITION_REQUIRED","message":"If-Match is required"}} |
| 412 | {"error":{"code":"PRECONDITION_FAILED","message":"Listing changed; retrieve it again"}} |

Existing INVALID_JSON (400), PAYLOAD_TOO_LARGE (413) and safe 500 errors remain shared.

## Required local manual verification

From repository root, using the configured Neon DEVELOPMENT branch:
```powershell
npm run build --workspace apps/backend
node --import tsx apps/backend/scripts/verify-listing.ts
```

The runner refuses production and starts the compiled backend on a free loopback
port. It creates temporary database users/providers in approved, unverified,
rejected, suspended and roleless states, plus a user without a provider. Sessions
come from the existing trusted internal authentication service; client role flags
never grant access. A separate complete PAUSED fixture tests rejection of
non-DRAFT writes; it is not an implemented lifecycle transition.

It executes 34 curl and 34 Postman requests, then inspects Neon directly for
ownership, NULLs, bilingual fields, DRAFT/publishedAt state, absence of payments,
unauthorized no-op behavior, soft deletion and unchanged non-DRAFT data. Cleanup
removes only tracked fixture listings/locations/users/providers/reviews/sessions.
Existing provider and authentication identity snapshots must remain unchanged.

Tokens stay in memory and curl stdin. Postman receives them from a random-key
protected loopback fixture into runtime-local variables. Only temporary fixture
connection settings are written into an ignored collection file, then removed.
Postman CLI runs with --no-report-events --silent; output is sanitized.
No raw credentials or response bodies are logged.

## Exact curl commands (PowerShell)

For interactive port-3000 checks, privately obtain real sessions for an approved
owner, another approved provider, and unverified/suspended providers. Keep them in
$ownerSession, $otherSession, $unverifiedSession and $suspendedSession. Never paste
tokens as literal commands or print these variables. The runner above supplies
equivalent isolated sessions automatically.

```powershell
function Invoke-DraftCurl {
  param([string]$Method, [string]$Path, [string]$Session = '', $Body = $null, [string]$Match = '')
  $lines = @(('request = "' + $Method + '"'), 'header = "Content-Type: application/json"')
  if ($Session) { $lines += 'header = ' + (ConvertTo-Json -InputObject ("Authorization: Bearer " + $Session) -Compress) }
  if ($Match) { $lines += 'header = ' + (ConvertTo-Json -InputObject ("If-Match: " + $Match) -Compress) }
  if ($null -ne $Body) {
    $jsonBody = ConvertTo-Json -InputObject $Body -Compress
    $lines += 'data = ' + (ConvertTo-Json -InputObject $jsonBody -Compress)
  }
  $raw = ($lines -join [char]10) | curl.exe --silent --show-error --config - --write-out ([char]10 + '%{http_code}') ("http://127.0.0.1:3000/api/v1/listings" + $Path)
  if ($LASTEXITCODE -ne 0) { throw 'curl failed' }
  $text = $raw -join [char]10
  $split = $text.LastIndexOf([char]10)
  [pscustomobject]@{ Status = [int]$text.Substring($split + 1); Body = ($text.Substring(0, $split) | ConvertFrom-Json) }
}
# Unauthenticated: 401
Invoke-DraftCurl POST '' '' @{}
# Approved provider: 201, genuinely empty DRAFT
$created = Invoke-DraftCurl POST '' $ownerSession @{}
$id = $created.Body.listing.id
$etag = $created.Body.listing.etag
# Invalid body/purpose: 400; lifecycle escalation: 400
Invoke-DraftCurl POST '' $ownerSession @{type='INVALID'}
Invoke-DraftCurl POST '' $ownerSession @{status='PUBLISHED'}
# Category-only and compatible details: 201
Invoke-DraftCurl POST '' $ownerSession @{category='LAND'}
Invoke-DraftCurl POST '' $ownerSession @{category='RESIDENTIAL';propertyType='G_PLUS_1'}
# Own read: 200; other-provider read: 404
Invoke-DraftCurl GET "/$id" $ownerSession
Invoke-DraftCurl GET "/$id" $otherSession
Invoke-DraftCurl GET '/mine?limit=20&offset=0' $ownerSession
# Other-provider update: 404
Invoke-DraftCurl PATCH "/$id" $otherSession @{titleEn='Denied'} $etag
# Own update: 200 with new ETag; repeat old ETag: 412
$updated = Invoke-DraftCurl PATCH "/$id" $ownerSession @{titleEn='My draft';category='RESIDENTIAL';propertyType='HOUSE'} $etag
Invoke-DraftCurl PATCH "/$id" $ownerSession @{titleEn='Stale edit'} $etag
# Unverified/suspended creation and mutation: 403
Invoke-DraftCurl POST '' $unverifiedSession @{}
Invoke-DraftCurl POST '' $suspendedSession @{}
Invoke-DraftCurl PATCH "/$id" $suspendedSession @{titleEn='Denied'} $updated.Body.listing.etag
# Soft-delete: 200; deleted read: 404
Invoke-DraftCurl DELETE "/$id" $ownerSession $null $updated.Body.listing.etag
Invoke-DraftCurl GET "/$id" $ownerSession
Remove-Variable ownerSession,otherSession,unverifiedSession,suspendedSession -ErrorAction SilentlyContinue
```

## Postman

Import [listing-draft.postman_collection.json](postman/listing-draft.postman_collection.json).
Every request includes method, complete URL template, headers, JSON body, expected
status/JSON and assertions. The runner executes the collection sequentially.

For desktop use, keep sessions in local unsynced runtime variables ownerToken,
otherToken, adminToken (no provider), spareToken (unverified), rejectedToken,
suspendedToken and rolelessToken. Supply the private test nonDraftId for its
rejection case. Pre-populating ownerToken skips fixture bootstrap. Never export or
sync a collection/environment containing tokens. Ordinary users cannot create
verification states or elevate roles through request input.

## Direct Neon verification

The runner performs these checks privately with its tracked fixture IDs:
```sql
SELECT l.id, l."providerId" = p.id AS correct_owner, l.status,
       l."publishedAt" IS NULL AS unpublished, l."deletedAt"
FROM akgebeya.listings l JOIN akgebeya.providers p ON p.id = l."providerId"
WHERE l.id = '<fixture-listing-uuid>'::uuid;

SELECT category, type, "propertyType", "titleEn", "titleAm",
       "descriptionEn", "descriptionAm", "locationId", price
FROM akgebeya.listings WHERE id = '<fixture-listing-uuid>'::uuid;

SELECT count(*) AS payments FROM akgebeya.payments
WHERE "listingId" = '<fixture-listing-uuid>'::uuid;
SELECT count(*) AS media FROM akgebeya.media
WHERE "listingId" = '<fixture-listing-uuid>'::uuid;
```

Inspect NULLs immediately after empty creation, before filling fields. Negative
requests must create no rows or change another listing. After soft deletion the
stored status stays DRAFT and deletedAt is populated, while HTTP access returns
404. Do not delete untracked records during manual cleanup.

## Regression gate

Prisma validate/generate, migration status/drift, typecheck, all backend tests,
all live database tests, curl/Postman/RBAC, build, audit and credential scans
must pass before committing. Schema tests cover the empty-table guard, every
valid/incompatible taxonomy combination, all purposes, nonblank content, numeric
bounds, non-DRAFT completeness, publication protection and location FK integrity.
Live API-repository tests exercise two simultaneous edits with the same ETag:
exactly one succeeds, the other receives PRECONDITION_FAILED.
