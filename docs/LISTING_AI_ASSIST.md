# Listing AI Assist (Step 4.8)

## Scope and API

POST /api/v1/listings/:listingId/ai-assist is the only new action.
It permits VALIDATE -> AI_ASSIST only. The existing private GET returns the
owner's AI_ASSIST listing. PATCH still rejects all lifecycle fields.
No preview, payment, publication, public listing API, uploads or later stages.

Requests require a database-backed bearer session and the current quoted ETag in
If-Match. Body may be absent or exactly {} with Content-Type: application/json.
URL parameters, query and body are validated; no listing facts are accepted in
the action body. Unknown/malformed input returns 400. Missing If-Match returns
428; malformed If-Match 400; stale revision 412. The provider must be owned,
have an approved role, current approved verification and ACTIVE status.
Missing/deleted/other-provider listings return 404. Unauthorized provider states
return 403. Incorrect lifecycle or existing payment/media returns 409.

The service first locks and reads the owned listing, checks current provider
authorization, completeness, state and revision, and constructs an explicit
allowlist of stored facts. That transaction ends before Gemini is called.
After strict output validation, a second short transaction locks the provider,
listing and referenced location; rechecks authorization, state, ETag and source
facts; writes only the four text fields plus AI_ASSIST; advances updatedAt.
Shared location changes are detected even if the listing ETag did not change.
Concurrent attempts with the same revision may both generate, but exactly one
can persist. External calls are never retried. No new revision column or index.

## Configuration and production client

Privately configure GEMINI_API_KEY and GEMINI_MODEL in ignored apps/backend/.env
or deployment environment. Do not put values in .env.example, Postman or Git.
The centralized parser requires both or neither; absent configuration causes a
safe 503 for this action. Model names must be Gemini model IDs, without models/.
Keys support current auth-key characters, including periods. No model or secret
is defaulted. Request timeout is 60 seconds, with a 128 KiB response limit.

The production implementation uses Node fetch against the fixed Google
generateContent endpoint, with x-goog-api-key in a backend-only header.
Redirects are rejected. The response must contain one successfully finished
text candidate. Documented thoughtSignature metadata is accepted in the Google
envelope and discarded; it is never returned or persisted. Unit tests inject
deterministic ListingAiClient implementations
or a fake HTTP transport; they never call Google. No new dependency is needed.
Prisma remains 6.12.0.

