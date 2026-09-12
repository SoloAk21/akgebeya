# Chapa Payment Initiation — Step 4.11

**PAYMENT INITIALIZATION DOES NOT VERIFY PAYMENT.**
**PAYMENT INITIALIZATION DOES NOT PUBLISH A LISTING.**
A callback or return redirect is NOT proof of payment.

POST http://127.0.0.1:3000/api/v1/listings/:listingId/payment

Only CALCULATE_FEE -> PAYMENT. Require the authenticated owner of an ACTIVE, VERIFIED provider with a valid role, an undeleted listing, and the current quoted If-Match. Other providers receive 404; ADMIN has no ownership bypass. Accept no body or strictly {}. Reject all client amounts, currency, references, identities, quote IDs, URLs and lifecycle fields. Responses are private/no-store.

The immutable ListingFeeQuote supplies 50000 BigInt minor units, ETB, pricingVersion v1. Convert by integer division/remainder to the Chapa decimal string "500.00". Do not recalculate, expire or replace the quote. Its sourceRevision refers to the PREVIEW revision; Payment.sourceRevision records the CALCULATE_FEE revision reserved for initialization. They are intentionally different.

## Reservation and network design

1. Short transaction: lock provider/listing, revalidate ownership, provider state, listing completeness/location/bilingual fields, quote and If-Match. Reserve one PENDING/RESERVED payment bound to quote, listing and user. Generate unpredictable UUID-based tx_ref and idempotencyKey server-side. gatewayReference stores tx_ref. Commit without changing listing state.
2. Outside transactions: one backend ChapaClient.initialize call. No automatic retry. Validate bounded JSON and an HTTPS checkout.chapa.co /checkout/ URL. No raw payload logging. Optional customer identity is omitted; no name, email or phone is fabricated. Chapa's current field table lists these as optional (phone can be mandatory for merchant risk categories); if the test merchant requires unavailable data, stop for review.
3. Short transaction: reauthorize/revalidate, lock current listing/payment, recheck reserved ETag and quote, persist checkoutUrl, set INITIALIZED/PENDING and transition listing PAYMENT with advanced updatedAt. Return success only after commit.

Provider-before-listing-before-payment lock order matches existing repository locking, avoiding a reversed lock order during finalization. Chapa is never called from the transaction retry callback.

Unique feeQuoteId permits one attempt per quote, including rejected/unknown attempts. Existing unique idempotency and gateway/reference indexes remain. Binding fields are immutable; deferred triggers enforce listing/quote/payment agreement. Legacy payments retain null initialization fields. No applied migration was modified; Prisma stays 6.12.0.

| Initialization | Payment status | Listing | Behavior |
| --- | --- | --- | --- |
| RESERVED | PENDING | CALCULATE_FEE | In flight or interrupted; blocks another attempt |
| INITIALIZED | PENDING | PAYMENT | Valid checkout finalized atomically |
| REJECTED | FAILED | CALCULATE_FEE | Definitive documented rejection; no replacement |
| UNKNOWN | PENDING | CALCULATE_FEE | Timeout/network/ambiguous response; reconciliation needed |

A duplicate upstream reference is unresolved, not proof of rejection. Failed finalization attempts to record UNKNOWN; if that write is unavailable, RESERVED remains and still blocks duplication. No automatic recovery, payment verification or retry endpoint is implemented. paidAt remains NULL and refundedAmountMinor remains zero.

Successful HTTP 200 shape:

```json
{
  "listingId": "<UUID>",
  "status": "PAYMENT",
  "payment": {
    "status": "PENDING",
    "amountMinor": "50000",
    "currency": "ETB",
    "checkoutUrl": "https://checkout.chapa.co/checkout/payment/<opaque-id>"
  },
  "etag": "<quoted revision>"
}
```

Errors use {error:{code,message}}. Missing If-Match: 428; malformed: 400; stale: 412; wrong lifecycle/existing reservation: 409; upstream rejection/unknown: safe 502. Missing runtime Chapa configuration returns 503 without reserving a payment. No raw Chapa error, tx_ref or idempotency key is returned.

## Private configuration

Configure only ignored apps/backend/.env using a local editor:

