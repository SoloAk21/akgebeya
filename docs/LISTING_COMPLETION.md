# Listing completion and validation (Step 4.7)

## Scope and contract

Only DRAFT -> COMPLETE -> VALIDATE is implemented. COMPLETE means required
information has been supplied; VALIDATE means the backend rechecked the stored
listing successfully. Neither state implies publication, payment, AI review,
translation or provider approval beyond the existing provider requirement.

| Method | Exact default URL | JSON body | Required headers | Success |
| --- | --- | --- | --- | --- |
| POST | http://127.0.0.1:3000/api/v1/listings/<listingId>/complete | {} | Authorization: Bearer <session>; Content-Type: application/json; If-Match: "<revision>" | 200, listing.status COMPLETE |
| POST | http://127.0.0.1:3000/api/v1/listings/<listingId>/validate | {} | Same headers, current If-Match | 200, listing.status VALIDATE |

Bodies must be JSON empty objects. The server chooses the target status from the
route. Status, ownership, provider flags and all other body keys are rejected.
PATCH still accepts only DRAFT property edits and rejects every status field.

Success returns {"listing": <same listing DTO as Step 4.6>}, with the new status,
updatedAt and etag; the ETag header equals listing.etag. All other stored listing
fields remain unchanged. Responses use Cache-Control: no-store and Vary:
Authorization. Existing GET /listings/:listingId also permits the owner's
COMPLETE/VALIDATE rows so the current ETag can be retrieved. GET /listings/mine
remains DRAFT-only. PATCH and DELETE remain DRAFT-only.

Authentication, current owned provider, valid ProviderRole, unexpired approved
verification, ACTIVE provider and nondeleted owned listing are required for both
actions and private reads. ADMIN has no provider bypass. Another provider receives
404 without validation details.

## Completion and revalidation

Both actions run the same validation over stored data:
- category, type (purpose), propertyType and their approved compatibility;
- nonblank English title and description, retaining the existing text limits;
- a referenced Location with matching ID and valid existing address fields;
- finite positive price within Decimal(18,2), and currency ETB;
- any supplied Amharic text, bedrooms, bathrooms or area obeying draft constraints.

Amharic text, bedrooms, bathrooms and area remain optional for every category.
Commercial and land listings require no residential-only fields. No bedrooms or
area minimum is invented. Location has no deletedAt field; missing/invalid
references are rejected, and the existing FK prevents dangling references.
The existing location input policy requires countryCode ET and real regionEn/
cityEn. Validation does not write or translate content.

COMPLETE is not trusted as proof that data remains valid. VALIDATE rechecks fields,
location, provider authorization and current listing state. A live test changes a
fixture location to a value rejected by the existing policy and verifies that
VALIDATE fails while the listing remains COMPLETE, then restores the fixture.

## Errors and state machine

| HTTP | Error code | Meaning |
| --- | --- | --- |
| 400 | BAD_REQUEST | Malformed ID/body/header or client-supplied lifecycle state |
| 401 | UNAUTHORIZED | Missing/invalid/expired/revoked session |
| 403 | FORBIDDEN | Missing, unverified, rejected, suspended or roleless provider |
| 404 | LISTING_NOT_FOUND | Missing/deleted listing or another provider's listing |
| 409 | LISTING_TRANSITION_CONFLICT | Wrong current state or attached payment/media/publication state |
| 412 | PRECONDITION_FAILED | Stale ETag |
| 428 | PRECONDITION_REQUIRED | Missing If-Match |
| 422 | LISTING_INCOMPLETE | Missing or invalid stored fields |

Safe incomplete response example:
~~~json
{"error":{"code":"LISTING_INCOMPLETE","message":"Listing information is incomplete or invalid","fields":["descriptionEn"]}}
~~~

Only fixed field names are returned, never stored values, unrelated identities or
database errors. Validation failure leaves status, content and revision unchanged.
An invalid COMPLETE row also receives LISTING_INCOMPLETE and stays COMPLETE.

