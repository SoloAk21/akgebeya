# Feature 11 — Private property photos

Approved providers can upload, preview, reorder, and remove photos from their own
private listings. The first photo is labelled Cover. Photos and their order survive
refresh and API restart. Media changes do not publish a listing or change its
DRAFT/COMPLETE state, text fields, location, or editing version.

## Processing and storage

Uploads accept JPEG, PNG, and WebP, up to 8 MiB each. The server validates the actual
format, rejects animated/unsupported or malformed input, and limits decoded images
to 25 million pixels. It applies EXIF orientation, flattens transparency onto white,
resizes within 1600×1600 without enlargement, and re-encodes JPEG at quality 80.
Embedded metadata, including GPS tags, is not retained. Stored output is limited to
1 MiB per photo and ten photos per listing. Original files and filenames are not stored.

The pipeline uses [Sharp](https://sharp.pixelplumbing.com/api-constructor/) with strict
decode limits and its [default metadata-stripping output](https://sharp.pixelplumbing.com/api-output/).
Sharp is a server dependency; no image decoder or credentials are added to the browser.

This milestone stores processed bytes in PostgreSQL `bytea` with media metadata.
This keeps insertion/deletion transactional, avoids orphaned external objects, and
uses the existing database backup/access controls. Metadata-list requests do not read
image bytes. Storage is bounded to 10 MiB per listing, but database storage, backups,
and transfer costs still grow with usage. Before scaling to a large public catalog,
move binary storage behind the media service to private object storage; this milestone
does not provide CDN delivery or unlimited media capacity.

No new environment variables, public bucket, cloud account, or storage credentials
are required. Reuse `DATABASE_URL` and `AUTH_ORIGIN`. Apply the additive migration
before starting the updated API; existing listings begin with an empty gallery.

## Security and concurrency

Every collection and image request checks the session and listing ownership.
Unapproved providers can still read their existing photos but cannot mutate them.
All writes require the exact configured Origin. Images are served only through the
authenticated API with `image/jpeg`, `no-store`, `nosniff`, restrictive CSP, and a
generated inline filename. There are no public static-file URLs or original filenames.

Each selected file gets a UUID upload ID. Identical retries return the same stored
image; reusing the ID for different bytes is a conflict. A separate media version
protects ordering and removal from stale clients. Reordering requires every current
photo ID exactly once, so it cannot move another account's photo into the collection.
Upload and ordering transactions lock the listing to enforce capacity under concurrency.

Each account is limited to 30 upload attempts per hour. Each API process permits
two concurrent uploads, with a 15-second body-read deadline and 10-second decoder
deadline. Rate-limit responses include `Retry-After`.

The browser keeps unsaved property text intact during media actions. Selected files
stay in page memory until uploaded or cleared. Sign-out/session expiry clears private media state. A failed or
uncertain upload keeps the selected file and retry ID for safe retry.

## API

- `GET /api/listings/<listing UUID>/media`: 200 `{ "media": [...], "version": 1 }`.
  Photo metadata includes `id`, authenticated `url`, `width`, `height`, `byteSize`,
  and `createdAt`, ordered with the cover first.
- `POST` to the collection: raw image bytes, supported image Content-Type, and
  `X-Upload-Id: <UUID>`. 201 for a new photo; 200 for an identical retry. Returns the
  collection and current media version.
- `PUT` to the collection: JSON `{ "version": 2, "mediaIds": ["..."] }` in desired
  order. 200 with the saved collection. No-op order changes preserve the version.
- `GET /api/listings/<listing UUID>/media/<media UUID>`: private processed JPEG bytes.
- `DELETE` from that image URL: JSON `{ "version": 3 }`. 200 with remaining photos.
- Errors: 400 invalid input/image, 401 no valid session, 403 rejected Origin or
  provider eligibility, 404 unknown/unowned record, 409 capacity/stale version or
  upload-ID conflict, 413 input/output byte limits (excessive decoded pixels return 400),
  415 unsupported media type, 429 throttling, and sanitized 503 for service failure.

## Verification commands

```bash
npm run db:generate
npm run db:migrate
npm run verify
npm run test:media
npm run test:listing-editing
npm run test:listing
npm run db:status
```

## Browser check

Use a disposable approved provider and listing; use synthetic test images, not
personal photos. Device location is not required.

1. Open `http://127.0.0.1:3000/`, sign in, and select the private listing.
2. Choose a JPEG file under 8 MiB and upload. Expect a private preview and Cover label.
3. Upload a second PNG or WebP. Move it earlier. Expect the new first photo as Cover.
4. Refresh and reopen the listing. Both images and their order should persist.
5. Edit the listing description without saving, then perform a media action. Expect
   the typed description to remain unchanged and unsaved.
6. Try a non-image renamed `.jpg`. Expect rejection and no new stored photo.
7. Remove one test photo. Refresh and verify the remaining collection persists.
8. At 390×844, verify file controls, previews, reordering, and removal are usable
   without horizontal scrolling. Restore normal viewport afterward.
9. Verify unavailable-service feedback and retry without duplication. Another account
   or a signed-out request must not retrieve the private image.

## Git Bash checks

Use `COOKIE` from an approved disposable account login and set `LISTING_ID` to its
own listing. Keep the cookie private. `PHOTO` must point to a synthetic JPEG fixture.

```bash
BASE=http://127.0.0.1:3000
PHOTO=/absolute/path/to/test-photo.jpg
UPLOAD_ID=26735d50-852d-4dc5-a95c-2d3da6b73ccd
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings/$LISTING_ID/media" -H "Cookie: $COOKIE"
# 200: empty or existing private collection and version.
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/api/listings/$LISTING_ID/media" \
  -H "Cookie: $COOKIE" -H "Origin: $BASE" -H 'Content-Type: image/jpeg' \
  -H "X-Upload-Id: $UPLOAD_ID" --data-binary "@$PHOTO"
# 201: stored photo. Repeat identical request: 200, no duplicate.
read -r -p 'Returned media UUID: ' MEDIA_ID
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' "$BASE/api/listings/$LISTING_ID/media/$MEDIA_ID" -H "Cookie: $COOKIE"
# 200: processed image/jpeg. Without a cookie: 401. Other owner: 404.
curl -sS -w '\nHTTP %{http_code}\n' -X PUT "$BASE/api/listings/$LISTING_ID/media" \
  -H "Cookie: $COOKIE" -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"version":1,"mediaIds":[]}'
# After an upload, stale version: 409; the image remains present.
```

## Verification record

Verified on 2026-09-16:

- `npm run verify`: typecheck, lint, all 37 unit tests, and production build passed.
- `npm run test:media`: passed real database/API checks for private image access,
  malformed uploads, idempotent/concurrent requests, capacity, ordering, deletion,
  stale versions, restart persistence, SQL constraints, and cascading cleanup.
  The first attempt could not reach Neon; the unchanged retry passed.
- `npm run test:listing` and `npm run test:listing-editing`: passed.
- Migration deployed; `npm run db:status` reports all ten migrations applied.
- Browser: synthetic JPEG/PNG uploads rendered correctly (1800×1200 resized to
  1600×1067); cover reordering preserved unsaved description text; a fake JPEG was
  rejected; selection clearing and photo removal worked; refresh retained the
  remaining cover. At 390×844 and 1280×900 there was no horizontal overflow.
- Browser: stopping the API produced actionable reload feedback; restarting and
  retrying restored the same collection. Sign-out cleared the private gallery.
  Database inspection confirmed listing version, text, and DRAFT status unchanged.
- Disposable accounts, listing, photos, and local synthetic files were removed.
  Device geolocation was not manually tested, as requested.

The four pre-existing dependency audit findings were resolved with scoped root
`overrides`: `@prisma/config` uses `deepmerge-ts` 8.0.0 and Prisma uses `mysql2`
3.24.4. Prisma remains 7.10.0. The public npm registry audit now reports zero
vulnerabilities. Prisma generation and migration-status checks pass with these
overrides. Reassess/remove the overrides when Prisma adopts patched dependencies.
The full verification command and media integration suite passed again after the
dependency updates. The browser code is unchanged from the manual checks above.

The [deepmerge-ts 8 release](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)
fixes recursive-object handling and changes Map merging; this project's Prisma
configuration uses plain objects, not Maps or custom merge callbacks. MySQL is
not a configured application database, but its transitive package is upgraded to
address the [compression advisory](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)
and the earlier authentication advisory.

## Changed files

- API: `apps/api/src/media.ts`, `apps/api/src/auth.ts`, `apps/api/package.json`.
- UI: `apps/web/src/media.ts`, `apps/web/src/listings.ts`,
  `apps/web/index.html`, `apps/web/src/style.css`.
- Database: `prisma/schema.prisma`,
  `prisma/migrations/20260916001000_listing_media/migration.sql`.
- Tests: `tests/media.test.mjs`, `tests/integration/media.test.mjs`.
- Setup/documentation: `package.json`, `package-lock.json`, `README.md`, this guide.
