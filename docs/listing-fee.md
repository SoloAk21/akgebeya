# Feature 14 — Listing fee

AkGebeya charges a flat **1,000.00 ETB per listing**, for both rentals and sales,
as specified by the product owner. Property price, type, photos and generated text
do not change this fee. This milestone displays the fee; it does not take payment
or publish a property.

The fee policy lives only in `apps/api/src/listing-fee.ts`, represented as 100,000
integer minor units with revision `flat-etb-1000-v1`. No new environment variables,
API keys, dependencies, database tables or migrations are required. Change the
policy revision whenever the amount or rule changes, and deploy the same policy
to all API instances.

## API and consistency

`GET /api/listings/:id/fee` authenticates the session, checks ownership and reads
the listing version, completion status and provider approval in one SQL snapshot.
Only approved providers with complete saved properties receive a fee. The response
contains `listingId`, `sourceVersion`, `currency`, `amount` (exact decimal string),
`policyRevision` and `calculatedAt` (ISO timestamp). It excludes account details.
Responses are not cached. No listing or payment data is written.

The browser displays the server amount and rejects mismatched listing IDs or
source versions. Unsaved edits clear the previous result. A failed refresh clears
the old amount and offers retry. Account reset clears the panel and cancels requests.
The result is a fee for the saved snapshot, not a guaranteed payment quote. Changes
in another tab or operator policy are detected on the next request, not pushed live.

Future payment creation must recheck ownership, approval, completion and source
version, calculate the fee on the server, and bind that amount and policy revision
to its persisted payment record. Never trust a browser-supplied amount or treat this
read-only response as proof of payment. Payment is the next roadmap feature.

## Manual verification

1. Open `http://127.0.0.1:3000/` and sign in as an approved development provider.
2. Open a complete saved property, then choose **Check listing fee**.
   Expect **1,000.00 ETB per listing** and confirmation that no payment was taken.
3. Refresh the fee. Expect the same amount for a fresh saved snapshot.
4. Change the property price without saving. Expect the old fee to clear and the
   fee action to remain disabled until changes are saved or discarded.
5. Save the property as complete, then check again. Expect the same flat fee.
6. Open an incomplete draft. Expect instructions to complete the property first.
7. Stop the local API and retry a fee request. Expect an error with no old amount;
   restart the API and retry to recover.
8. Check desktop and 390-pixel mobile widths; fee text and controls must fit.
9. Sign out. Expect all private fee content to disappear.

For Git Bash, substitute a development listing UUID and existing authenticated
cookie jar obtained using the authentication guide:

```bash
BASE=http://127.0.0.1:3000
LISTING_ID=YOUR_COMPLETE_LISTING_UUID
curl -i -b cookies.txt "$BASE/api/listings/$LISTING_ID/fee"
# 200: amount "1000.00", currency "ETB", current sourceVersion and policyRevision.
curl -i -b cookies.txt "$BASE/api/listings/$LISTING_ID/fee?amount=0.01&currency=USD"
# 200: unchanged server amount "1000.00" and currency "ETB".
curl -i "$BASE/api/listings/$LISTING_ID/fee"
# 401 UNAUTHENTICATED.
curl -i -b cookies.txt "$BASE/api/listings/not-a-uuid/fee"
# 400 INVALID_ID.
curl -i -b cookies.txt -X POST "$BASE/api/listings/$LISTING_ID/fee"
# 405 METHOD_NOT_ALLOWED, Allow: GET.
```

Using another owner's cookie jar or a nonexistent UUID returns 404; an owner
without provider approval receives 403; an incomplete owned listing receives 409.
Repeated reads only change the calculation timestamp. Database/network failure
returns a sanitized service error.

## Verification results

Verified on 2026-09-16:

- Typecheck and lint passed. The sandbox initially prevented test workers from
  spawning (`EPERM`); the unchanged tests passed with the required process access:
  all 48 unit tests, followed by the production build.
- `npm run test:listing-fee` passed against the development database in 34 seconds.
  It covers all four property types, rental/sale and extreme prices, query/body
  tampering, authentication, ownership, malformed IDs, methods, completion and
  provider eligibility, source-version changes and restart. Repeated fee reads
  left listing records, timestamps, media and generated copy unchanged.
- Browser: complete rental returned 1,000.00 ETB; refresh cleared the old display
  during loading; editing the price cleared and disabled the fee; saving a new
  price of 27,000.00 ETB still returned the same listing fee.
- Browser: mobile 390×844 and desktop 1280×900 had no horizontal page overflow.
  Mobile screenshot inspection confirmed readable fee text and controls.
- Browser: stopping the API cleared the amount and showed a connection error;
  restarting and retrying recovered. A simulated concurrent source edit caused
  version-mismatch guidance and disabled checking until saved details are reloaded.
  An incomplete land draft showed completion guidance with checking disabled.
- Sign-out hid the fee panel and cleared its amount. The original development
  account was restored and the disposable manual account and both listings removed.
- Dependency audit reported zero vulnerabilities. Configured database, Gemini and
  Geoapify secrets were absent from the browser build. Code review found no new
  authorization, fee-manipulation, XSS or response-race issues.

Device geolocation was not tested, as requested. Tests do not make payments or call
external geocoding/AI providers. No migration was needed.

## Changed files

- API: `apps/api/src/listing-fee.ts`, `apps/api/src/auth.ts`.
- Browser: `apps/web/src/listing-fee.ts`, `apps/web/src/listings.ts`,
  `apps/web/index.html`, `apps/web/src/style.css`.
- Tests: `tests/listing-fee-view.test.mjs`,
  `tests/integration/listing-fee.test.mjs`, `package.json`.
- Documentation: `README.md`, this guide.
