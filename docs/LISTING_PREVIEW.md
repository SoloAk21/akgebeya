# Listing Preview (Step 4.9)

POST /api/v1/listings/:listingId/preview permits only AI_ASSIST -> PREVIEW. Authorization: Bearer <AkGebeya session> and the exact If-Match returned by private GET are required. No body is required; an empty JSON object is accepted. Any supplied listing facts or lifecycle status are rejected.

PREVIEW remains private. It does not calculate fees, create payments, publish listings, create a public URL, or call Gemini. Existing media is untouched and omitted from this foundation's representation.

The service checks ownership, state and revision, then rechecks under provider/listing locks in a short transaction. The location is locked for shared reading. Completeness, taxonomy, positive ETB price, numeric constraints, four bilingual fields and publishedAt NULL are revalidated. Only status and updatedAt change. A failed check leaves the entire listing unchanged. Concurrent requests with one ETag yield one success and one 412; repeat with the new ETag returns 409.

Responses use {listing: ...}, a new ETag, Cache-Control: no-store and Vary: Authorization. Provider fields are only id, role, nameEn and nameAm. Location uses an explicit address-field allowlist. User identities, verification/reviewer information, session data and payment internals are omitted. English and Amharic remain separate and unchanged.

The single new migration adds PREVIEW and extends the unpublished-state and bilingual checks only. All previous statuses, PUBLISHED protection, completeness/content/taxonomy/numeric checks, rows, indexes and foreign keys remain intact. Prisma remains 6.12.0.

Invalid stored fields produce HTTP 422, for example {"error":{"code":"LISTING_INCOMPLETE","message":"Listing information is incomplete or invalid","fields":["titleAm"]}}. Optional dimensions remain optional. Other exact errors and responses are documented below.

## Automated and manual verification

From apps/backend, run npm run build, then:

    node --import tsx scripts/verify-preview.ts

This executes actual curl and Postman CLI against the built backend with Gemini disabled. Temporary DB-backed actors and stored bilingual AI_ASSIST fixtures are provisioned only inside local verification. There is no bypass endpoint. Authorization is passed to curl through private stdin configuration, and to Postman through an authenticated temporary loopback bootstrap in memory. Output contains only stage/status information. Session tokens are never committed or passed on command lines. The runner removes temporary fixtures and bootstrap files in finally blocks.

Import docs/postman/listing-preview.postman_collection.json. Each request includes method, URL, headers, body, expected HTTP status, JSON example and assertions. For interactive use, supply local unshared ownerToken, otherToken, adminToken (no provider), spareToken (unverified), rejectedToken, suspendedToken, rolelessToken, and id (owned AI_ASSIST fixture) variables. Never export populated variables. The verifier supplies and cleans them automatically. Concurrent preview is tested against Neon with two simultaneous requests and in unit tests.

## Exact curl requests (PowerShell)

Use existing sessions held privately in corresponding $ownerToken, $otherToken, etc. variables; never paste literal tokens into command history. The automated runner obtains sessions without user input. Set $id to a temporary owned AI_ASSIST fixture UUID. Subsequent IDs/revisions are captured below. The helper prints HTTP status only and returns parsed data into $result. Headers go to curl via stdin.

```powershell
function Invoke-PreviewCurl($Method, $Path, $Token, $Match, $Body) {
  $config = @('request = ' + (ConvertTo-Json -Compress $Method))
  if ($Token) { $config += 'header = ' + (ConvertTo-Json -Compress ('Authorization: Bearer ' + $Token)) }
  if ($Match) { $config += 'header = ' + (ConvertTo-Json -Compress ('If-Match: ' + $Match)) }
  if ($null -ne $Body) {
    $config += 'header = "Content-Type: application/json"'
    $config += 'data = ' + (ConvertTo-Json -Compress $Body)
  }
  $raw = ($config -join [Environment]::NewLine) | curl.exe --silent --show-error --config - --write-out '\n%{http_code}' ("http://127.0.0.1:3000/api/v1/listings" + $Path)
  $lines = @($raw)
  Write-Host ("HTTP " + $lines[-1])
  return (($lines[0..($lines.Length-2)] -join [Environment]::NewLine) | ConvertFrom-Json)
}
```

