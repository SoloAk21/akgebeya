# Listing Fee Calculation (Step 4.10)

AkGebeya V1 listing publication fee: **500 ETB flat fee**. Authoritative representation: **50000 integer minor units**, currency **ETB**, pricingVersion **v1**. One ETB equals 100 minor units under the existing Payment convention.

The same fee applies to OWNER, BROKER, AGENT, AGENCY and DEVELOPER; SALE, RENT, BUY_REQUEST and RENT_REQUEST; RESIDENTIAL, COMMERCIAL and LAND; and every approved PropertyType. No discounts, credits, coupons, promotions, taxes, VAT, percentages, tiers or other adjustments are applied in Step 4.10.

## Contract

POST http://127.0.0.1:3000/api/v1/listings/:listingId/calculate-fee

Only PREVIEW -> CALCULATE_FEE is allowed. Authorization: Bearer <existing session> and the exact quoted If-Match from private GET are required. Body may be absent or exactly {} with Content-Type: application/json. Client amount, currency, version, pricing inputs, providerId or status are rejected by strict Zod validation.

Successful HTTP 200 body:

```json
{"listingId":"<UUID>","status":"CALCULATE_FEE","fee":{"amountMinor":"50000","currency":"ETB","pricingVersion":"v1"},"etag":"<quoted revision>"}
```

The response ETag equals etag. Responses are private: Cache-Control: no-store, Vary: Authorization. Existing GET /api/v1/listings/:listingId returns the authorized owner's listing plus the safe fee object after calculation, without exposing quote internals. No new public or quote-list endpoint exists.

## Authoritative quote and transaction

ListingFeeQuote is separate from Payment. It has a UUID primary key, unique listingId FK, BigInt amountMinor, ETB currency, pricingVersion, sourceRevision, calculatedAt and createdAt. sourceRevision is the exact quoted 64-lowercase-hex ETag of the PREVIEW listing, not the newly advanced CALCULATE_FEE ETag. No JSON input snapshot is necessary: V1 has no variable pricing inputs; the immutable version and amount fully identify the approved flat rule. No personal information is copied into the quote.

The quote does not expire and is never automatically repriced. Quote updates are rejected by a database trigger. The endpoint never replaces a quote or resets its timestamps. Later payment initiation must reference the exact quote and verify its listing, amount and currency; Payment integration is outside this step.

One locked transaction rechecks the current owned, verified ACTIVE provider with valid role; locks the nondeleted listing and shared location; checks PREVIEW and If-Match; revalidates completeness, taxonomy, positive listing price/ETB, bilingual content, numeric constraints and publishedAt NULL; inserts the fixed 50000n quote; changes status; advances the existing microsecond updatedAt revision; commits. No JavaScript floating-point money arithmetic or external network call is used.

Unique listingId prevents duplicate quotes. Deferred database constraints require quote/state agreement at commit. A failure after either write rolls back both. Old ETag retry returns 412; repeat with current ETag returns 409. This is a one-time action with duplicate effects prevented, not a repricing endpoint.

## Migration

One new listing_fee_calculation migration adds CALCULATE_FEE while preserving all existing statuses. It extends unpublished/bilingual checks, creates the quote table, and adds exact-V1/revision/timestamp checks plus immutability and deferred state-consistency triggers. No existing rows are changed or backfilled. Existing indexes/FKs/checks remain. There are 12 application tables, 50 indexes and 40 CHECKs. Quotes intentionally have no mutable updatedAt or expiry field. Prisma remains 6.12.0.

Migration preservation uses the existing scripts/verify-ai-migration.ts --fee runner: existing table records and unaffected catalog objects are compared in memory before/after deployment. New quote objects are checked by fee-schema live tests. No applied migration is edited. The current consistency trigger permits quotes only in CALCULATE_FEE; a later approved lifecycle migration must extend that rule when introducing payment states.

## No payment or publication

This step does not call Chapa, create Payment rows, generate tx_ref/checkout URLs, verify payment, publish listings, or call Gemini. Existing listing ownership, property facts and bilingual content are preserved. Existing Media is untouched.

## Automated and manual verification

From apps/backend:

    npm run typecheck
    npm test
    npm run test:database
    npm run build
    node --import tsx scripts/verify-fee.ts

