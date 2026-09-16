# Advanced location selection

This extends the private account location with address suggestions, reverse lookup,
and an optional device-location shortcut. The existing map, manual coordinates,
subcity declaration, and explicit confirmation remain the final selection controls.
Search suggestions are not a property catalog, verified addresses, or proof of
location ownership.

## Provider setup and coverage

Create a project in [Geoapify MyProjects](https://myprojects.geoapify.com/), then put
its API key in the ignored root `.env` as `GEOAPIFY_API_KEY=...`. Restart the API.
Keep the key server-side; do not put it in a `VITE_` variable, browser bundle,
screenshots, logs, curl examples, or Git. The server calls Geoapify over HTTPS.
A missing key disables provider lookup gracefully; manual pin placement remains
available. There is no public demo key or public Nominatim fallback.

[Geoapify autocomplete](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/)
accepts partial addresses and place names. Requests restrict results to Ethiopia;
English and Amharic are requested with `lang=en` and `lang=am`. A selected point can
bias nearby ranking. This influences result order, not administrative membership.
Available names, landmarks, translations, and typo matches depend on provider data.
Neither full Ethiopian coverage nor matching every misspelling is guaranteed.

Search can suggest places elsewhere in Ethiopia, but saving still requires the
existing Addis Ababa hierarchy and service rectangle: latitude 8.8–9.15 and
longitude 38.6–39.0. This rectangle is not an official boundary. Subcity remains
the user's declaration; a returned county or district is not automatically treated
as an Ethiopian subcity. Out-of-area suggestions must not bypass save validation.

[Reverse lookup](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/)
describes a nearby mapped address or feature. It must not silently move the user's
pin to that result's coordinate. Missing address components remain absent. An empty
result, timeout, unavailable provider, or exhausted rate limit leaves coordinates
usable and does not invent an address.

The provider requires an API key even on its free plan. Published on the
[pricing page](https://www.geoapify.com/pricing/) when checked on 2026-09-16: free
3,000 credits/day and up to five requests/second; autocomplete and reverse lookup
each consume one credit. The API 10 plan lists $59/month for 10,000 credits/day.
These are provider limits/prices, not a purchased subscription or a capacity promise
for this application. Search uses debounce and cancellation to reduce redundant
requests. [Public Nominatim explicitly forbids autocomplete](https://operations.osmfoundation.org/policies/nominatim/).

## Privacy and persistence

Device location is requested only after the user chooses its button, with high
accuracy requested, a 12-second timeout, and no cached position (`maximumAge: 0`).
If that request times out or reports an unavailable position, one standard-accuracy
request follows with a 15-second timeout and no cached position. Permission denial
never retries. The interface reports fallback progress and the returned accuracy;
it never substitutes an assumed location. Canceling by searching, moving the pin,
reloading, or signing out suppresses late callbacks and prevents further retries.
The browser controls permission; denial, timeout, or unavailable location must leave
manual selection available. Report the browser's accuracy estimate to the user.
High accuracy is a request, not a promise of an exact fix.

Search text and lookup coordinates go from this application to Geoapify. OSM tile
requests go directly from the browser to OpenStreetMap and reveal the viewed area.
These external requests can happen before saving; "not saved" does not mean
"never transmitted." Avoid entering sensitive personal details into address search.

Recent selections are held in browser memory only, at most five, and cleared on
sign-out. They are not written to local storage or saved as a history in the database.
The API separately keeps a bounded five-minute memory cache of provider responses
to avoid repeating identical lookups; cache keys are scoped to the account.
Choosing a suggestion, placing a pin, or receiving a device position changes the
draft only. A location is persisted only after confirmation and **Save location**.
Changing the point clears confirmation so a fresh save requires another review.

Optional address JSON is stored separately from the latitude, longitude, and
generated PostGIS point. It can be null when no address is available. Address text
does not replace coordinates as the location's source of truth. Each account still
has only one saved selection, and access remains bound to the authenticated session.

Geoapify permits storing results while retaining the source attribution or making
it visible when data is reused; see its [geocoding storage guidance](https://www.geoapify.com/geocoding-api/).
Display **Powered by Geoapify** linked to its website alongside geocoding results
and preserve **© OpenStreetMap contributors** linked to
[OSM copyright](https://www.openstreetmap.org/copyright). Do not hide attribution
under mobile controls. The [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
continues to apply: ordinary caching and Referer, no prefetch/offline tile downloads,
and best-effort availability.

## API contract and Git Bash checks

Both lookup endpoints require a valid session, the exact configured Origin,
`Content-Type: application/json`, and a body no larger than 4096 bytes.

- `POST /api/location-search`: `{ "query": "Bole", "language": "en" }`, with
  optional `proximity: { "latitude": 8.995, "longitude": 38.785 }`. Query length
  is 2–120 Unicode characters after trimming; language is `en` or `am`. Returns
  `200 { "results": [...] }`, including an empty array when nothing matches.
- `POST /api/location-reverse`: `{ "latitude": 8.995, "longitude": 38.785,
  "language": "en" }`. Returns `200 { "result": null }` or one result. The result
  keeps the requested coordinates. Lookup coordinate validation is a coarse
  Ethiopia-area rectangle, latitude 3–15 and longitude 32–48, not a boundary test.
- Each result contains `latitude`, `longitude`, and `address`. Address includes
  `formattedAddress`, nullable `city`, `subCity`, `woreda`, `neighborhood`, `street`,
  `landmark`, `placeId`, and `provider: "geoapify"`. Unavailable components remain
  null rather than inferred from arbitrary text. `subCity` and `woreda` remain null
  because the provider's generic district field is not verified as that hierarchy.
- `PUT /api/location` requires its seven existing selection fields and accepts
  optional `addressLanguage: "en" | "am"` for the saved address lookup.
  It does not accept client-provided address JSON. The server resolves an optional
  address for the submitted point; lookup failure permits saving with null address.
  `GET /api/location` includes the saved nullable address alongside the point.
  Save-time lookup requests that language, defaulting to English when omitted.
  The frontend sends the chosen address language. Migration `20260916000700_location_addresses`
  adds this address column with an object-or-null check.
- Invalid input: 400 `INVALID_GEOCODING_INPUT`; no session: 401; rejected Origin:
  403; wrong method: 405; excessive body: 413; wrong content type: 415. Lookup
  throttling returns 429 with `Retry-After`. Missing key returns 503
  `GEOCODING_NOT_CONFIGURED`; provider failure returns 502 `GEOCODING_UNAVAILABLE`.

Lookup admission is limited to 30 requests per account per minute and 2,800 per
application per day, including cache hits. Provider traffic additionally has a
process limit of four simultaneous requests and five starts per second. Responses
are bounded to 1 MB and lookups time out after five seconds. The daily budget is
conservative and must still be reconciled with other uses of the same provider key.

Obtain the sample account's cookie using the login command in
[location-selection.md](location-selection.md). Reuse its `BASE` and `COOKIE`
variables below; do not print or share the cookie. These commands never include the
provider key. Error responses must not contain it either.

```bash
curl -sS -X POST "$BASE/api/location-search" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"query":"Bole","language":"en","proximity":{"latitude":8.995,"longitude":38.785}}'
# Configured provider: results array. Missing key: GEOCODING_NOT_CONFIGURED.
curl -sS -X POST "$BASE/api/location-search" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"query":"ቦሌ","language":"am"}'
# Unicode query accepted; actual result coverage must be inspected.
curl -sS -X POST "$BASE/api/location-reverse" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"latitude":8.995,"longitude":38.785,"language":"en"}'
# Result null or address with the requested latitude/longitude preserved.
curl -sS -X POST "$BASE/api/location-search" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"query":"B","language":"en"}'
# 400 INVALID_GEOCODING_INPUT.
curl -sS -X POST "$BASE/api/location-search" -H "Cookie: $COOKIE" \
  -H 'Origin: https://attacker.example' -H 'Content-Type: application/json' \
  --data '{"query":"Bole","language":"en"}'
# 403 ORIGIN_REJECTED, no lookup performed.
curl -sS -X POST "$BASE/api/location-search" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"query":"Bole","language":"en"}'
# 401 UNAUTHENTICATED.
curl -sS -X PUT "$BASE/api/location" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"countryId":"ET","regionId":"addis-ababa","cityId":"addis-ababa-city","subcityId":"bole","latitude":8.995,"longitude":38.785,"confirmed":true}'
# 200; one saved point, nullable server-derived address.
curl -sS "$BASE/api/location" -H "Cookie: $COOKIE"
# Saved point and address survive a fresh read.
```

For actual response status checks, use `curl -w '\nHTTP %{http_code}\n'` in place
of `curl -sS`, or inspect status in the browser network panel. Do not include `-v`
or dump authentication response headers into shared logs.

## Exact browser checks

Use the running website at `http://127.0.0.1:3000/` and disposable account
`auth-manual@example.test`, password `AkGebeya manual passphrase 2026!`.
Do not perform these overwrites on a real user's account.

1. Sign in and open **Your location**. Select **Bole** as the subcity. With a valid
   provider key configured, type `Bole` into address search. Expect Ethiopian
   suggestions or an honest no-results message; choose an appropriate Addis result
   if offered. Its point should appear on the map without saving automatically.
2. Search `Meskel Square`, then `Bole International Airport`. Check each returned
   suggestion's actual label and coordinates. Do not count a similarly named place
   elsewhere as a successful landmark match. If either is missing, record that
   coverage limitation instead of inserting a fabricated result.
3. Switch to Amharic and search `ቦሌ`. Check that Unicode input is retained and the
   response is readable. Results depend on available localized names; do not treat
   fallback English text as proof of complete Amharic coverage.
4. Search `Bolle`. Record whether the provider offers the intended Bole location.
   A no-results response must remain usable and is not a promise of fuzzy matching.
5. Select a point and search again to inspect nearby ranking. Select several
   suggestions; recent selections should contain no more than five and allow
   returning to a previous point. Sign out and back in; that memory history must
   be empty. Saved location restoration is separate from recent history.
6. Search `Bahir Dar`. If a matching Ethiopian result is returned, select it and
   attempt to confirm/save. Expect out-of-service-area validation and no overwrite
   of the saved Addis location. Restore **Bole**, latitude `8.995`, longitude `38.785`.
7. Click or drag the map pin. Expect reverse lookup to show a nearby address when
   available without changing the chosen coordinate. Repeat quickly at another
   point; an older response must not replace the newest point's address.
8. Choose device location. Verify permission is requested only after the click,
   and test denial where the browser permits. Expect a useful message and usable
   map/coordinate inputs. If allowed, inspect the reported uncertainty; an
   out-of-area position still cannot be saved. Restore the sample coordinates.
9. With confirmation unchecked, choose **Save location**; expect required
   confirmation. Confirm and save the sample. Refresh and sign in again; expect
   the same point and any saved address restored. Changing either coordinate must
   clear confirmation and must not leave an old address presented as the new point.
10. Repeat with the provider key absent or provider access unavailable. Expect
    clear lookup-unavailable feedback; enter the sample coordinates manually,
    confirm, and save successfully with no fabricated address.
11. At 390×844, check search suggestions, language control, recent selections,
    device button, map, attribution, uncertainty, confirmation, and save controls.
    Verify no horizontal overflow and that keyboard focus can reach suggestions.

## Verification record

Verification on 2026-09-16 (complete with the user's manual device-test waiver):

- `npm run verify`: PASS — typecheck, lint, 28 local tests, and production builds.
- `npm run test:geocoding` and `npm run test:location`: PASS against the real
  development database with injected provider test fixtures. Includes English and
  Amharic address persistence, requested point versus provider centroid, clearing
  stale addresses after lookup failure, account isolation, CSRF, quota handling,
  restart persistence, generated PostGIS coordinates, and database constraints.
- Existing `test:auth`, `test:profile`, `test:provider`, `test:admin`, and
  `test:database`: PASS. No test disabled or skipped.
- Additive migration `20260916000700_location_addresses`: applied successfully.
  A later status invocation unexpectedly reported all migrations pending; direct
  inspection confirmed seven finished records and the address column, and the
  unchanged `db:status` rerun reported up to date. The discrepancy was not
  reproducible; no migration was reset or reapplied.
- Device-location unit tests: allowed position/accuracy and exact browser options,
  permission denied, unavailable, timeout, absent API, and invalid fix all PASS.
- Browser: device lookup timed out and correctly preserved the previous pin.
  Map click and actual pin drag updated coordinates and cleared confirmation.
  Missing-key search/reverse errors were explicit; no address was fabricated.
  English/Amharic input and language selection remained usable.
- Browser coordinate-only save at Bole, 8.995/38.785: PASS with explicit
  address-unavailable feedback; refresh restored the same point and null address.
- Mobile 390×844 override: readable controls, map and attribution; rendered and
  scroll widths both 375px. Normal viewport restored after checking.
- Reviewed strict input validation, session ownership, CSRF, cancellation,
  safe text rendering, parameterized persistence, account-scoped bounded caches,
  provider limits, and safe errors. Browser source/build contain neither
  `GEOAPIFY_API_KEY` nor an `apiKey=` provider request.

Live follow-up: `GEOAPIFY_API_KEY` became available through the API process
environment (not the root `.env`); only its presence was inspected, never its value.
The API was restarted to inherit it. Real requests found Bole, Meskel Square, and
Bole International Airport. The spelling `Bolle` matched Bole. The Amharic query
`ቦሌ` returned zero suggestions; the browser displayed its empty-results message.
Amharic reverse lookup returned a partially localized Meskel Square address.
Missing components remain null, and no fallback locations were fabricated.

Browser live checks passed for six-result suggestions, ArrowDown/Enter selection,
mouse selection of the airport, map centering, selecting a recent result, and
mobile layout (375px rendered/scroll width under the 390×844 override).
Reverse lookup resolved the selected point without replacing its coordinates.
The sample 8.995/38.785 resolved to “Lucky, BL_03_646 Street, 1044 Addis Ababa,
Ethiopia”. Browser confirmation/save and refresh passed. Direct database inspection
confirmed the normalized address separately from latitude/longitude and PostGIS
X=38.785, Y=8.995, SRID=4326. Recent selections were empty after refresh as intended.

At the user's explicit request, further manual testing of **Use My Current
Location**, including real permission-allowed/denied flows, is skipped because
they are using a PC. Automated allowed/denied/unavailable tests pass, but do not
establish actual device permission behavior. The observed timeout preserved the
pin correctly; a real successful device fix remains unverified. All other required
checks passed. Existing Feature 8 results are documented separately in
[location-selection.md](location-selection.md).

After the user reported another device timeout, the single-attempt behavior was
extended with the bounded standard-accuracy fallback described above. This improves
recovery when a precise fix is unavailable; it cannot force a position from a device
whose location service is disabled or unavailable. The previous advice to go outdoors
was replaced with instructions to check device Location Services and site permission.
`npm run verify` passed after this change: 28 tests, typecheck, lint and build.
New tests verify fallback success with reported accuracy, no retry after denial,
and cancellation suppressing late results and preventing another attempt.
Browser retest showed the standard-accuracy progress message, then timed out after
both attempts. The saved sample pin remained unchanged. A real successful device
fix is still unverified; fallback success is proven only by the automated test.

## Changed files

- `.env.example`, `README.md`, `package.json`: setup, provider key and test command.
- `apps/api/src/geocoding.ts`: provider adapter, validation, caching and limits.
- `apps/api/src/auth.ts`, `apps/api/src/server.ts`: authenticated lookup routes.
- `apps/api/src/location.ts`: server-derived address and chosen-language saving.
- `apps/web/src/location.ts`, `apps/web/src/location-client.ts`: picker and device helper.
- `apps/web/index.html`, `apps/web/src/style.css`: responsive picker controls.
- `prisma/schema.prisma`, `prisma/migrations/20260916000700_location_addresses/migration.sql`: nullable address storage.
- `tests/geocoding.test.mjs`, `tests/location-client.test.mjs`, `tests/location.test.mjs`: provider/device/input checks.
- `tests/integration/geocoding.test.mjs`, `tests/integration/location.test.mjs`: API/database checks.
- `docs/advanced-location.md`, `docs/location-selection.md`: contracts, setup and verification.