- CHAPA_SECRET_KEY: development/test secret key from your Chapa dashboard in Test mode.
- CHAPA_BASE_URL: https://api.chapa.co/v1
- CHAPA_CALLBACK_URL: your HTTPS callback destination; configuration only here.
- CHAPA_RETURN_URL: your HTTPS return destination; configuration only here.

Do not paste keys into terminal commands, Git, Postman collection exports or chat. URLs must not embed credentials. Backend configuration validates the fixed upstream origin; credentials never follow redirects. No callback handler or authoritative redirect logic is added.

Official references: [initialize](https://developer.chapa.co/integrations/accept-payments), [responses](https://developer.chapa.co/integrations/responses), [test mode](https://developer.chapa.co/integrations/test-mode-vs-live-mode).

## Automated and manual verification

From the repository root:

```powershell
npm run typecheck --workspace apps/backend
npm test --workspace apps/backend
npm run test:database --workspace apps/backend
npm run build --workspace apps/backend
node --import tsx apps/backend/scripts/verify-payment.ts
```

The default manual runner uses a deterministic Chapa client with actual authenticated Express routes, curl, Postman CLI, Prisma and Neon. Production has no fake-client environment switch. Every mode uses fresh fixtures. It checks persisted state and cleans fixture payments/quotes/listings atomically before removing related temporary records.

For one real test initialization after configuration:

```powershell
node --import tsx apps/backend/scripts/verify-payment.ts --real
```

This requires development mode and a test secret prefix. It prints configuration-presence booleans only, runs curl authorization/tampering/lifecycle cases, makes exactly one Chapa initialization, rejects repeat attempts, inspects Neon directly and cleans temporary fixtures. It never follows checkout or completes payment. It does not run a second real initialization through Postman. Retain the Chapa dashboard test entry as remote audit history; no gateway cancellation/refund is implemented.

Import docs/postman/chapa-payment-initiation.postman_collection.json. Set baseUrl and id plus local, unsynced ownerToken/otherToken/adminToken/spareToken/rejectedToken/suspendedToken/rolelessToken. Do not export populated credentials. The local runner supplies these through the existing private memory-only credential bootstrap. Every request includes headers/body, expected status/JSON shape and assertions.

## Exact curl cases

Use Invoke-PreviewCurl from [Listing Preview](LISTING_PREVIEW.md#exact-curl-requests-powershell); it sends Authorization and If-Match through curl stdin, never command arguments. Set id to a temporary owned CALCULATE_FEE listing. The base URL is exactly http://127.0.0.1:3000/api/v1/listings. Commands use private session variables; no Chapa secret is sent to AkGebeya endpoints. Capture statements keep responses in memory. Expected JSON examples below show the relevant safe shape; GET/creation also include stored listing fields.

### Read stored CALCULATE_FEE fixture

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Authorization: Bearer <owner session>. If-Match: absent. Body: absent. Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $ownerToken $null $null
$revision = $result.listing.etag
$initialRevision = $result.listing.etag
```

Expected response shape:

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "CALCULATE_FEE",
    "etag": "<quoted revision>",
    "fee": {
      "amountMinor": "50000",
      "currency": "ETB",
      "pricingVersion": "v1"
    }
  }
}
```

### Unauthenticated payment initiation

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: absent. If-Match: absent. Body: absent. Expected HTTP 401.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $null $null $null
```

Expected response shape:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

### admin denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <admin session>. If-Match: {{revision}}. Body: absent. Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $adminToken $revision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### spare denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <spare session>. If-Match: {{revision}}. Body: absent. Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $spareToken $revision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### rejected denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <rejected session>. If-Match: {{revision}}. Body: absent. Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $rejectedToken $revision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### suspended denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <suspended session>. If-Match: {{revision}}. Body: absent. Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $suspendedToken $revision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### roleless denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <roleless session>. If-Match: {{revision}}. Body: absent. Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $rolelessToken $revision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### Other provider payment initiation denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <other session>. If-Match: {{revision}}. Body: absent. Expected HTTP 404.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $otherToken $revision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "LISTING_NOT_FOUND",
    "message": "Listing not found"
  }
}
```

### Missing If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: absent. Body: absent. Expected HTTP 428.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $null $null
```

Expected response shape:

```json
{
  "error": {
    "code": "PRECONDITION_REQUIRED",
    "message": "If-Match is required"
  }
}
```

### Malformed If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: *. Body: absent. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken '*' $null
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Stale If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: "0000000000000000000000000000000000000000000000000000000000000000". Body: absent. Expected HTTP 412.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken '"0000000000000000000000000000000000000000000000000000000000000000"' $null
```

Expected response shape:

```json
{
  "error": {
    "code": "PRECONDITION_FAILED",
    "message": "Listing changed; retrieve it again"
  }
}
```

### Reject supplied price

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"price":"1"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"price":"1"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied status

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"status":"PREVIEW"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"status":"PREVIEW"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied providerId

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"providerId":"injected"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"providerId":"injected"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied amountMinor

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"amountMinor":1}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"amountMinor":1}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied currency

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"currency":"USD"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"currency":"USD"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied tx_ref

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"tx_ref":"injected"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"tx_ref":"injected"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied idempotencyKey

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"idempotencyKey":"injected"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"idempotencyKey":"injected"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied feeQuoteId

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"feeQuoteId":"injected"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"feeQuoteId":"injected"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied userId

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"userId":"injected"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"userId":"injected"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied listingId

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"listingId":"injected"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"listingId":"injected"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied pricingVersion

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"pricingVersion":"injected"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"pricingVersion":"injected"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied callbackUrl

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"callbackUrl":"https://example.com"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"callbackUrl":"https://example.com"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied returnUrl

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"returnUrl":"https://example.com"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision ('{"returnUrl":"https://example.com"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Create separate draft

POST http://127.0.0.1:3000/api/v1/listings

Authorization: Bearer <owner session>. If-Match: absent. Body: {"category":"RESIDENTIAL","type":"SALE","propertyType":"HOUSE","titleEn":"Completion fixture","descriptionEn":"Private completion verification fixture","price":"100.00","location":{"regionEn":"Addis Ababa","cityEn":"Addis Ababa"}}. Expected HTTP 201.

```powershell
$result = Invoke-PreviewCurl POST "" $ownerToken $null ('{"category":"RESIDENTIAL","type":"SALE","propertyType":"HOUSE","titleEn":"Completion fixture","descriptionEn":"Private completion verification fixture","price":"100.00","location":{"regionEn":"Addis Ababa","cityEn":"Addis Ababa"}}' | ConvertFrom-Json | ConvertTo-Json -Compress)
$draftId = $result.listing.id
$draftEtag = $result.listing.etag
```

Expected response shape:

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "DRAFT",
    "etag": "<quoted revision>"
  }
}
```

### DRAFT cannot payment initiation

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/payment

Authorization: Bearer <owner session>. If-Match: {{draftEtag}}. Body: absent. Expected HTTP 409.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/payment" $ownerToken $draftEtag $null
```