| Current | Requested action | Result with current ETag |
| --- | --- | --- |
| DRAFT | complete | COMPLETE if valid, otherwise 422 |
| DRAFT | validate | 409 |
| COMPLETE | complete | 409 |
| COMPLETE | validate | VALIDATE if valid, otherwise 422 |
| VALIDATE | complete or validate | 409 |
| Any | PATCH status (including DRAFT or PUBLISHED) | 400 |

No reverse transition, publication or future-stage endpoint is implemented.
A stale ETag returns 412 before checking the transition's current-state rule,
so the second concurrent request receives 412 even after the first changed state.

## Atomicity and migration

Both actions reuse Step 4.6 strong quoted ETags from full PostgreSQL microsecond
updatedAt values. Missing, weak, wildcard, multiple and malformed If-Match values
are rejected. Under a provider lock, the repository locks the owned listing,
locks its referenced location FOR SHARE and rereads it. The service compares the
revision and validates; the repository conditionally updates status and advances
updatedAt monotonically inside the same transaction. Any error rolls back.
Concurrent complete or validate requests using one ETag yield exactly one success.

The single new listing_completion_validation migration adds only COMPLETE and
VALIDATE to ListingStatus and expands listings_draft_publication_check to require
NULL publishedAt for DRAFT, COMPLETE and VALIDATE. The original PUBLISHED check
is preserved. Existing values, rows, columns, defaults, indexes, FKs, payment/media
tables and all applied migration files are unchanged. The check compares status
as text so the new enum labels are not used as enum constants before commit.
It uses a schema guard and bounded lock/statement timeouts.

Migration verification snapshots all 23 existing application/public tables privately
and compares existing columns, indexes and every other constraint before/after.
There are still 48 application indexes and 36 CHECK constraints. No data backfill,
empty-table requirement, extra version column or dependency installation is needed.

## Executable local manual gate

From repository root with the existing ignored DEVELOPMENT backend .env:
~~~powershell
npm run build --workspace apps/backend
node --import tsx apps/backend/scripts/verify-completion.ts
node --import tsx apps/backend/scripts/verify-listing.ts
~~~

The completion runner executes 42 curl and 42 Postman requests on separate,
tracked database fixtures. It starts the compiled backend on a free loopback port.
Authentication sessions come from the existing authentication service; provider/
admin roles come from actual database state, never client role flags.

For curl transitions it directly checks Neon before/after each action: failed
requests leave the complete row unchanged; successful requests change only status
and updatedAt. Both modes verify final DRAFT/VALIDATE states, ownership, NULL
publishedAt, optional fields, no translated/generated content and zero payment or
media rows. The live database suite separately verifies concurrent COMPLETE and
VALIDATE attempts for all three categories.

Tokens stay in memory and curl stdin. Postman uses private loopback fixture
bootstrap and runtime-local token variables; the CLI runs --no-report-events
--silent. Only temporary fixture connection settings are written under ignored
.git and are removed in finally. No token, raw response or identity is logged.
Cleanup removes only tracked fixture records and checks provider/auth preservation.
Never run manual fixture creation against production.

## Exact PowerShell curl requests

Use private variables $ownerSession, $otherSession, $adminSession, $spareSession,
$rejectedSession, $suspendedSession and $rolelessSession containing legitimate
development sessions in the corresponding fixture states. Do not paste tokens
as literal commands or print/export them. The executable runner supplies these
states and sessions automatically. The helper passes Authorization and If-Match
through stdin, not process arguments. The default base URL is port 3000.

Each request below gives its expected status and error/state. JSON request bodies
are represented as PowerShell hashtables and serialized by the helper. Successful
responses follow the complete listing DTO documented above and in the importable
Postman collection; safe error responses contain code/message and fields for 422.

