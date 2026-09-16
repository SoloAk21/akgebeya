# Feature 10 — Listing editing and validation

An approved provider can edit a private listing, save partial details as DRAFT,
and mark valid details COMPLETE. COMPLETE is a readiness state only: the listing
remains private and is not published, payable, or publicly searchable.

The editor reuses the existing private listing list/detail workflow. It edits the
title, offer, property type, description, price in ETB, area in square metres,
bedrooms, and bathrooms. The saved property location remains unchanged.

## Validation rules

- Title: trimmed and Unicode-normalized, 1–120 characters.
- Description: up to 2,000 Unicode characters; at least 20 to complete. Line breaks
  and tabs are allowed; other control and invisible formatting characters are rejected.
- Price: optional on a draft; required to complete. Positive ETB amount with at most
  two decimal places, up to 999,999,999,999.99. Rent is the monthly amount; sale is
  the asking price. Currency is fixed to ETB.
- Area: optional on a draft; required to complete. Positive square metres with at
  most two decimal places, up to 999,999,999.99.
- Bedrooms and bathrooms: nullable whole numbers from 0 to 100. Apartments/houses
  require bedrooms (0 means studio) and at least one bathroom to complete.
  Land has neither room field. Commercial property has no bedroom field and may
  optionally include bathrooms.
- Existing offer/property allowlists, service-area constraints, and ownership rules
  remain in force. Unknown fields and client-supplied ownership/status/location are
  rejected. Completion is derived and checked by the server.

Numeric decimal values travel as strings and use database decimal columns; prices
are not rounded through binary floating point. `null` means unfinished, not zero.
Draft saves may omit completion requirements through null/empty values, but malformed
or out-of-range values cannot be saved. Failed validation does not mutate the listing.

## Concurrency and privacy

Every listing has a positive integer version. Updates submit the last loaded version;
the server atomically locks and checks ownership, provider approval, and version.
A competing or stale update receives 409 and cannot overwrite newer work. The browser
retains local input and offers an explicit reload/discard action. After an uncertain
save, reloading confirms the saved version before another edit.

Saving as draft returns COMPLETE listings to DRAFT. Marking complete validates the
submitted details and saves them as COMPLETE in the same transaction. A no-op update
can preserve the version and timestamp. Existing creation request IDs retain their
original creation payload, so an old creation retry never resets edited details.

Read access remains owner-only even after provider eligibility changes. Editing
requires current approval. Session expiry clears private content and permits sign-in
again. No third-party calls or additional environment variables are introduced.

## API

`PUT /api/listings/<UUID>` requires an authenticated session, exact configured Origin,
and JSON with exactly these fields:

```json
{
  "version": 1,
  "title": "Two-bedroom apartment in Bole",
  "transactionType": "RENT",
  "propertyType": "APARTMENT",
  "description": "Bright two-bedroom apartment with a separate kitchen.",
  "priceEtb": "40000.00",
  "areaSqm": "95.50",
  "bedrooms": 2,
  "bathrooms": 1,
  "complete": true
}
```

- 200: `{ "listing": ... }`, including `version`, editable fields, status, and
  `missingFields` alongside the existing timestamps and location snapshot.
- 400: malformed or invalid field values. 422: missing completion requirements.
  Field validation responses include a `fieldErrors` object for inline feedback.
- 401: session missing/expired; 403: wrong Origin or unapproved provider;
  404: unknown or other account's listing; 409: stale version.
- 415: non-JSON request; 413: over 16 KiB. Only the listing-edit endpoint gets the
  larger bound needed for Unicode descriptions; other existing endpoints stay at
  4096 bytes. Unsupported methods return 405; unexpected service errors remain generic.

## Migration and checks

Stop the old API, apply migration `20260916000900_listing_editing`, and start the new
API together. Old creation code does not populate the new required creation payload,
so a mixed old/new deployment is not supported by this local milestone. Existing rows remain
DRAFT at version 1 with empty description and nullable numeric fields. Their original
creation payload is backfilled before editing becomes available. Database constraints
enforce allowed state, numeric ranges, applicable rooms, and COMPLETE requirements.

```bash
npm run db:generate
npm run db:migrate
npm run verify
npm run test:listing-editing
npm run test:listing
npm run db:status
```

## Browser verification

Use a disposable approved provider with a confirmed saved Bole location at
8.995/38.785. Device-location testing remains skipped at the user's request.

1. Open `http://127.0.0.1:3000/`, sign in, and create an apartment rental draft.
2. Select it, then try to mark it complete without details. Expect field errors for
   description, price, area, bedrooms, and bathrooms; it must remain DRAFT.
3. Enter title `Two-bedroom apartment in Bole` and description
   `Bright two-bedroom apartment with a separate kitchen.` Save as draft with some
   required details unfinished. Refresh and reopen; expect partial values preserved.
