# Payment verification and paid publication (Steps 4.12-4.13)

POST /api/v1/listings/:listingId/payment/verify verifies the existing stored Chapa transaction reference. POST /api/v1/listings/:listingId/publish publishes only from VERIFY_PAYMENT. Both require an authenticated, owned, verified ACTIVE provider with a valid role; ownership is never supplied in the body. The publication action additionally requires the exact quoted If-Match from the latest private listing response.

Bodies must be absent or exactly {}. Unknown body/query fields are rejected. A callback or return redirect is never proof of payment. There are no webhook, public listing, refund, worker or replacement-payment endpoints.

Verification uses GET https://api.chapa.co/v1/transaction/verify/{stored_tx_ref} outside database transactions. Response JSON is bounded, validated and reduced to transaction status, reference, integer amount and currency. Outer API success is not payment success. Only a matching transaction success for the immutable quote (50000 minor units, ETB, v1) can set SUCCEEDED and paidAt. The service reloads the owned listing, provider, quote and payment under locks after the network call. Local user/provider ownership is established from the immutable reservation; gateway profile fields are discarded.

Verification does not require If-Match because it reconciles one immutable payment attempt. The service captures/rechecks the listing revision internally. Concurrent verification may issue more than one read-only Chapa GET; it never initializes another payment. A duplicate successful verification returns existing state without changing paidAt or calling Chapa again. Pending results do not downgrade FAILED or SUCCEEDED. Matched failed results set FAILED; a later matching success may reconcile that same attempt. Mismatch/timeout/non-200/malformed response returns a safe 502 and establishes no success. Chapa's documented unpaid/not-found 404 is treated as unresolved, not definitive failure. There are no automatic network retries.

RESERVED/UNKNOWN attempts keep their initialization history and nullable checkout URL when reconciled. Matching success moves CALCULATE_FEE or PAYMENT to VERIFY_PAYMENT atomically with SUCCEEDED and a safe current database-server paidAt. Unsuccessful reconciliation leaves listing state unchanged. Publication separately rechecks current provider authorization, ownership, bilingual completeness, taxonomy, location, numeric constraints, quote/payment binding and successful proof. One short transaction sets PUBLISHED and publishedAt and advances the existing microsecond ETag revision. Stale publication returns 412; repeated publication with the current ETag returns 409. No Gemini, new Payment, repricing or media mutation occurs.

## Database migration

One new payment_verification_publication migration adds VERIFY_PAYMENT and updates scoped checks/triggers. No tables, columns or indexes are added. Existing binding/quote immutability and uniqueness remain. VERIFY_PAYMENT is unpublished; VERIFY_PAYMENT/PUBLISHED require bilingual content and the authoritative SUCCEEDED payment. Successful payment proof and publication timestamps cannot be reset. Direct publication must enter from VERIFY_PAYMENT. Existing PUBLISHED rows cause migration preflight to abort for review; no historical payment proof is fabricated. Existing applied migrations and Prisma 6.12.0 remain unchanged.

## Safe response shapes

Verification success: {listingId,status:"VERIFY_PAYMENT",payment:{status:"SUCCEEDED",amountMinor:"50000",currency:"ETB",paidAt:"<server ISO timestamp>"},publishedAt:null,etag:"<quoted revision>"}.

Publication success: same allowlisted representation with status:"PUBLISHED" and publishedAt:"<server ISO timestamp>". Pending/failed verification returns HTTP 200 with the actual persisted payment state and unchanged unpublished listing state. Errors use {error:{code,message}}; completeness errors additionally contain safe fields. Responses are no-store and vary on Authorization. No tx_ref, checkout URL, idempotency key, account identities, raw gateway response or secrets are returned by these endpoints.

## Local deterministic manual verification

From apps/backend:

    npm run typecheck
    npm test
    npm run test:database
    npm run build
    node --import tsx scripts/verify-publication.ts

The runner executes real curl and Postman CLI against Express and Neon using temporary database-backed sessions and a deterministic Chapa verifier. It asserts every expected HTTP status and inspects Neon directly, then cleans fixtures in finally blocks. Tokens are passed privately via curl stdin or the existing ephemeral loopback Postman bootstrap. No tokens are printed or committed. This does not count as real Chapa TEST verification.

Import docs/postman/chapa-payment-verification-publication.postman_collection.json. Keep ownerToken/otherToken/adminToken/spareToken/rejectedToken/suspendedToken/rolelessToken private in an unsynced local environment. Set id to a disposable owned initialized PAYMENT listing. The collection captures revisions and tests the cases below in sequence. Never export populated tokens.

## Exact curl cases

Use Invoke-PreviewCurl from LISTING_PREVIEW.md, which targets http://127.0.0.1:3000/api/v1/listings and sends Authorization/If-Match privately through stdin. Keep session variables in memory. Replace {{id}} and {{revision}} with the local fixture ID and captured quoted ETag. Each command returns parsed JSON into $result; do not print sensitive authentication responses.

