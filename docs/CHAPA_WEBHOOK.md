# Chapa webhook, reconciliation and payment notifications

`POST /api/v1/payments/webhooks/chapa` receives standard Chapa webhooks. It does not require an AkGebeya session. Gateway authentication is required. It never publishes a listing or creates a replacement payment.

## Private configuration

Keep `CHAPA_SECRET_KEY`, `CHAPA_BASE_URL`, `CHAPA_CALLBACK_URL`, `CHAPA_RETURN_URL` in ignored `apps/backend/.env`. Add `CHAPA_WEBHOOK_SECRET` privately: a random 32-256 character base64url secret, separate from the API key. Configure the same secret and the HTTPS endpoint above in the Chapa dashboard's standard webhook settings. Never paste secrets into Git, terminal history, logs, or shared Postman data. Restart the backend after configuring it. Missing webhook secret returns 503; initialization and manual verification remain separately configured.

The standard authentication contract follows [Chapa webhook documentation](https://developer.chapa.co/integrations/webhooks): `chapa-signature` is the hex HMAC-SHA256 of the secret using that secret; `x-chapa-signature` signs `JSON.stringify` of the parsed body. Either valid signature suffices. Fixed-size digests use constant-time comparison. Duplicate copies of a signature header are rejected as authentication candidates. Custom webhook Basic Auth and its different signature convention are outside this implementation.

The body is limited to 16 KiB. Zod validates the event and reference. Known charge events trigger reconciliation; unsupported events are acknowledged without processing. Other payload fields are discarded. The reference selects a stored CHAPA payment; stored bindings drive all subsequent queries. An authenticated unknown/legacy reference receives the same acknowledgement without disclosing whether an account exists.

## Authoritative reconciliation

Both webhook and authenticated manual verification use `PaymentVerificationService`. The [Chapa verification API](https://developer.chapa.co/integrations/verify-payments) is queried using the stored transaction reference outside database transactions. The production client validates response shape and TEST/live mode against the configured key. NODE_ENV=production rejects a TEST API key at configuration loading; TEST verification uses the separate development database and cleaned fixtures. The service matches the reference, 50000 integer minor units, ETB, immutable v1 quote, listing, payer and provider ownership. Raw gateway data never reaches a notification or API response.

Provider, listing and payment are locked in the existing order before and after the network call. The second transaction rechecks bindings and revision. A matching authoritative success sets SUCCEEDED and paidAt and moves to VERIFY_PAYMENT. Pending leaves state unchanged. Authoritative failure can change PENDING to FAILED. A later confirmed success can recover FAILED. SUCCEEDED cannot be downgraded. RESERVED/UNKNOWN attempts reconcile in place; no second initialization occurs.

Financial reconciliation may record success while the provider is suspended. Publication remains the separate authenticated `POST /api/v1/listings/:listingId/publish` action with If-Match and fresh ACTIVE/VERIFIED ownership, completeness, quote and successful-payment checks. Callbacks and return redirects never establish success.

## Atomic notification idempotency

No migration is needed. The existing Payment transition guard, unique feeQuoteId and row locks provide one effective transition per outcome. The repository inserts a PAYMENT Notification in the same transaction, and only when the payment status actually changes. Rollback removes both changes. Concurrent/manual/duplicate webhook deliveries cannot insert a second notification for the same outcome. No historical backfill, event inbox, replacement payment, or external delivery is added.

Notifications contain fixed `titleEn`, `titleAm`, `bodyEn`, `bodyAm` text. They contain no gateway reference, checkout URL, session, payment credentials, or personal identity. Success says payment is confirmed and publication is separate. Failure says the payment was unsuccessful and no new attempt was created. Initialization rejection alone does not create a payment-outcome notification. Failure followed by verified recovery produces two distinct notifications, one per outcome. No read/delivery API or worker is added.

## HTTP contract

All webhook requests use POST, `Content-Type: application/json`, and a gateway signature header. No Authorization or If-Match is required for the webhook.

| Case | HTTP | Safe JSON |
| --- | --- | --- |
| Success, pending, failed, duplicate, replay, unsupported event, unknown reference | 200 | `{"status":"ok"}` |
| Missing/invalid signature | 401 | `{"error":{"code":"WEBHOOK_UNAUTHORIZED","message":"Webhook authentication failed"}}` |
| Invalid event/reference | 400 | `{"error":{"code":"BAD_REQUEST","message":"Invalid request"}}` |
| Malformed JSON | 400 | `{"error":{"code":"INVALID_JSON","message":"Invalid JSON body"}}` |
| Oversized body | 413 | `{"error":{"code":"PAYLOAD_TOO_LARGE","message":"Request body too large"}}` |
| Missing configuration | 503 | `{"error":{"code":"SERVICE_UNAVAILABLE","message":"Service unavailable"}}` |
| Gateway/network/response ambiguity | 502 | `{"error":{"code":"PAYMENT_VERIFICATION_UNAVAILABLE","message":"Payment verification is unavailable"}}` |
| Authoritative reference/amount/currency mismatch | 502 | `{"error":{"code":"PAYMENT_VERIFICATION_MISMATCH","message":"Payment verification could not confirm the expected transaction"}}` |
| Binding/lifecycle conflict | 409 | Existing `LISTING_TRANSITION_CONFLICT` safe error |
| Revision changed during verification | 412 | Existing `PRECONDITION_FAILED` safe error |
| Database failure | 500 | Fixed `INTERNAL_ERROR`; no successful acknowledgement |

Only committed processing is acknowledged. Non-200 responses permit gateway retry; there is no local retry worker or automatic checkout retry. Repeated successful processing is harmless even if the earlier HTTP acknowledgement was lost.

## Exact local curl and Postman verification

From the repository root, run:

```powershell
Push-Location apps/backend
try { npx tsx scripts/verify-webhook.ts } finally { Pop-Location }
```

The runner accepts only the optional --postman-only flag for an isolated Postman rerun. Unsupported flags, including --real, fail before credentials or database fixtures are loaded. It cannot certify real gateway delivery.

This executes the 17 cases in `scripts/webhook-scenarios.ts` first through actual `curl.exe`, then through the importable [Postman collection](postman/chapa-webhook.postman_collection.json), against Express and Neon with a deterministic gateway. It covers missing/invalid signature, malformed body, missing event/reference, unknown reference, ignored refund event, pending, failure, duplicate failure, mismatch, network ambiguity, verified success despite payload tampering, duplicates, out-of-order failure, replay, and manual convergence. It prints only case names, HTTP status, and fixed verification stages. Secrets and session headers travel via curl stdin; the subprocess environment is sanitized. Temporary Postman bootstrap access is local, private, short-lived and removed in finally.

Exact unsigned curl request (401):

```powershell
'{"event":"charge.success","tx_ref":"unknown-local-reference"}' | curl.exe --silent --show-error --request POST --header 'Content-Type: application/json' --data-binary '@-' --write-out '\n%{http_code}' http://127.0.0.1:3000/api/v1/payments/webhooks/chapa
```

Exact malformed request (400):

```powershell
'{' | curl.exe --silent --show-error --request POST --header 'Content-Type: application/json' --data-binary '@-' --write-out '\n%{http_code}' http://127.0.0.1:3000/api/v1/payments/webhooks/chapa
```

For signed cases the runner executes this exact argument pattern, supplying its generated body/signature through `--config -` stdin rather than shell arguments:

```text
curl.exe --silent --show-error --max-time 90 --config - --write-out "\n%{http_code}" http://127.0.0.1:<fixture-port>/api/v1/payments/webhooks/chapa
```

The stdin config contains `request = "POST"`, Content-Type, the JSON body, and `x-chapa-signature` (or `chapa-signature` for the static-header replay case). Each case's exact body, method, path, signature mode and expected JSON/status is included in the collection. Its failure outcomes require the deterministic runner; they cannot be induced by changing an untrusted live payload status.

For desktop Postman, import the collection and use a private, unsynced local environment for `baseUrl`, `id`, `referenceToken` (the test transaction reference), `webhookToken` (the webhook secret), and `ownerToken` (a temporary AkGebeya session). Never export these values. The pre-request script computes HMAC without logging it. Do not open or export a console trace containing request headers. Use the runner to execute the complete deterministic sequence.

## Direct Neon verification and cleanup

The manual runner queries Payment, Listing, ListingFeeQuote and Notification directly and asserts: exactly one quote-bound payment, 50000/ETB, SUCCEEDED with paidAt, VERIFY_PAYMENT with publishedAt NULL, unchanged quote/ownership/listing facts, and exactly one failure plus one success notification. The live test additionally proves transaction rollback, concurrent webhook/manual reconciliation, RESERVED/UNKNOWN recovery, suspended-provider publication denial, and compatibility with paid publication.

Fixtures are deleted in finally: dependent payment/quote/listing rows in a transaction, fixture locations/providers/verifications/sessions/users, and cascading fixture notifications. Existing identities, providers, payments, media and notifications are preserved. Use aggregate checks; do not print account identities or transaction credentials.

```sql
-- Run privately for the temporary fixture user/listing, using bound parameters.
SELECT status, "amountMinor" = 50000 AS correct_amount, currency,
       "feeQuoteId" IS NOT NULL AS quote_bound, "paidAt" IS NOT NULL AS paid
FROM akgebeya.payments WHERE "listingId" = :fixture_listing_id;
SELECT status, "publishedAt" IS NULL AS unpublished
FROM akgebeya.listings WHERE id = :fixture_listing_id;
SELECT count(*) AS payment_notifications,
       bool_and("titleAm" IS NOT NULL AND "bodyAm" IS NOT NULL) AS bilingual
FROM akgebeya.notifications WHERE "userId" = :fixture_user_id AND type = 'PAYMENT';
```

## Controlled Chapa TEST delivery

Configure the private webhook secret and a reachable HTTPS development endpoint in the standard Chapa TEST dashboard. Use only a TEST API key and a single fixture checkout. Complete only the hosted TEST flow using Chapa's documented test controls; never make a production payment. Let Chapa deliver the event, then verify the safe 200 acknowledgement and direct database state above. Replay the same signed event and run authenticated manual verification: payment/paidAt/notification count must remain unchanged. Do not treat a hosted redirect as proof. Clean the fixture after inspection. If no reachable authenticated TEST webhook is configured, report this gate as unperformed rather than claiming a gateway-delivered webhook passed.
