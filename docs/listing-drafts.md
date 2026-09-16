# Feature 9 — Private listing drafts

An approved provider can create a private property draft with a title, transaction
type (rent or sale), and property type (apartment, house, land, or commercial).
Creation copies the account's saved, confirmed Addis Ababa location into the draft.
Changing the account location afterward does not move an existing draft.

Drafts belong to the signed-in account and are never public. This milestone creates
and reads drafts. [Feature 10](listing-editing.md) adds editing and completion;
media, payment, and publishing belong to later milestones. Each account may keep
up to 50 private listings, including COMPLETE listings.

## Data and authorization

The server derives ownership, status, timestamps, and the location snapshot. Clients
submit only a UUID request ID, title, transaction type, and property type. Titles are
trimmed, limited to 1–120 Unicode characters, and cannot contain control characters.
Unknown fields, including owner IDs, status, and location overrides, are rejected.

New drafts require an APPROVED provider application and a saved confirmed location.
Existing drafts remain readable by their owner if eligibility later changes.
Each account/request-ID pair is unique. Retrying an identical creation returns the
existing listing and its original location snapshot; changing the original creation
payload with the same request ID produces a conflict. Later edits are never reset by
a creation retry. The browser retains a request ID for an uncertain retry.
Refreshing after an uncertain submission should be followed by reloading drafts
before submitting a new request.

Creation serializes requests for an account, checks eligibility, and copies location
inside a transaction. Reads are bounded and ordered newest first. Authentication,
exact-Origin CSRF checks, the existing 4096-byte JSON limit, no-store responses,
parameterized database operations, and text-only rendering apply.

## API

- `GET /api/listings`: 200 `{ "listings": [...] }`, private drafts newest first.
- `POST /api/listings`: 201 `{ "listing": ... }` on creation, or 200 for an identical
  retry. Body example:
  `{ "requestId": "217b24dd-156e-48c4-b0ce-ea8f59420796", "title": "Bole apartment draft", "transactionType": "RENT", "propertyType": "APARTMENT" }`.
- `GET /api/listings/<UUID>`: 200 `{ "listing": ... }` for its owner; 404 for a
  nonexistent draft or another account's draft.
- Listing fields: `id`, `title`, `transactionType`, `propertyType`, `status: "DRAFT"`,
  `createdAt`, `updatedAt`, and `location`. Location contains the saved hierarchy,
  latitude, longitude, and nullable provider address independently of coordinates.
- Unauthenticated: 401; invalid input: 400; unapproved provider: 403;
  missing saved location or request conflict/draft limit: 409.
- Foreign/missing write Origin: 403; wrong method: 405; wrong content type: 415;
  oversized body: 413; unavailable database: sanitized 503.

## Setup and checks

No new environment variables or external services are required. Reuse `DATABASE_URL`
and `AUTH_ORIGIN`. Apply the additive listing migration before running the new API.
The existing `GEOAPIFY_API_KEY` is used by location search only; draft creation copies
the saved address and makes no geocoding request.

```bash
npm run db:generate
npm run db:migrate
npm run verify
npm run test:listing
npm run db:status
```

## Browser check

Use a disposable approved provider account with a saved Bole location, latitude
`8.995`, longitude `38.785`. Do not grant administrator access to a public-password
sample account. Approval must follow the existing provider review workflow.

1. Open `http://127.0.0.1:3000/` and sign in as that provider.
2. Open the private drafts panel. Submit with the title empty; expect required-field
   feedback without a new draft.
3. Enter `Bole apartment draft`, choose **Rent** and **Apartment**, and create.
4. Expect a private DRAFT with the same title and the saved Bole coordinates.
5. Refresh, select the saved draft, and verify the title, type, and location persist.
6. Create a second draft at a 390×844 viewport. Verify usable controls, detail view,
   and no horizontal overflow, then restore the normal viewport.
7. Sign out: no draft data should remain visible. Sign in as an unapproved account;
   expect creation to be refused and no access to the other account's drafts.
8. If a request fails, expect a visible error with reload/retry available. An uncertain
   retry of the same form values must not duplicate the draft.

Device-location testing is skipped at the user's request; use saved coordinates.