4. Enter price `40000.00`, area `95.50`, bedrooms `2`, bathrooms `1`.
   Mark complete. Expect COMPLETE with the same location and no public publication.
5. Refresh and select it again; expect all values/status persisted.
6. Check a price of `-1` or too many decimal places: clear validation and no mutation.
7. Test the editor at 390×844 with readable labels, error messages, buttons, and no
   horizontal overflow. Restore the normal viewport.
8. Simulate a newer saved version in a second client; submitting the older version
   must preserve unsaved input and show a conflict/reload choice, never overwrite it.
9. Stop the local API during a save to check clear error feedback and retained input.
   Restore it and reload to reconcile the state. Sign out and confirm private data clears.

## Git Bash API check

Obtain an approved provider's session in `COOKIE` using the authentication guide.
Set `LISTING_ID` to that account's existing draft UUID and use its current `version`.
Keep the cookie private.

```bash
BASE=http://127.0.0.1:3000
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings/$LISTING_ID" -H "Cookie: $COOKIE"
# 200: current version and editable details.
curl -sS -w '\nHTTP %{http_code}\n' -X PUT "$BASE/api/listings/$LISTING_ID" \
  -H "Cookie: $COOKIE" -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"version":1,"title":"Two-bedroom apartment in Bole","transactionType":"RENT","propertyType":"APARTMENT","description":"Bright two-bedroom apartment with a separate kitchen.","priceEtb":"40000.00","areaSqm":"95.50","bedrooms":2,"bathrooms":1,"complete":true}'
# 200: COMPLETE if current version was 1; otherwise 409, no overwrite.
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings/$LISTING_ID" -H "Cookie: $COOKIE"
# 200: stored values/status/version and unchanged location.
```

## Verification record

Verification on 2026-09-16:

- `npm run verify`: PASS — typecheck, lint, 33 local tests, and production builds.
  The subsequent intentional sign-out guard passed targeted typecheck/lint and
  a fresh web production build.
- `test:listing-editing`, `test:listing`, `test:auth`, and `test:database`: PASS
  against the development database. No tests disabled or skipped.
- The editing integration suite verifies exact decimal limits, Unicode and CRLF,
  partial saves, inline completion errors without mutation, COMPLETE and reopening,
  no-op version stability, stale and concurrent updates, owner/provider permissions,
  unchanged location, preserved creation retries, body limits, SQL constraints,
  restart persistence, and fixture cleanup.
- Migration applied in a transaction; all nine migrations are up to date. A draft
  created through the old API before migration retained its original title, status,
  and coordinates afterward, with version 1, empty description, nullable numbers,
  and its original creation payload preserved.
- Browser: incomplete completion showed all five applicable field errors and focused
  the first invalid field. Negative price was rejected without losing input. Partial
  title/description saves survived refresh. Intentional sign-out with unsaved edits
  was blocked with explicit save/discard guidance.
- Mobile completion at 390×844 passed with price `40000.00`, area `95.50`, two
  bedrooms, and one bathroom. Rendered and scroll widths both measured 375px, and
  controls remained readable. Normal viewport restored afterward.
- Completed details survived refresh, remained private, and retained 8.995/38.785.
  Direct database inspection matched COMPLETE/version 3 and the entered values;
  the preserved creation payload still contained the original title.
- Browser conflict check: the newer version 4 price `41000.00` stayed unchanged;
  the stale editor retained `42000.00`, displayed conflict guidance, and disabled
  repeated saves until an explicit reload. Reload restored the newer saved value.
- Browser offline save: clear connection feedback preserved `43000.00` in the
  editor. Restoring the API and retrying succeeded as DRAFT/version 5. Direct database
  inspection confirmed the recovered save. These remaining test-only submissions
  proceeded after the user authorized continuing following automatic approval review.
- Sign-out cleared private editor data. Disposable accounts, review/application, and
  listing were removed, with zero fixture records remaining. The original sample
  account was restored; its saved location was not changed. Device-location testing
  remained skipped at the user's request.

## Changed files

- `apps/api/src/listing-validation.ts`, `apps/api/src/listing.ts`, `apps/api/src/auth.ts`:
  validation, private editing/completion, version checks, and route/error handling.
- `prisma/schema.prisma`, `prisma/migrations/20260916000900_listing_editing/migration.sql`:
  editable fields, creation-payload preservation, and database constraints.
- `apps/web/src/listings.ts`, `apps/web/src/account.ts`, `apps/web/index.html`,
  `apps/web/src/style.css`: editor, inline feedback, conflict and unsaved-change UX.
- `tests/listing-editing.test.mjs`, `tests/integration/listing-editing.test.mjs`,
  `tests/integration/listing.test.mjs`, `package.json`: checks and test command.
- `README.md`, `docs/listing-drafts.md`, `docs/listing-editing.md`: scope, rollout,
  API examples, and verification record.