Expected response shape:

```json
{
  "error": {
    "code": "LISTING_TRANSITION_CONFLICT",
    "message": "Listing cannot make this transition"
  }
}
```

### Complete separate fixture

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/complete

Authorization: Bearer <owner session>. If-Match: {{draftEtag}}. Body: {}. Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/complete" $ownerToken $draftEtag ('{}' | ConvertFrom-Json | ConvertTo-Json -Compress)
$draftEtag = $result.listing.etag
```

Expected response shape:

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "COMPLETE",
    "etag": "<quoted revision>"
  }
}
```

### COMPLETE cannot payment initiation

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/payment

Authorization: Bearer <owner session>. If-Match: {{draftEtag}}. Body: absent. Expected HTTP 409.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/payment" $ownerToken $draftEtag $null
```

Expected response shape:

```json
{
  "error": {
    "code": "LISTING_TRANSITION_CONFLICT",
    "message": "Listing cannot make this transition"
  }
}
```

### Validate separate fixture

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/validate

Authorization: Bearer <owner session>. If-Match: {{draftEtag}}. Body: {}. Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/validate" $ownerToken $draftEtag ('{}' | ConvertFrom-Json | ConvertTo-Json -Compress)
$draftEtag = $result.listing.etag
```

Expected response shape:

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "VALIDATE",
    "etag": "<quoted revision>"
  }
}
```

### VALIDATE cannot payment initiation

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/payment

Authorization: Bearer <owner session>. If-Match: {{draftEtag}}. Body: absent. Expected HTTP 409.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/payment" $ownerToken $draftEtag $null
```