~~~powershell
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
~~~
~~~powershell
# Create empty draft: HTTP 201; DRAFT
$r = Invoke-DraftCurl POST '' $ownerSession @{} ''
$emptyId = $r.Body.listing.id
$emptyEtag = $r.Body.listing.etag
$r.Status
# Create res draft: HTTP 201; DRAFT
$r = Invoke-DraftCurl POST '' $ownerSession @{category='RESIDENTIAL';type='SALE';propertyType='HOUSE';titleEn='Completion fixture';descriptionEn='Private completion verification fixture';price='100.00';location=@{regionEn='Addis Ababa';cityEn='Addis Ababa'}} ''
$resId = $r.Body.listing.id
$resEtag = $r.Body.listing.etag
$resInitialEtag = $r.Body.listing.etag
$r.Status
# Create partial draft: HTTP 201; DRAFT
$r = Invoke-DraftCurl POST '' $ownerSession @{category='RESIDENTIAL';type='SALE';propertyType='HOUSE';titleEn='Completion fixture';price='100.00';location=@{regionEn='Addis Ababa';cityEn='Addis Ababa'}} ''
$partialId = $r.Body.listing.id
$partialEtag = $r.Body.listing.etag
$r.Status
# Create commercial draft: HTTP 201; DRAFT
$r = Invoke-DraftCurl POST '' $ownerSession @{category='COMMERCIAL';type='SALE';propertyType='OFFICE';titleEn='Completion fixture';descriptionEn='Private completion verification fixture';price='100.00';location=@{regionEn='Addis Ababa';cityEn='Addis Ababa'}} ''
$commercialId = $r.Body.listing.id
$commercialEtag = $r.Body.listing.etag
$r.Status
# Create land draft: HTTP 201; DRAFT
$r = Invoke-DraftCurl POST '' $ownerSession @{category='LAND';type='SALE';propertyType='RESIDENTIAL_LAND';titleEn='Completion fixture';descriptionEn='Private completion verification fixture';price='100.00';location=@{regionEn='Addis Ababa';cityEn='Addis Ababa'}} ''
$landId = $r.Body.listing.id
$landEtag = $r.Body.listing.etag
$r.Status
# Create deleted draft: HTTP 201; DRAFT
$r = Invoke-DraftCurl POST '' $ownerSession @{category='RESIDENTIAL';type='SALE';propertyType='HOUSE';titleEn='Completion fixture';descriptionEn='Private completion verification fixture';price='100.00';location=@{regionEn='Addis Ababa';cityEn='Addis Ababa'}} ''
$deletedId = $r.Body.listing.id
$deletedEtag = $r.Body.listing.etag
$r.Status
# Delete fixture draft: HTTP 200; ok
$r = Invoke-DraftCurl DELETE "/$deletedId" $ownerSession $null $deletedEtag
$r.Status
# Unauthenticated completion: HTTP 401; UNAUTHORIZED
$r = Invoke-DraftCurl POST "/$resId/complete" '' @{} ''
$r.Status
# admin completion denied: HTTP 403; FORBIDDEN
$r = Invoke-DraftCurl POST "/$resId/complete" $adminSession @{} $resEtag
$r.Status
# spare completion denied: HTTP 403; FORBIDDEN
$r = Invoke-DraftCurl POST "/$resId/complete" $spareSession @{} $resEtag
$r.Status
# rejected completion denied: HTTP 403; FORBIDDEN
$r = Invoke-DraftCurl POST "/$resId/complete" $rejectedSession @{} $resEtag
$r.Status
# suspended completion denied: HTTP 403; FORBIDDEN
$r = Invoke-DraftCurl POST "/$resId/complete" $suspendedSession @{} $resEtag
$r.Status
# roleless completion denied: HTTP 403; FORBIDDEN
$r = Invoke-DraftCurl POST "/$resId/complete" $rolelessSession @{} $resEtag
$r.Status
# Other provider completion: HTTP 404; LISTING_NOT_FOUND
$r = Invoke-DraftCurl POST "/$resId/complete" $otherSession @{} $resEtag
$r.Status
# Deleted completion: HTTP 404; LISTING_NOT_FOUND
$r = Invoke-DraftCurl POST "/$deletedId/complete" $ownerSession @{} $deletedEtag
$r.Status
# Empty completion: HTTP 422; LISTING_INCOMPLETE fields=category,type,propertyType,titleEn,descriptionEn,price,locationId
$r = Invoke-DraftCurl POST "/$emptyId/complete" $ownerSession @{} $emptyEtag
$r.Status
# Missing English description: HTTP 422; LISTING_INCOMPLETE fields=descriptionEn
$r = Invoke-DraftCurl POST "/$partialId/complete" $ownerSession @{} $partialEtag
$r.Status
# Missing precondition: HTTP 428; PRECONDITION_REQUIRED
$r = Invoke-DraftCurl POST "/$resId/complete" $ownerSession @{} ''
$r.Status
# Malformed precondition: HTTP 400; BAD_REQUEST
$r = Invoke-DraftCurl POST "/$resId/complete" $ownerSession @{} '*'
$r.Status
# Reject client transition body: HTTP 400; BAD_REQUEST
$r = Invoke-DraftCurl POST "/$resId/complete" $ownerSession @{status='COMPLETE'} $resEtag
$r.Status
# Skip complete denied: HTTP 409; LISTING_TRANSITION_CONFLICT
$r = Invoke-DraftCurl POST "/$resId/validate" $ownerSession @{} $resEtag
$r.Status
# Residential complete: HTTP 200; COMPLETE
$r = Invoke-DraftCurl POST "/$resId/complete" $ownerSession @{} $resEtag
$resEtag = $r.Body.listing.etag
$r.Status
# Stale validation ETag: HTTP 412; PRECONDITION_FAILED
$r = Invoke-DraftCurl POST "/$resId/validate" $ownerSession @{} $resInitialEtag
$r.Status
# Repeated complete: HTTP 409; LISTING_TRANSITION_CONFLICT
$r = Invoke-DraftCurl POST "/$resId/complete" $ownerSession @{} $resEtag
$r.Status
# Complete to draft denied: HTTP 400; BAD_REQUEST
$r = Invoke-DraftCurl PATCH "/$resId" $ownerSession @{status='DRAFT'} $resEtag
$r.Status
# Suspended validation denied: HTTP 403; FORBIDDEN
$r = Invoke-DraftCurl POST "/$resId/validate" $suspendedSession @{} $resEtag
$r.Status
# Other provider validation denied: HTTP 404; LISTING_NOT_FOUND
$r = Invoke-DraftCurl POST "/$resId/validate" $otherSession @{} $resEtag
$r.Status
# Residential validate: HTTP 200; VALIDATE
$r = Invoke-DraftCurl POST "/$resId/validate" $ownerSession @{} $resEtag
$resEtag = $r.Body.listing.etag
$r.Status
# Repeated validate: HTTP 409; LISTING_TRANSITION_CONFLICT
$r = Invoke-DraftCurl POST "/$resId/validate" $ownerSession @{} $resEtag
$r.Status
# Reverse validate to complete: HTTP 409; LISTING_TRANSITION_CONFLICT
$r = Invoke-DraftCurl POST "/$resId/complete" $ownerSession @{} $resEtag
$r.Status
# Reject PATCH DRAFT: HTTP 400; BAD_REQUEST
$r = Invoke-DraftCurl PATCH "/$resId" $ownerSession @{status='DRAFT'} $resEtag
$r.Status
# Reject PATCH COMPLETE: HTTP 400; BAD_REQUEST
$r = Invoke-DraftCurl PATCH "/$resId" $ownerSession @{status='COMPLETE'} $resEtag
$r.Status
# Reject PATCH VALIDATE: HTTP 400; BAD_REQUEST
$r = Invoke-DraftCurl PATCH "/$resId" $ownerSession @{status='VALIDATE'} $resEtag
$r.Status
# Reject PATCH AI_ASSIST: HTTP 400; BAD_REQUEST
$r = Invoke-DraftCurl PATCH "/$resId" $ownerSession @{status='AI_ASSIST'} $resEtag
$r.Status
# Reject PATCH PUBLISHED: HTTP 400; BAD_REQUEST
$r = Invoke-DraftCurl PATCH "/$resId" $ownerSession @{status='PUBLISHED'} $resEtag
$r.Status
# Publication endpoint absent: HTTP 404; NOT_FOUND
$r = Invoke-DraftCurl POST "/$resId/publish" $ownerSession @{} $resEtag
$r.Status
# Own validated read: HTTP 200; VALIDATE
$r = Invoke-DraftCurl GET "/$resId" $ownerSession $null ''
$r.Status
# Other validated read denied: HTTP 404; LISTING_NOT_FOUND
$r = Invoke-DraftCurl GET "/$resId" $otherSession $null ''
$r.Status
# commercial complete: HTTP 200; COMPLETE
$r = Invoke-DraftCurl POST "/$commercialId/complete" $ownerSession @{} $commercialEtag
$commercialEtag = $r.Body.listing.etag
$r.Status
# commercial validate: HTTP 200; VALIDATE
$r = Invoke-DraftCurl POST "/$commercialId/validate" $ownerSession @{} $commercialEtag
$commercialEtag = $r.Body.listing.etag
$r.Status
# land complete: HTTP 200; COMPLETE
$r = Invoke-DraftCurl POST "/$landId/complete" $ownerSession @{} $landEtag
$landEtag = $r.Body.listing.etag
$r.Status
# land validate: HTTP 200; VALIDATE
$r = Invoke-DraftCurl POST "/$landId/validate" $ownerSession @{} $landEtag
$landEtag = $r.Body.listing.etag
$r.Status
Remove-Variable ownerSession,otherSession,adminSession,spareSession,rejectedSession,suspendedSession,rolelessSession -ErrorAction SilentlyContinue
~~~