The manual runner executes actual curl and Postman CLI against the built backend, with Gemini disabled. It provisions temporary database-backed sessions/providers, prepares a stored bilingual fixture and performs the real preview transition. No production bypass endpoint exists. It checks database rows directly after requests and removes only tracked fixtures in finally blocks. Quote and listing cleanup runs in one transaction to respect deferred constraints. No session token is printed, placed in command arguments, or committed.

Import docs/postman/listing-fee.postman_collection.json. For interactive Postman use local unsynced ownerToken, otherToken, adminToken (no provider), spareToken (unverified), rejectedToken, suspendedToken and rolelessToken variables plus id for an owned PREVIEW listing. Default baseUrl is http://127.0.0.1:3000/api/v1/listings. Never export populated credentials. The automated runner uses the existing private loopback bootstrap to supply them only in memory. Each request includes headers/body, expected status/JSON, and assertions.

Unit tests exercise all 320 role/purpose/property combinations, auth, malformed/tampered inputs, stale/concurrent calls, invalid stored fields and zero Gemini calls. Neon tests check constraints, exact source revision, concurrent one-quote creation, and a controlled failure after both writes proving complete rollback. Existing auth/provider/listing regression suites also run. There is no Chapa implementation or call path.

## Exact curl checks (PowerShell)

Reuse Invoke-PreviewCurl from LISTING_PREVIEW.md: it supplies headers via curl stdin, prints only status, and returns parsed JSON into $result. Use private session variables, never literal tokens in command history. Set $id to an owned temporary PREVIEW fixture. Commands below target http://127.0.0.1:3000/api/v1/listings. Each response example is included in the importable Postman collection. Error responses use {error:{code,message}}; successful calculate-fee uses the exact fee response above; private GET/fixture preparation uses {listing:...}.

### Read stored PREVIEW fixture

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected 200; listing.status = PREVIEW.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $ownerToken $null $null
$revision = $result.listing.etag
$initialRevision = $result.listing.etag
```

### Unauthenticated fee calculation

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 401; {"error":{"code":"UNAUTHORIZED","message":"Authentication required"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $null $null $null
```

### admin denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 403; {"error":{"code":"FORBIDDEN","message":"Access denied"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $adminToken $revision $null
```

### spare denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 403; {"error":{"code":"FORBIDDEN","message":"Access denied"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $spareToken $revision $null
```

### rejected denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 403; {"error":{"code":"FORBIDDEN","message":"Access denied"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $rejectedToken $revision $null
```

### suspended denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 403; {"error":{"code":"FORBIDDEN","message":"Access denied"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $suspendedToken $revision $null
```

### roleless denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 403; {"error":{"code":"FORBIDDEN","message":"Access denied"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $rolelessToken $revision $null
```

### Other provider fee calculation denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 404; {"error":{"code":"LISTING_NOT_FOUND","message":"Listing not found"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $otherToken $revision $null
```

### Missing If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 428; {"error":{"code":"PRECONDITION_REQUIRED","message":"If-Match is required"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $null $null
```

### Malformed If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken '*' $null
```

### Stale If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 412; {"error":{"code":"PRECONDITION_FAILED","message":"Listing changed; retrieve it again"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken '"0000000000000000000000000000000000000000000000000000000000000000"' $null
```

### Reject supplied price

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision '{"price":"1"}'
```

### Reject supplied status

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision '{"status":"CALCULATE_FEE"}'
```

### Reject supplied providerId

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision '{"providerId":"injected"}'
```

### Reject supplied amountMinor

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision '{"amountMinor":1}'
```

### Reject supplied currency

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision '{"currency":"USD"}'
```

### Reject supplied pricingVersion

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision '{"pricingVersion":"hacked"}'
```

### Reject supplied pricingInputSnapshot

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision '{"pricingInputSnapshot":{"providerRole":"OWNER"}}'
```

### Create separate draft

POST http://127.0.0.1:3000/api/v1/listings

Expected 201; listing.status = DRAFT.