Expected response shape:

```json
{
  "error": {
    "code": "LISTING_TRANSITION_CONFLICT",
    "message": "Listing cannot make this transition"
  }
}
```

### Initialize payment stored bilingual listing

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: absent. Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision $null
$revision = $result.etag
```

Expected response shape:

```json
{
  "listingId": "<UUID>",
  "status": "PAYMENT",
  "payment": {
    "status": "PENDING",
    "amountMinor": "50000",
    "currency": "ETB",
    "checkoutUrl": "https://checkout.chapa.co/checkout/payment/<opaque-id>"
  },
  "etag": "<quoted revision>"
}
```

### Repeated payment initiation denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: absent. Expected HTTP 409.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $revision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "LISTING_TRANSITION_CONFLICT",
    "message": "Listing cannot make this transition"
  }
}
```

### Old revision denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/payment

Authorization: Bearer <owner session>. If-Match: {{initialRevision}}. Body: absent. Expected HTTP 412.

```powershell
$result = Invoke-PreviewCurl POST "/$id/payment" $ownerToken $initialRevision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "PRECONDITION_FAILED",
    "message": "Listing changed; retrieve it again"
  }
}
```

### Read private payment initiation

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Authorization: Bearer <owner session>. If-Match: absent. Body: absent. Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $ownerToken $null $null
```

Expected response shape:

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "PAYMENT",
    "etag": "<quoted revision>",
    "fee": {
      "amountMinor": "50000",
      "currency": "ETB",
      "pricingVersion": "v1"
    }
  }
}
```

### Other provider cannot read payment initiation

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Authorization: Bearer <other session>. If-Match: absent. Body: absent. Expected HTTP 404.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $otherToken $null $null
```

Expected response shape:

```json
{
  "error": {
    "code": "LISTING_NOT_FOUND",
    "message": "Listing not found"
  }
}
```

### Reject PATCH PREVIEW

PATCH http://127.0.0.1:3000/api/v1/listings/{{id}}

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"status":"PREVIEW"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision ('{"status":"PREVIEW"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject PATCH PUBLISHED

PATCH http://127.0.0.1:3000/api/v1/listings/{{id}}

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"status":"PUBLISHED"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision ('{"status":"PUBLISHED"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject PATCH DRAFT

PATCH http://127.0.0.1:3000/api/v1/listings/{{id}}

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"status":"DRAFT"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision ('{"status":"DRAFT"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### No publication endpoint

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/publish

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: absent. Expected HTTP 404.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision $null
```

Expected response shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found"
  }
}
```

### Reject direct PATCH PAYMENT

PATCH http://127.0.0.1:3000/api/v1/listings/{{id}}

Authorization: Bearer <owner session>. If-Match: {{revision}}. Body: {"status":"PAYMENT"}. Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision ('{"status":"PAYMENT"}' | ConvertFrom-Json | ConvertTo-Json -Compress)
```

Expected response shape:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

## Direct Neon inspection and cleanup

The manual runner compares each listing with its pre-initialization snapshot, verifies the exact quote binding/user ownership/source ETag, checks 50000/ETB/PENDING/INITIALIZED, nonempty server references and checkout URL, NULL paidAt/publishedAt and zero refunded amount. Quote content and listing facts remain unchanged; existing Payment/Media rows and authentication/provider fixtures are preserved. Live tests inspect REJECTED/FAILED and UNKNOWN/PENDING cases plus finalization rollback and concurrent one-call behavior.

For a private Neon console check, bind the temporary listing UUID locally and select only boolean assertions/counts: exactly one quote-bound Payment; payment/quote amounts and currencies equal; payer equals listing provider's user; INITIALIZED/PENDING; paidAt and publishedAt are NULL; refundedAmountMinor is zero. Do not copy checkout URLs, customer identity, session identifiers or database credentials into reports. The runner performs these comparisons directly without printing sensitive columns.

Cleanup deletes only tracked fixture Payment, ListingFeeQuote and Listing rows in one transaction to satisfy deferred consistency, followed by fixture locations, reviews, providers, users and sessions. A failed cleanup is a failed verification gate.