## Postman

Import [listing-completion.postman_collection.json](postman/listing-completion.postman_collection.json).
Every request includes method, full URL template, headers, body, expected HTTP
status, expected JSON and assertions. Run the collection sequentially.

For desktop use, set baseUrl to http://127.0.0.1:3000/api/v1/listings and keep
ownerToken, otherToken, adminToken, spareToken, rejectedToken, suspendedToken and
rolelessToken in local unsynced variables. Pre-populating ownerToken skips the
test fixture bootstrap. Never sync or export populated credentials.
The executable runner manages and cleans up the isolated fixtures automatically.

## Direct Neon inspection

Use only tracked fixture IDs in a private database session:
~~~sql
SELECT id, "providerId", status, "publishedAt" IS NULL AS unpublished,
       "titleEn", "descriptionEn", "titleAm", "descriptionAm", "locationId",
       price, currency, bedrooms, bathrooms, "areaSqm", "updatedAt", "deletedAt"
FROM akgebeya.listings WHERE id = '<fixture-listing-uuid>'::uuid;

SELECT count(*) AS payment_rows FROM akgebeya.payments
WHERE "listingId" = '<fixture-listing-uuid>'::uuid;
SELECT count(*) AS media_rows FROM akgebeya.media
WHERE "listingId" = '<fixture-listing-uuid>'::uuid;
~~~

Compare before/after rows privately: failed completion stays DRAFT; successful
completion stores COMPLETE; validation stores VALIDATE; providerId and property
content remain unchanged. publishedAt remains NULL. Amharic stays NULL if omitted.
No payment/media/publication/generated content is created. After the runner,
tracked fixtures must no longer exist. Never delete untracked production data.

## Required regression gate

Prisma validate/generate, migration status, drift check, typecheck, all backend
tests, all live database tests, both listing manual suites, build, npm audit,
working-tree credential scan, git diff review and staged credential scan must pass
before commit/push. No later lifecycle stage is part of this task.