## Git Bash checks

Obtain a session cookie for a disposable approved provider using the login workflow
in [authentication.md](authentication.md). Keep it in `COOKIE` and do not print it.

```bash
BASE=http://127.0.0.1:3000
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings" -H "Cookie: $COOKIE"
# 200: listings array, empty for a fresh account.
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings" \
  -H "Cookie: $COOKIE" -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"requestId":"217b24dd-156e-48c4-b0ce-ea8f59420796","title":"Bole apartment draft","transactionType":"RENT","propertyType":"APARTMENT"}'
# 201: listing.status DRAFT and saved location. Repeat unchanged: 200, same ID/time.
read -r -p 'Returned draft UUID: ' LISTING_ID
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings/$LISTING_ID" -H "Cookie: $COOKIE"
# 200: identical draft. Another account's cookie: 404.
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings" \
  -H "Cookie: $COOKIE" -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"requestId":"217b24dd-156e-48c4-b0ce-ea8f59420796","title":"Changed title","transactionType":"RENT","propertyType":"APARTMENT"}'
# 409: original draft remains unchanged.
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings" \
  -H "Cookie: $COOKIE" -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"requestId":"217b24dd-156e-48c4-b0ce-ea8f59420796","title":"","transactionType":"RENT","propertyType":"APARTMENT"}'
# 400: invalid title.
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings"
# 401: authentication required.
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings" \
  -H "Cookie: $COOKIE" -H 'Origin: https://attacker.example' \
  -H 'Content-Type: application/json' --data '{}'
# 403: rejected Origin, no creation.
```

## Verification record

Verified on 2026-09-16:

- `npm run verify`: PASS — typecheck, lint, 30 local tests, and all production builds.
  Subsequent browser fixes passed targeted typecheck/lint and a fresh web build.
- `npm run test:listing`: PASS against the real development database. Covers strict
  input, authentication/CSRF, all provider eligibility states, owner-only reads,
  concurrent identical requests, request conflicts, location/address snapshot
  stability after account changes and restart, 50-draft limit races, SQL constraints,
  foreign keys, uniqueness, and cascading cleanup.
- `test:auth`, `test:provider`, `test:location`, and `test:database`: PASS.
- Migration `20260916000800_listing_drafts`: applied; all eight migrations are up to
  date. The new table and indexes are created in one transaction.
- Browser: pending provider's creation controls disabled; approved disposable
  provider's required-title validation, creation, detail selection, and refresh
  persistence passed. English rental/apartment and Amharic sale/house drafts worked.
- Mobile 390×844 override: creation passed, controls remained readable, and rendered
  and scroll widths both measured 375px. Normal viewport restored afterward.
- Direct database read matched three browser-created DRAFT records and their exact
  8.995/38.785 coordinates. The manual sample address was null; address snapshot
  preservation is separately covered with a clearly synthetic integration fixture.
- API-offline browser reload exposed a raw JSON parsing error during verification.
  It was fixed and retested: clear connection/reload feedback, creation paused,
  previously loaded drafts retained, and normal operation restored after reload.
- Review found an expired-session path that left sign-in disabled. Fixed and tested
  by expiring only the disposable account's session: private drafts cleared, sign-in
  controls enabled, and signing in again worked.
- Disposable manual accounts, audit/application, and drafts were removed. The
  existing sample account and its saved location were preserved. Device-location
  testing remained skipped at the user's request.

## Changed files

- `apps/api/src/listing.ts`, `apps/api/src/auth.ts`, `apps/api/src/server.ts`: private
  draft service, validation, and authenticated routing.
- `prisma/schema.prisma`, `prisma/migrations/20260916000800_listing_drafts/migration.sql`:
  additive draft persistence and database constraints.
- `apps/web/src/listings.ts`, `apps/web/src/account.ts`, `apps/web/index.html`,
  `apps/web/src/style.css`: responsive creation/list/detail UI and session lifecycle.
- `tests/listing.test.mjs`, `tests/integration/listing.test.mjs`, `package.json`:
  validation and real database/API verification.
- `README.md`, `docs/listing-drafts.md`: setup, scope, API examples, and verification.