References: [Google API](https://ai.google.dev/api/generate-content),
[structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[API keys](https://ai.google.dev/gemini-api/docs/api-key).

## Output, prompting and failures

A strict Zod object requires exactly titleEn, titleAm, descriptionEn,
descriptionAm. Nonblank strings only; titles at most 200 characters,
descriptions at most 10000. Control/format characters, markdown fences,
malformed JSON, wrong scripts and unexpected fields are rejected.
English fields require Latin letters; Amharic fields require Ethiopic letters
and reject letters from other scripts. Digits/punctuation are permitted.
Script checks are not a general semantic language or factual-accuracy proof;
the real manual content review remains required.

The fixed system instruction asks for short factual Ethiopian real-estate copy,
separate languages, preserved numbers and no invented amenities, locations,
legal/payment claims, urgency or discrimination. Structured facts are
authoritative. Provider text and all location strings are untrusted DATA in a
separate JSON message, never system instructions. No tool execution exists.
No input includes user identity, provider identity, credentials or private
verification documents. Prompt injection cannot change the write allowlist or
lifecycle rules; prompts alone cannot guarantee arbitrary generated prose is
factually correct.

Errors are fixed JSON, with no upstream message/body, key, headers or content:

| HTTP | error.code | error.message |
| --- | --- | --- |
| 502 | AI_OUTPUT_INVALID | Listing assistance returned unusable content |
| 503 | AI_UNAVAILABLE | Listing assistance is unavailable |
| 504 | AI_TIMEOUT | Listing assistance timed out |
| 429 | AI_RATE_LIMITED | Listing assistance is busy; try later |

On failure, listing state/content remain unchanged. AI output becomes database
content only after parsing, validation and the final atomic recheck.

Success: HTTP 200 with ETag and Cache-Control: no-store. JSON:
```json
{
  "listing": {
    "id": "<owned UUID>",
    "status": "AI_ASSIST",
    "etag": "\"<new revision>\"",
    "titleEn": "<English title>",
    "titleAm": "<Amharic title>",
    "descriptionEn": "<English description>",
    "descriptionAm": "<Amharic description>",
    "category": "<unchanged category>",
    "type": "<unchanged purpose>",
    "propertyType": "<unchanged type>",
    "price": "<unchanged decimal string>",
    "currency": "ETB",
    "bedrooms": null,
    "bathrooms": null,
    "areaSqm": null,
    "location": "<unchanged location object>",
    "createdAt": "<unchanged timestamp>",
    "updatedAt": "<advanced timestamp>"
  }
}
```

Nullable dimensions above reflect an example listing; supplied dimensions are
preserved. Provider ID and payment/media records are not response fields.

## Migration

One new listing_ai_assist migration adds AI_ASSIST to the existing status enum.
No applied migration is edited. DRAFT, COMPLETE, VALIDATE and AI_ASSIST require
publishedAt NULL. AI_ASSIST additionally requires titleAm and descriptionAm;
existing nonblank content and non-DRAFT English completeness checks remain.
The PUBLISHED check, columns/defaults, indexes/FKs and existing rows remain.
The application schema has 48 indexes and 37 CHECKs.
The migration verifier hashes all existing application/legacy table contents
and unaffected catalog metadata in memory before and after deployment.
Database behavior tests roll back their fixtures.

## Executable curl and Postman verification

From apps/backend, after configuring the development Neon database and Gemini:

```powershell
npm run build
node --import tsx scripts/verify-ai.ts --curl --review
node --import tsx scripts/verify-ai.ts --postman --review
```

These commands run the actual built backend, create temporary database-backed
actors using existing authentication/provider services, execute the scenarios
below, inspect Neon, and remove tracked fixtures. ADMIN authorization is from
database state. Session values stay in memory and curl stdin. Postman uses the
existing private loopback fixture bootstrap with unsynced runtime variables and
--no-report-events --silent; temporary bootstrap settings in .git are removed.
The API key is never passed to curl/Postman.

Each mode makes one real Gemini generation. Neither mode can pass with only a
synthetic success. The separate local failure-simulation app injects malformed
and unavailable clients to check 502/503 with no database mutation. There is no
production test switch or extra endpoint.

The --review option writes ONLY application text from the synthetic property
fixture to .git/ai-review-curl.txt or .git/ai-review-postman.txt, never raw Gemini
envelopes, credentials or real user records. Privately inspect these copies:
English/Amharic separated; only supplied property facts; price 100.00 ETB,
2 bedrooms, 1 bathroom, 80.00 sqm, Addis Ababa; no other amenities/location,
urgency, legal/payment claims or markdown/JSON artifacts. The numerical check
in the runner supplements, and does not replace, this manual semantic review.
Delete these two exact local review files after inspection.

Import [listing-ai-assist.postman_collection.json](postman/listing-ai-assist.postman_collection.json).
Every request includes its method, URL, headers, body, expected HTTP/JSON and
assertions. For desktop use, baseUrl defaults to
http://127.0.0.1:3000/api/v1/listings. Provide ownerToken, otherToken, adminToken,
spareToken, rejectedToken, suspendedToken and rolelessToken as local unsynced
session variables. A populated ownerToken skips test fixture bootstrap.
Do not export or sync populated tokens. Run the collection sequentially.

## Exact curl requests

The following PowerShell helper keeps the session and If-Match out of process
arguments. Populate session variables privately using legitimate development
sessions. Do not paste tokens into command history. The executable runner above
supplies all actors automatically and is the recommended reproducible method.

```powershell
function Invoke-AiCurl {
  param([string]$Method, [string]$Path, [string]$Session = '', $Body = $null, [string]$Match = '')
  $lines = @(('request = "' + $Method + '"'))
  if ($Session) { $lines += 'header = ' + (ConvertTo-Json -InputObject ("Authorization: Bearer " + $Session) -Compress) }
  if ($Match) { $lines += 'header = ' + (ConvertTo-Json -InputObject ("If-Match: " + $Match) -Compress) }
  if ($null -ne $Body) {
    $lines += 'header = "Content-Type: application/json"'
    $lines += 'data = ' + (ConvertTo-Json -InputObject (ConvertTo-Json -InputObject $Body -Depth 5 -Compress) -Compress)
  }
  $raw = ($lines -join [char]10) | curl.exe --silent --show-error --max-time 90 --config - --write-out ([char]10 + '%{http_code}') ("http://127.0.0.1:3000/api/v1/listings" + $Path)
  if ($LASTEXITCODE -ne 0) { throw 'curl failed' }
  $text = $raw -join [char]10
  $split = $text.LastIndexOf([char]10)
  [pscustomobject]@{ Status = [int]$text.Substring($split + 1); Body = ($text.Substring(0, $split) | ConvertFrom-Json) }
}
```

```powershell
# Create test draft: HTTP 201; DRAFT
$r = Invoke-AiCurl POST "" $ownerSession @{category='RESIDENTIAL';type='SALE';propertyType='HOUSE';titleEn='House for sale in Addis Ababa';descriptionEn='House in Addis Ababa.';price='100.00';bedrooms=2;bathrooms=1;areaSqm='80.00';location=@{regionEn='Addis Ababa';cityEn='Addis Ababa'}} ''
$id = $r.Body.listing.id
$revision = $r.Body.listing.etag
$initialRevision = $r.Body.listing.etag
$r.Status
# Unauthenticated: HTTP 401; UNAUTHORIZED
$r = Invoke-AiCurl POST "/$id/ai-assist" '' $null ''
$r.Status
# admin denied: HTTP 403; FORBIDDEN
$r = Invoke-AiCurl POST "/$id/ai-assist" $adminSession $null $revision
$r.Status
# spare denied: HTTP 403; FORBIDDEN
$r = Invoke-AiCurl POST "/$id/ai-assist" $spareSession $null $revision
$r.Status
# rejected denied: HTTP 403; FORBIDDEN
$r = Invoke-AiCurl POST "/$id/ai-assist" $rejectedSession $null $revision
$r.Status
# suspended denied: HTTP 403; FORBIDDEN
$r = Invoke-AiCurl POST "/$id/ai-assist" $suspendedSession $null $revision
$r.Status
# roleless denied: HTTP 403; FORBIDDEN
$r = Invoke-AiCurl POST "/$id/ai-assist" $rolelessSession $null $revision
$r.Status
# Other provider denied: HTTP 404; LISTING_NOT_FOUND
$r = Invoke-AiCurl POST "/$id/ai-assist" $otherSession $null $revision
$r.Status
# DRAFT denied: HTTP 409; LISTING_TRANSITION_CONFLICT
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession $null $revision
$r.Status
# Complete fixture: HTTP 200; COMPLETE
$r = Invoke-AiCurl POST "/$id/complete" $ownerSession @{} $revision
$revision = $r.Body.listing.etag
$r.Status
# COMPLETE denied: HTTP 409; LISTING_TRANSITION_CONFLICT
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession $null $revision
$r.Status
# Validate fixture: HTTP 200; VALIDATE
$r = Invoke-AiCurl POST "/$id/validate" $ownerSession @{} $revision
$revision = $r.Body.listing.etag
$r.Status
# Missing If-Match: HTTP 428; PRECONDITION_REQUIRED
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession $null ''
$r.Status
# Malformed If-Match: HTTP 400; BAD_REQUEST
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession $null '*'
$r.Status
# Stale If-Match: HTTP 412; PRECONDITION_FAILED
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession $null $initialRevision
$r.Status
# Reject supplied price: HTTP 400; BAD_REQUEST
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession @{price='1'} $revision
$r.Status
# Reject supplied status: HTTP 400; BAD_REQUEST
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession @{status='AI_ASSIST'} $revision
$r.Status
# Reject supplied providerId: HTTP 400; BAD_REQUEST
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession @{providerId='injected'} $revision
$r.Status
# Reject supplied location: HTTP 400; BAD_REQUEST
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession @{location=@{cityEn='invented'}} $revision
$r.Status
# Reject direct lifecycle PATCH: HTTP 400; BAD_REQUEST
$r = Invoke-AiCurl PATCH "/$id" $ownerSession @{status='AI_ASSIST'} $revision
$r.Status
# Real Gemini assistance: HTTP 200; AI_ASSIST
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession $null $revision
$revision = $r.Body.listing.etag
$r.Status
# Repeated assistance: HTTP 409; LISTING_TRANSITION_CONFLICT
$r = Invoke-AiCurl POST "/$id/ai-assist" $ownerSession $null $revision
$r.Status
# Read assisted listing: HTTP 200; AI_ASSIST
$r = Invoke-AiCurl GET "/$id" $ownerSession $null ''
$r.Status
# Other provider cannot read assisted listing: HTTP 404; LISTING_NOT_FOUND
$r = Invoke-AiCurl GET "/$id" $otherSession $null ''
$r.Status
# No publication action: HTTP 404; NOT_FOUND
$r = Invoke-AiCurl POST "/$id/publish" $ownerSession $null $revision
$r.Status
Remove-Variable ownerSession,otherSession,adminSession,spareSession,rejectedSession,suspendedSession,rolelessSession -ErrorAction SilentlyContinue
```

## Direct Neon inspection and cleanup

The runner compares complete database rows before/after failed curl actions and
compares all nontext/nonstate facts on successful assistance. It verifies correct
provider ownership, unchanged category/type/propertyType/price/dimensions and
location, AI_ASSIST state, bilingual fields, publishedAt NULL and no payment/media.
The live test also checks updates during generation and concurrent assistance.
Outer fixture cleanup verifies existing provider and authentication data digests.

For a manually tracked fixture in a private Neon session:

```sql
SELECT status, "providerId", category, type, "propertyType", price, currency,
       bedrooms, bathrooms, "areaSqm", "locationId",
       "publishedAt" IS NULL AS unpublished,
       "titleEn" IS NOT NULL AS english_title,
       "titleAm" IS NOT NULL AS amharic_title,
       "descriptionEn" IS NOT NULL AS english_description,
       "descriptionAm" IS NOT NULL AS amharic_description
FROM akgebeya.listings WHERE id = '<tracked fixture UUID>'::uuid;
SELECT count(*) FROM akgebeya.payments WHERE "listingId" = '<tracked fixture UUID>'::uuid;
SELECT count(*) FROM akgebeya.media WHERE "listingId" = '<tracked fixture UUID>'::uuid;
```

Do not delete untracked records. The automated/manual fixture helpers remove only
their recorded temporary listings, locations, users, providers and sessions in
finally blocks, including on failure.

## Final gate

Prisma validate/generate, migration status, drift, typecheck, all backend tests,
live Neon tests, build, audit, curl/Postman, real Gemini content review, direct
database inspection, fixture cleanup, credential scans, git status/diff and
staged scan must pass before commit/push. No later feature is included.

## Verified development run

On 2026-09-12, curl and Postman each passed all 25 cases against the built
backend, including one real Gemini generation per mode. Both generated copies
were visually reviewed for separate English/Amharic, correct supplied price,
rooms, area and Addis Ababa location, with no added amenities or markup.
Direct Neon checks passed, controlled 502/503 failures left records unchanged,
and tracked fixtures plus local content-review artifacts were removed.
No credential or raw Gemini response is included in this repository.
