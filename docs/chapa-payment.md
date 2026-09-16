# Feature 15 — Chapa sandbox checkout

An approved provider can prepare a Chapa test checkout for a complete saved listing.
The server recalculates the flat 1,000.00 ETB listing fee. The browser displays that
amount and requires explicit confirmation before creating a checkout. A returned
link opens Chapa in a separate tab. This milestone never marks a listing paid or
publishes it; returning from checkout is not evidence of payment.

## Configuration

Add `CHAPA_SECRET_KEY` to the root `.env`. This adapter targets the documented
Ethiopian Chapa **v1** API at `https://api.chapa.co/v1/transaction/initialize` and
accepts only a `CHASECK_TEST-...` secret from the test-mode merchant dashboard.
Public keys, live keys and v2 `CHAPA_TEST_...` keys are rejected. A v2 merchant
requires a separate adapter update; do not rename a key or guess its compatibility.
The key remains server-only. Restart the API after configuring it.

`AUTH_ORIGIN` supplies the checkout return URL; use the exact browser origin.
Local HTTP is accepted only for localhost/127.0.0.1; deployments require HTTPS.
Whether a merchant account accepts the localhost return URL must be checked in the
real sandbox. No callback URL is registered by this milestone.

Sources checked on 2026-09-16:
[v1 initialization](https://developer.chapa.co/integrations/accept-payments),
[test/live mode](https://developer.chapa.co/integrations/test-mode-vs-live-mode),
[v2 migration differences](https://docs.chapa.global/docs/v2/migration).

## Persistence and safety

Migration `20260916001200_listing_payment` adds `listing_payment` only within
`akgebeya_foundation`. It stores one attempt per listing with a unique server
transaction reference, exact decimal amount, ETB currency, policy revision,
source version, media version, state, checkout URL and creation timestamp.
The listing relation cascades for development fixture cleanup. No existing data
or tables are reset. Run `npm run db:generate` and `npm run db:migrate`.

Reservation uses database locks and uniqueness before contacting Chapa. External
network calls run outside database transactions. Concurrent requests and retries
return the same saved attempt, including after restart. New attempts are limited
to five per account per rolling hour. Keys and provider error bodies are not logged.
No account name, email, property text, photos or location are sent by this adapter;
Chapa may collect customer details on its hosted page.

States describe initialization, not payment settlement:

- `INITIALIZING`: reserved; the provider call or its final persistence may still be
  pending. A crash can leave this state requiring reconciliation.
- `READY`: an allowed Chapa checkout URL was saved. It does not mean payment succeeded.
- `UNKNOWN`: network, timeout or malformed response made the result uncertain.
- `FAILED`: initialization was explicitly rejected.

This sandbox milestone creates no second attempt for the same listing, even with
a new request ID. Failed, uncertain or abandoned attempts require operator review;
automated reconciliation/cancellation/retry is not implemented. Never delete or
reset a payment record merely to retry a potentially accepted transaction.
Existing external checkout links cannot be revoked simply by hiding them in the UI.
These restrictions are intentional reasons this feature accepts test keys only.

Changed listing details, photos, policy or provider eligibility make the saved
attempt stale and suppress its link. Final payment verification and exactly-once
publication belong to Feature 16; they must compare these stored facts with the
provider response and must not trust redirect/query parameters.

The adapter bounds responses to 16 KiB, times out after 20 seconds, never retries
automatically, and rejects redirects. Checkout links must use the exact HTTPS host
`checkout.chapa.co` and an allowed payment path, without credentials, query strings
or fragments. The browser uses text nodes and `noopener noreferrer` links.

## API verification

Owner-only `GET /api/listings/:id/payment` returns
`{payment,currentVersion,stale}`. `payment` is null or a public initialization record
without credentials, request ID or account data. Checkout URLs are private and are
removed from stale responses. Responses use `Cache-Control: no-store`.

Git Bash examples, using the authenticated cookie jar from the authentication guide:

```bash
BASE=http://127.0.0.1:3000
LISTING_ID=YOUR_COMPLETE_LISTING_UUID
curl -i -b cookies.txt "$BASE/api/listings/$LISTING_ID/payment"
# 200: payment null initially; currentVersion is the saved source version.
curl -i -b cookies.txt -H "Origin: $BASE" -H 'Content-Type: application/json' \
  -d '{"version":1,"requestId":"aa111111-1111-4111-8111-111111111111","consent":true}' \
  "$BASE/api/listings/$LISTING_ID/payment"
# 200: persisted initialization state; READY includes checkoutUrl and amount "1000.00".
# Use the actual saved source version. Never send an amount or currency.
curl -i "$BASE/api/listings/$LISTING_ID/payment"
# 401: unauthenticated.
```

POST statuses: 400 unsupported fields, invalid ID/version/consent; 401 expired or
absent session; 403 wrong origin or unapproved provider; 404 missing/nonowned
listing; 409 incomplete/stale source or changed existing attempt; 415 non-JSON;
429 new-attempt quota; 503 missing test configuration/database unavailable.
Existing attempts never initiate another provider request. Provider initialization
failure is represented by the persisted FAILED/UNKNOWN state in a 200 response.

## Browser verification

1. Open the local app and sign in as an approved development provider.
2. Select a complete saved property. Expect the server-returned fee and test-only
   checkout explanation; the start action is disabled until confirmation is checked.
3. Confirm and start. Expect loading, then a Chapa link only for a READY result.
4. Open the link and verify Chapa explicitly shows test mode. Verify the 1,000 ETB
   amount in AkGebeya and the saved payment record; the initial hosted test screen
   did not display a numeric amount during verification. No real payment instruments
   or money should be used. This milestone only requires initiation.
5. Return and reload status. Expect the same attempt, never a paid/published claim.
6. Edit the source or mutate photos. Expect the previous link hidden; status reload
   must identify stale attempts. Unsaved edits block creation/opening checkout.
7. Check mobile and desktop layouts, connection failures, incomplete/unapproved
   properties and sign-out clearing private state.

## Verification results

Verified on 2026-09-16:

- All 56 unit tests, typecheck, lint and production build passed. An initial lint
  failure in the new adapter tests was fixed by using explicit Node global names.
- Real database payment integration passed in 97 seconds: authorization, CSRF,
  strict input, complete/approved eligibility, exact server fee, one concurrent
  initialization, persisted retry/restart, UNKNOWN/FAILED deduplication, malformed
  checkout URLs, missing configuration, source/media staleness, quota and privacy.
- Existing media integration regression passed in 134 seconds.
- Migration 12 applied successfully to the development database. A real Chapa
  sandbox attempt persisted READY with amount 1000 ETB, currency ETB, source/media
  version 1; the listing remained COMPLETE and private.
- Browser: explicit consent gated the action; the real provider returned a checkout
  link; opening it displayed AkGebeya branding and Chapa's explicit no-real-money
  test mode. No payment was submitted and no transaction was marked verified.
- Status reload and API restart recovered the saved checkout. Intentional connection
  failure removed the link and amount and showed recovery instructions.
- Desktop 1280×900 and mobile 390×844 had no horizontal page overflow; screenshot
  inspection confirmed the mobile amount, consent, buttons and link fit.
- Unsaved edits immediately hid the checkout and cleared the amount. Saved source
  edits made the existing attempt stale. Secret scanning found no configured Chapa,
  database, Geoapify or Gemini credentials in the browser build. Code review found
  no concrete new auth, duplicate-payment or unsafe-link issues.
- The final stale-checkout wording was rechecked in the rebuilt browser app;
  web typecheck, lint and build passed again. Sign-out cleared the payment panel
  and checkout URL. The disposable local account/property/payment row was removed;
  the unpaid test initialization remains in Chapa's merchant sandbox history.

Tests use disposable development fixtures. Integration tests inject a synthetic
gateway; only the explicitly described browser check contacted real Chapa sandbox.
Device geolocation was skipped as requested. Provider verification, actual sandbox
payment completion, callbacks and publication are not part of this milestone.

## Changed files

- API: `apps/api/src/chapa.ts`, `listing-payment.ts`, `auth.ts`.
- Database: `prisma/schema.prisma`, migration `20260916001200_listing_payment`.
- Browser: `apps/web/src/listing-payment.ts`, `listings.ts`, `media.ts`, `style.css`,
  and `apps/web/index.html`.
- Tests: `tests/chapa.test.mjs`, `tests/listing-payment-view.test.mjs`,
  `tests/integration/listing-payment.test.mjs`.
- Setup/documentation: `.env.example`, `package.json`, `README.md`, this guide.