### Read stored AI_ASSIST fixture

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $ownerToken $null $null
$revision = $result.listing.etag
$initialRevision = $result.listing.etag
```

Expected JSON (angle-bracket values vary):

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "AI_ASSIST",
    "category": "RESIDENTIAL",
    "type": "SALE",
    "propertyType": "HOUSE",
    "titleEn": "<stored English>",
    "titleAm": "<stored Amharic or null before AI_ASSIST>",
    "descriptionEn": "<stored English>",
    "descriptionAm": "<stored Amharic or null before AI_ASSIST>",
    "price": "100.00",
    "currency": "ETB",
    "bedrooms": null,
    "bathrooms": null,
    "areaSqm": null,
    "location": {
      "id": "<UUID>",
      "countryCode": "ET",
      "regionEn": "Addis Ababa",
      "regionAm": null,
      "cityEn": "Addis Ababa",
      "cityAm": null,
      "subcityEn": null,
      "subcityAm": null,
      "addressEn": null,
      "addressAm": null
    },
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>",
    "etag": "<quoted revision>"
  }
}
```

### Unauthenticated preview

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 401.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $null $null $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

### admin denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $adminToken $revision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### spare denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $spareToken $revision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### rejected denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $rejectedToken $revision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### suspended denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $suspendedToken $revision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### roleless denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 403.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $rolelessToken $revision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied"
  }
}
```

### Other provider preview denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 404.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $otherToken $revision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "LISTING_NOT_FOUND",
    "message": "Listing not found"
  }
}
```

### Missing If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 428.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken $null $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "PRECONDITION_REQUIRED",
    "message": "If-Match is required"
  }
}
```

### Malformed If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken '*' $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Stale If-Match

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 412.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken '"0000000000000000000000000000000000000000000000000000000000000000"' $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "PRECONDITION_FAILED",
    "message": "Listing changed; retrieve it again"
  }
}
```

### Reject supplied price

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken $revision '{"price":"1"}'
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied status

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken $revision '{"status":"PREVIEW"}'
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request"
  }
}
```

### Reject supplied providerId

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken $revision '{"providerId":"injected"}'
```

Expected JSON (angle-bracket values vary):

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

Expected HTTP 201.

```powershell
$result = Invoke-PreviewCurl POST "" $ownerToken $null '{"category":"RESIDENTIAL","type":"SALE","propertyType":"HOUSE","titleEn":"Completion fixture","descriptionEn":"Private completion verification fixture","price":"100.00","location":{"regionEn":"Addis Ababa","cityEn":"Addis Ababa"}}'
$draftId = $result.listing.id
$draftEtag = $result.listing.etag
```

Expected JSON (angle-bracket values vary):

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "DRAFT",
    "category": "RESIDENTIAL",
    "type": "SALE",
    "propertyType": "HOUSE",
    "titleEn": "<stored English>",
    "titleAm": "<stored Amharic or null before AI_ASSIST>",
    "descriptionEn": "<stored English>",
    "descriptionAm": "<stored Amharic or null before AI_ASSIST>",
    "price": "100.00",
    "currency": "ETB",
    "bedrooms": null,
    "bathrooms": null,
    "areaSqm": null,
    "location": {
      "id": "<UUID>",
      "countryCode": "ET",
      "regionEn": "Addis Ababa",
      "regionAm": null,
      "cityEn": "Addis Ababa",
      "cityAm": null,
      "subcityEn": null,
      "subcityAm": null,
      "addressEn": null,
      "addressAm": null
    },
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>",
    "etag": "<quoted revision>"
  }
}
```

### DRAFT cannot preview

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/preview

Expected HTTP 409.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/preview" $ownerToken $draftEtag $null
```