### Read initialized listing

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Headers: Authorization: Bearer {{ownerToken}}. Body: none.

Expected HTTP 200: `{"listing":{"status":"PAYMENT","etag":"<quoted revision>"}}`.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $ownerToken $null $null
$revision = $result.listing.etag
$initialRevision = $result.listing.etag
```

### Unauthenticated payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: none. Body: none.

Expected HTTP 401: `{"error":{"code":"UNAUTHORIZED","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $null $null $null
```

### admin denied payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{adminToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $adminToken $revision $null
```

### spare denied payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{spareToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $spareToken $revision $null
```

### rejected denied payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{rejectedToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $rejectedToken $revision $null
```

### suspended denied payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{suspendedToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $suspendedToken $revision $null
```

### roleless denied payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{rolelessToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $rolelessToken $revision $null
```

### other denied payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{otherToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 404: `{"error":{"code":"LISTING_NOT_FOUND","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $otherToken $revision $null
```

### Reject amountMinor on payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"amountMinor":1}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $revision '{"amountMinor":1}'
```

### Reject currency on payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"currency":"USD"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $revision '{"currency":"USD"}'
```

### Reject tx_ref on payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"tx_ref":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $revision '{"tx_ref":"injected"}'
```

### Reject status on payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"status":"SUCCEEDED"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $revision '{"status":"SUCCEEDED"}'
```

### Reject userId on payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"userId":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $revision '{"userId":"injected"}'
```

### Reject providerId on payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"providerId":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $revision '{"providerId":"injected"}'
```

### Reject listingId on payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"listingId":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $revision '{"listingId":"injected"}'
```

### Reject feeQuoteId on payment/verify

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"feeQuoteId":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $revision '{"feeQuoteId":"injected"}'
```

### Unauthenticated publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: none. Body: none.

Expected HTTP 401: `{"error":{"code":"UNAUTHORIZED","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $null $null $null
```

### admin denied publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{adminToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $adminToken $revision $null
```

### spare denied publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{spareToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $spareToken $revision $null
```

### rejected denied publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{rejectedToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $rejectedToken $revision $null
```

### suspended denied publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{suspendedToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $suspendedToken $revision $null
```

### roleless denied publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{rolelessToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 403: `{"error":{"code":"FORBIDDEN","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $rolelessToken $revision $null
```

### other denied publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{otherToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 404: `{"error":{"code":"LISTING_NOT_FOUND","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $otherToken $revision $null
```

### Reject amountMinor on publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"amountMinor":1}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision '{"amountMinor":1}'
```

### Reject currency on publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"currency":"USD"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision '{"currency":"USD"}'
```

### Reject tx_ref on publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"tx_ref":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision '{"tx_ref":"injected"}'
```

### Reject status on publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"status":"SUCCEEDED"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision '{"status":"SUCCEEDED"}'
```

### Reject userId on publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"userId":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision '{"userId":"injected"}'
```

### Reject providerId on publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"providerId":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision '{"providerId":"injected"}'
```

### Reject listingId on publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"listingId":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision '{"listingId":"injected"}'
```

### Reject feeQuoteId on publish

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"feeQuoteId":"injected"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision '{"feeQuoteId":"injected"}'
```

### Unpaid publication denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 409: `{"error":{"code":"LISTING_TRANSITION_CONFLICT","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision $null
```

### Verify authoritative payment

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}. Body: none.

Expected HTTP 200: `{"listingId":"<UUID>","status":"VERIFY_PAYMENT","payment":{"status":"SUCCEEDED","amountMinor":"50000","currency":"ETB","paidAt":"<server timestamp>"},"publishedAt":null,"etag":"<quoted revision>"}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $null $null
$revision = $result.etag
```

### Duplicate verification

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}. Body: none.

Expected HTTP 200: `{"listingId":"<UUID>","status":"VERIFY_PAYMENT","payment":{"status":"SUCCEEDED","amountMinor":"50000","currency":"ETB","paidAt":"<server timestamp>"},"publishedAt":null,"etag":"<quoted revision>"}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $null $null
```

### Publication missing If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}. Body: none.

Expected HTTP 428: `{"error":{"code":"PRECONDITION_REQUIRED","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $null $null
```

### Publication malformed If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: invalid. Body: none.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken 'invalid' $null
```

### Publication stale If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{initialRevision}}. Body: none.

Expected HTTP 412: `{"error":{"code":"PRECONDITION_FAILED","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $initialRevision $null
```

### Publish verified listing

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 200: `{"listingId":"<UUID>","status":"PUBLISHED","payment":{"status":"SUCCEEDED","amountMinor":"50000","currency":"ETB","paidAt":"<server timestamp>"},"publishedAt":"<server timestamp>","etag":"<quoted revision>"}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision $null
$revision = $result.etag
```

### Repeated publication

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}. Body: none.

Expected HTTP 409: `{"error":{"code":"LISTING_TRANSITION_CONFLICT","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision $null
```

### Verify after publication

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify

Headers: Authorization: Bearer {{ownerToken}}. Body: none.

Expected HTTP 200: `{"listingId":"<UUID>","status":"PUBLISHED","payment":{"status":"SUCCEEDED","amountMinor":"50000","currency":"ETB","paidAt":"<server timestamp>"},"publishedAt":"<server timestamp>","etag":"<quoted revision>"}`.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $null $null
```

### Direct publication PATCH denied

PATCH http://127.0.0.1:3000/api/v1/listings/{{id}}

Headers: Authorization: Bearer {{ownerToken}}; If-Match: {{revision}}; Content-Type: application/json. Body: {"status":"PUBLISHED"}.

Expected HTTP 400: `{"error":{"code":"BAD_REQUEST","message":"<safe fixed message>"}}`.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision '{"status":"PUBLISHED"}'
```

## Real Chapa TEST verification

Configure CHAPA_SECRET_KEY, CHAPA_BASE_URL, CHAPA_CALLBACK_URL and CHAPA_RETURN_URL privately in the ignored apps/backend/.env. Use only a CHASECK_TEST- key and https://api.chapa.co/v1; never paste credentials into commands or docs. The existing initialization flow needs callback/return URLs but neither establishes success.

Use one disposable listing and its existing Step 4.11 Chapa TEST initialization. Complete only its sandbox/test checkout using Chapa's documented test instruments; do not make a production payment. Keep the returned checkout URL and account session private. Then invoke payment/verify with the authenticated owner's session using the stdin curl helper above. Inspect status VERIFY_PAYMENT, payment SUCCEEDED, exact 50000/ETB and paidAt; repeat to confirm unchanged payment ID/paidAt. Publish with the freshly returned ETag and verify exactly one publication. A local fake response is not evidence of this gate. If TEST configuration is absent, stop before commit/push and report missing setting names.

## Direct Neon inspection and cleanup

Using the existing private database client, inspect only the tracked fixture IDs. Verify exactly one Payment bound to the same quote/listing/user, unchanged tx_ref/idempotency/sourceRevision/amount/currency, SUCCEEDED with paidAt only after confirmation, and publishedAt only after publication. Compare listing facts and bilingual text against the pre-test snapshot, excluding intended status/updatedAt/publishedAt. Compare quote contents byte-for-byte. Pending, failed, mismatch and rollback fixtures must remain unpublished. Check no new media or extra payment exists. The live suite also checks success cannot be downgraded and publication timestamps cannot be reset.

Clean only disposable test records. Payment, quote and listing deletion must occur in the same transaction because deferred consistency checks run at commit; then remove tracked location/review/provider/session/user fixtures. Never delete an existing user's payment merely to clean a manual test. The automated fixture helper verifies existing authentication/provider/payment/media data preservation and absence of its temporary records.

Official protocol references: https://developer.chapa.co/integrations/verify-payments and https://developer.chapa.co/integrations/responses.

## Controlled local failure cases

Before the successful verification case, the local runner and collection execute four POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment/verify requests with Authorization: Bearer {{ownerToken}}, no If-Match and no body. The injected test client returns pending, failed, mismatched amount and network failure in that order. These are not client-supplied runtime switches.

For each: `$result = Invoke-PreviewCurl POST "/$id/payment/verify" $ownerToken $null $null`. Expected: HTTP 200/PAYMENT/PENDING/paidAt null; HTTP 200/PAYMENT/FAILED/paidAt null; HTTP 502 PAYMENT_VERIFICATION_MISMATCH; HTTP 502 PAYMENT_VERIFICATION_UNAVAILABLE. publishedAt remains null throughout. The final matching success then reconciles the same failed attempt.

## Verification record

The implementation gate passed: 105 backend tests, 25 live Neon tests, 45 curl cases, 45 Postman cases, typecheck, build, compiled-server health/authentication checks, and npm audit (zero vulnerabilities).

One controlled real Chapa TEST initialization was completed using the hosted TEST checkout and a documented Chapa test mobile instrument. The backend made one authoritative verification GET for the stored reference and returned HTTP 200 / SUCCEEDED / VERIFY_PAYMENT with exact 50000 ETB minor units. Duplicate verification did not call Chapa again or change paidAt. Publication returned PUBLISHED once; repeated publication was rejected. Direct Neon inspection confirmed one bound payment, immutable quote and listing facts, and the intended timestamps. Temporary database fixtures and isolated browser storage were cleaned up. No real credentials, gateway response payloads or session tokens are included in this record.
