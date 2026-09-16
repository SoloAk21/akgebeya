# Feature 13 — Private saved-property preview

An owner can open **Preview saved property** to inspect the saved listing in a
read-only property-page layout before payment or publication. It includes ordered
photos, the cover, exact ETB price, area and applicable rooms, description, location,
and provider display name/type. English and Amharic generated text can be selected
when it matches the current source version; original text is always available.

The reusable `property-view.ts` renderer establishes the display layout for the
future public-listing feature. There is no public route yet, so this milestone
cannot compare against an existing public page. Payment, publication, sharing,
contact and inquiry actions are not available in the preview.

## Behaviour

- Open a saved property, then choose **Preview saved property**. Unsaved property
  edits must be saved or explicitly discarded first. Opening/reloading the preview
  never saves, discards, completes, pays for or publishes anything.
- The modal loads a fresh saved snapshot, including current photo order. Select a
  thumbnail to inspect another photo; the first photo is the cover. Missing photos
  and unavailable images have explicit messages.
- Choose original, English or Amharic text. Outdated AI copy is excluded and the
  original saved title/description is shown with an explanation. Language selection
  affects this preview only and is not a publication preference.
- Incomplete drafts can be previewed with a draft warning and missing-value labels.
  A zero-bedroom apartment is shown as a studio. Land omits room fields. Rent prices
  are per month; sale prices have no monthly suffix. Decimal display avoids floating
  point conversion so large values keep their cents.
- The location shows the saved address when present, otherwise the selected subcity,
  and the saved pin coordinates. Viewing preview does not perform external map or
  geocoding requests. Owner-only preview access is not consent to publish coordinates;
  location disclosure must be decided before the later publication feature.
- Close or Escape aborts requests, removes private text and image sources, and returns
  focus to the opening control. Session expiry/reset closes and clears the preview.
  Native modal behaviour keeps keyboard focus inside while it is open.

## API, privacy and consistency

`GET /api/listings/:id/preview` returns:

```text
{ listing, media, mediaVersion, copy, copyStale, provider }
```

`listing` uses the existing saved-listing response. `media` contains ordered private
image metadata/URLs, never binary data. `copy` is null or the current persisted
bilingual draft with its source version and generation metadata. `provider` includes
only display name and provider type, never email, credentials or review details.

The endpoint authenticates the session and requires listing ownership. An owner can
still preview their property if provider approval later changes. Responses use
`Cache-Control: no-store`; private photo endpoints retain their ownership checks.
One PostgreSQL repeatable-read transaction gives a consistent snapshot of source,
photos, copy and provider fields. Image bytes load separately; if a photo is removed
after the snapshot, an image-error message asks the owner to refresh.

Expected statuses: 200 owner; 400 malformed ID; 401 signed out/expired; 404 missing
or other owner's listing; 405 unsupported method; sanitized 503 database failure.
No writes, external calls, new API keys, migrations or dependencies are required.
The renderer uses DOM text nodes, accepts only same-listing authenticated photo URLs,
validates response fields and rejects mismatched source/copy versions.

## Verification

Verified on 2026-09-16:

- `npm run verify`: typecheck, lint, 45 unit tests and production build passed.
  Preview validation tests and build were rerun after tightening enum-type checks.
- `npm run test:listing-preview`: real database/API tests passed for authenticated
  ownership, malformed IDs, unsupported methods, exact fields, private photo ordering,
  original/fresh/stale copy, repeated reads, source updates, revoked-provider access,
  session expiry and restart. Repeated preview reads left records, timestamps and
  versions unchanged; the injected AI generator received zero calls.
- Dependency audit: zero reported vulnerabilities. Browser build contains none of
  the configured database, Gemini or Geoapify secrets. No migration was necessary.
- Browser: original, English and Amharic text displayed; title markup rendered
  literally with no injected HTML; both synthetic photos loaded and thumbnail 2
  selected the second image. Unsaved edits disabled the opening button.
- Browser: Escape closed the modal, removed its images and restored opener focus.
  Saving a new fixture price changed the preview to 27,000 ETB/month and excluded
  outdated AI copy. A temporary database timeout showed retry feedback; refresh
  recovered the latest snapshot without changing source data.
- Mobile 390×844 and desktop 1280×900 checked; no horizontal overflow in the dialog.
- Empty land draft showed a draft warning, missing price/area/description, no-photo
  message, no generated-language options and no irrelevant room fields. Private
  content cleared on close/sign-out. All disposable test data was removed afterward.

Tests use disposable accounts and synthetic media/bilingual copy. They do not call
Gemini, publish anything, or use personal photos. Device-location testing is skipped
as requested. Public-route parity will be verified when that later feature exists.

## Changed files

- API: `apps/api/src/listing-preview.ts`, `listing.ts`, `auth.ts`.
- UI: `apps/web/src/property-view.ts`, `listing-preview.ts`, `listings.ts`,
  `style.css`, and `apps/web/index.html`.
- Tests: `tests/property-preview.test.mjs`,
  `tests/integration/listing-preview.test.mjs`.
- Setup/documentation: `package.json`, `README.md`, this guide.