Expected JSON (angle-bracket values vary):

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

Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/complete" $ownerToken $draftEtag '{}'
$draftEtag = $result.listing.etag
```

Expected JSON (angle-bracket values vary):

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "COMPLETE",
    "category": "RESIDENTIAL",
    "type": "SALE",
    "propertyType": "HOUSE",
    "titleEn": "<stored English>",
    "titleAm": "<stored Amharic or null before AI_ASSIST>",
    "descriptionEn": "<stored English>",
    "descriptionAm": "<stored Amharic or null before AI_ASSIST>",
    "price": "100.00",
    "currency": "ETB",
    "bedrooms": null,
    "bathrooms": null,
    "areaSqm": null,
    "location": {
      "id": "<UUID>",
      "countryCode": "ET",
      "regionEn": "Addis Ababa",
      "regionAm": null,
      "cityEn": "Addis Ababa",
      "cityAm": null,
      "subcityEn": null,
      "subcityAm": null,
      "addressEn": null,
      "addressAm": null
    },
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>",
    "etag": "<quoted revision>"
  }
}
```

### COMPLETE cannot preview

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/preview

Expected HTTP 409.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/preview" $ownerToken $draftEtag $null
```

Expected JSON (angle-bracket values vary):

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

Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/validate" $ownerToken $draftEtag '{}'
$draftEtag = $result.listing.etag
```

Expected JSON (angle-bracket values vary):

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "VALIDATE",
    "category": "RESIDENTIAL",
    "type": "SALE",
    "propertyType": "HOUSE",
    "titleEn": "<stored English>",
    "titleAm": "<stored Amharic or null before AI_ASSIST>",
    "descriptionEn": "<stored English>",
    "descriptionAm": "<stored Amharic or null before AI_ASSIST>",
    "price": "100.00",
    "currency": "ETB",
    "bedrooms": null,
    "bathrooms": null,
    "areaSqm": null,
    "location": {
      "id": "<UUID>",
      "countryCode": "ET",
      "regionEn": "Addis Ababa",
      "regionAm": null,
      "cityEn": "Addis Ababa",
      "cityAm": null,
      "subcityEn": null,
      "subcityAm": null,
      "addressEn": null,
      "addressAm": null
    },
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>",
    "etag": "<quoted revision>"
  }
}
```

### VALIDATE cannot preview

POST http://127.0.0.1:3000/api/v1/listings/{{draftId}}/preview

Expected HTTP 409.

```powershell
$result = Invoke-PreviewCurl POST "/$draftId/preview" $ownerToken $draftEtag $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "LISTING_TRANSITION_CONFLICT",
    "message": "Listing cannot make this transition"
  }
}
```

### Preview stored bilingual listing

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken $revision $null
$revision = $result.listing.etag
```

Expected JSON (angle-bracket values vary):

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "PREVIEW",
    "category": "RESIDENTIAL",
    "type": "SALE",
    "propertyType": "HOUSE",
    "titleEn": "<stored English>",
    "titleAm": "<stored Amharic or null before AI_ASSIST>",
    "descriptionEn": "<stored English>",
    "descriptionAm": "<stored Amharic or null before AI_ASSIST>",
    "price": "100.00",
    "currency": "ETB",
    "bedrooms": null,
    "bathrooms": null,
    "areaSqm": null,
    "location": {
      "id": "<UUID>",
      "countryCode": "ET",
      "regionEn": "Addis Ababa",
      "regionAm": null,
      "cityEn": "Addis Ababa",
      "cityAm": null,
      "subcityEn": null,
      "subcityAm": null,
      "addressEn": null,
      "addressAm": null
    },
    "provider": {
      "id": "<UUID>",
      "role": "OWNER",
      "nameEn": "Listing fixture provider",
      "nameAm": null
    },
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>",
    "etag": "<quoted revision>"
  }
}
```

### Repeated preview denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 409.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken $revision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "LISTING_TRANSITION_CONFLICT",
    "message": "Listing cannot make this transition"
  }
}
```

### Old revision denied

POST http://127.0.0.1:3000/api/v1/listings/{{id}}/preview