```powershell
$result = Invoke-PreviewCurl POST "" $ownerToken $null '{"category":"RESIDENTIAL","type":"SALE","propertyType":"HOUSE","titleEn":"Completion fixture","descriptionEn":"Private completion verification fixture","price":"100.00","location":{"regionEn":"Addis Ababa","cityEn":"Addis Ababa"}}'
$draftId = $result.listing.id
$draftEtag = $result.listing.etag
```

### DRAFT cannot fee calculation

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/calculate-fee

Expected 409; {"error":{"code":"LISTING_TRANSITION_CONFLICT","message":"Listing cannot make this transition"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/calculate-fee" $ownerToken $draftEtag $null
```

### Complete separate fixture

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/complete

Expected 200; listing.status = COMPLETE.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/complete" $ownerToken $draftEtag '{}'
$draftEtag = $result.listing.etag
```

### COMPLETE cannot fee calculation

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/calculate-fee

Expected 409; {"error":{"code":"LISTING_TRANSITION_CONFLICT","message":"Listing cannot make this transition"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/calculate-fee" $ownerToken $draftEtag $null
```

### Validate separate fixture

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/validate

Expected 200; listing.status = VALIDATE.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/validate" $ownerToken $draftEtag '{}'
$draftEtag = $result.listing.etag
```

### VALIDATE cannot fee calculation

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/calculate-fee

Expected 409; {"error":{"code":"LISTING_TRANSITION_CONFLICT","message":"Listing cannot make this transition"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/calculate-fee" $ownerToken $draftEtag $null
```

### Calculate fee stored bilingual listing

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 200; CALCULATE_FEE and fee {"amountMinor":"50000","currency":"ETB","pricingVersion":"v1"}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision $null
$revision = $result.etag
```

### Repeated fee calculation denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 409; {"error":{"code":"LISTING_TRANSITION_CONFLICT","message":"Listing cannot make this transition"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $revision $null
```

### Old revision denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/calculate-fee

Expected 412; {"error":{"code":"PRECONDITION_FAILED","message":"Listing changed; retrieve it again"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/calculate-fee" $ownerToken $initialRevision $null
```

### Read private fee calculation

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected 200; CALCULATE_FEE and fee {"amountMinor":"50000","currency":"ETB","pricingVersion":"v1"}.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $ownerToken $null $null
```

### Other provider cannot read fee calculation

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected 404; {"error":{"code":"LISTING_NOT_FOUND","message":"Listing not found"}}.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $otherToken $null $null
```

### Reject PATCH CALCULATE_FEE

PATCH http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision '{"status":"CALCULATE_FEE"}'
```

### Reject PATCH PUBLISHED

PATCH http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision '{"status":"PUBLISHED"}'
```

### Reject PATCH DRAFT

PATCH http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected 400; {"error":{"code":"BAD_REQUEST","message":"Invalid request"}}.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision '{"status":"DRAFT"}'
```

### No publication endpoint

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Expected 404; {"error":{"code":"NOT_FOUND","message":"Route not found"}}.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision $null
```

## Neon inspection and cleanup

The runner verifies exactly one quote with 50000/ETB/v1 and sourceRevision equal to the pre-calculation ETag, CALCULATE_FEE status, unchanged providerId/category/type/propertyType/price/locationId and all bilingual fields, publishedAt NULL, and unchanged Payment/Media snapshots. Rejected requests leave both listing and quote unchanged. Authentication/provider fixture digests must match. All temporary quote/listing/location/provider/user/session/review records are cleaned.

For private console inspection while a tracked fixture exists:

```sql
SELECT l.status, l."publishedAt" IS NULL AS unpublished,
 q."amountMinor", q.currency, q."pricingVersion", q."sourceRevision", q."calculatedAt"
FROM akgebeya.listings l JOIN akgebeya.listing_fee_quotes q ON q."listingId"=l.id
WHERE l.id='<tracked fixture UUID>'::uuid;
SELECT count(*) FROM akgebeya.listing_fee_quotes WHERE "listingId"='<tracked fixture UUID>'::uuid;
SELECT count(*) FROM akgebeya.payments WHERE "listingId"='<tracked fixture UUID>'::uuid;
```

Expect CALCULATE_FEE, unpublished true, 50000, ETB, v1, the original quoted ETag, one quote and zero payments. After runner cleanup both listing and quote are absent. Do not delete untracked records or print session/identity data.