Expected HTTP 412.

```powershell
$result = Invoke-PreviewCurl POST "/$id/preview" $ownerToken $initialRevision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "PRECONDITION_FAILED",
    "message": "Listing changed; retrieve it again"
  }
}
```

### Read private preview

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected HTTP 200.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $ownerToken $null $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "listing": {
    "id": "<UUID>",
    "status": "PREVIEW",
    "category": "RESIDENTIAL",
    "type": "SALE",
    "propertyType": "HOUSE",
    "titleEn": "<stored English>",
    "titleAm": "<stored Amharic or null before AI_ASSIST>",
    "descriptionEn": "<stored English>",
    "descriptionAm": "<stored Amharic or null before AI_ASSIST>",
    "price": "100.00",
    "currency": "ETB",
    "bedrooms": null,
    "bathrooms": null,
    "areaSqm": null,
    "location": {
      "id": "<UUID>",
      "countryCode": "ET",
      "regionEn": "Addis Ababa",
      "regionAm": null,
      "cityEn": "Addis Ababa",
      "cityAm": null,
      "subcityEn": null,
      "subcityAm": null,
      "addressEn": null,
      "addressAm": null
    },
    "provider": {
      "id": "<UUID>",
      "role": "OWNER",
      "nameEn": "Listing fixture provider",
      "nameAm": null
    },
    "createdAt": "<ISO timestamp>",
    "updatedAt": "<ISO timestamp>",
    "etag": "<quoted revision>"
  }
}
```

### Other provider cannot read preview

GET http://127.0.0.1:3000/api/v1/listings/{{id}}

Expected HTTP 404.

```powershell
$result = Invoke-PreviewCurl GET "/$id" $otherToken $null $null
```

Expected JSON (angle-bracket values vary):

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

Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision '{"status":"PREVIEW"}'
```

Expected JSON (angle-bracket values vary):

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

Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision '{"status":"PUBLISHED"}'
```

Expected JSON (angle-bracket values vary):

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

Expected HTTP 400.

```powershell
$result = Invoke-PreviewCurl PATCH "/$id" $ownerToken $revision '{"status":"DRAFT"}'
```

Expected JSON (angle-bracket values vary):

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

Expected HTTP 404.

```powershell
$result = Invoke-PreviewCurl POST "/$id/publish" $ownerToken $revision $null
```

Expected JSON (angle-bracket values vary):

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found"
  }
}
```

## Neon inspection, state checks and cleanup

The verifier directly compares every listing field except status/updatedAt before and after, including providerId/category/type/propertyType/price/locationId and all bilingual text. It checks PREVIEW, publishedAt NULL, and unchanged full Payment/Media snapshots. Failed curl actions preserve the exact row. Existing authentication/provider records are compared. Shared finally blocks remove all temporary users, sessions, providers, verifications, listings and locations.

Live tests also verify invalid referenced-location data blocks preview, locking gives one concurrent success, and an injected Gemini spy receives zero calls. Unit tests cover invalid stored content without disabling database constraints. Manual state checks deny DRAFT/COMPLETE/VALIDATE -> PREVIEW, repeat PREVIEW, direct PATCH escalation/reversal, and publication. AI_ASSIST -> PREVIEW succeeds.

For a private Neon console inspection while a local fixture exists, substitute only its UUID:

```sql
SELECT status, "publishedAt" IS NULL AS unpublished,
 "titleEn" IS NOT NULL AS english_title, "titleAm" IS NOT NULL AS amharic_title,
 "descriptionEn" IS NOT NULL AS english_description, "descriptionAm" IS NOT NULL AS amharic_description
FROM akgebeya.listings WHERE id = '<fixture UUID>'::uuid;
SELECT count(*) AS payments FROM akgebeya.payments WHERE "listingId" = '<fixture UUID>'::uuid;
```

Expect PREVIEW, all booleans true, zero payments. After runner cleanup the listing query returns no rows. Do not dump private identity/session records. The runner performs these checks in memory.
