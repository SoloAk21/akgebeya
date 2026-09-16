# Feature 8 — Location selection

A signed-in user chooses a location through Ethiopia → Addis Ababa city
administration → Addis Ababa → subcity, places a map pin or enters coordinates,
explicitly confirms it, and saves one private selection. A later save replaces that
account's selection. Refresh and later sign-ins restore it. This is an account
selection, not a published property listing.

## Coverage and map sources

Initial coverage includes Addis Ketema, Akaki Kality, Arada, Bole, Gulele, Kirkos,
Kolfe Keranio, Lideta, Nifas Silk Lafto, Yeka, and Lemi Kura. The eleven names are
supported by the [Addis Ababa City Council budget](https://www.aacitycouncil.gov.et/admin/uploads/7eabe3a1649ffa2b3ff8c02ebfd5659f).
[City-owned media confirms eleven subcities in 2026](https://www.amn.gov.et/en/addis-ababa-expands-addis-mesob-digital-service-centers-to-all-11-sub-cities-mayor/).
Stable application IDs use lowercase hyphenated names; these are application IDs,
not official administrative codes.

The permitted rectangle is latitude 8.8–9.15° N and longitude 38.6–39° E, including
its edges. It defines initial service coverage. It is **not an official city or
subcity boundary** and does not prove that a pin belongs to the selected subcity.
Subcity selection remains the user's declaration. Nationwide hierarchy, woreda
selection, official boundary polygons, address lookup, and location ownership
verification are not included. The interface states these limits.

Leaflet displays standard OpenStreetMap tiles with visible
[OpenStreetMap contributor attribution](https://www.openstreetmap.org/copyright).
Tile requests go directly from the browser to OpenStreetMap and reveal the viewed
map area to that service. There is no geocoding request or API key. Ordinary browser
caching and Referer behavior are preserved; there is no offline download or tile
prefetch. The [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
applies. Tiles are best-effort; the coordinate fields remain usable when the map
images cannot load. This dependency does not establish administrative boundaries.

## Data and security

Migration `20260916000600_location_selection` adds only
`akgebeya_foundation.account_location`. The account UUID is the primary key and a
cascading foreign key, so each account has at most one selection. PostgreSQL checks
the complete supported hierarchy, service rectangle, and true confirmation.
Latitude and longitude are required finite numbers within that rectangle. The API
validates bounds before rounding to six decimal places.

The `point` column is a generated PostGIS `geometry(Point,4326)`: X is longitude,
Y is latitude. Clients cannot provide or replace it. The migration resolves the
installed PostGIS namespace rather than assuming a search path. Existing schemas
and their data are untouched. Account deletion cascades to its saved selection.

Every endpoint requires a valid session. The server derives ownership from that
session, never from a submitted ID. JSON has exactly seven allowed fields; extra
fields, timestamps, geometry, and account IDs are rejected. Writes require the
configured exact Origin, application/json, and a body of at most 4096 bytes.
Parameterized queries protect database input. Responses are private and no-store;
they expose neither account IDs nor credentials. There is no per-account-ID route.

An atomic upsert serializes competing saves through the account primary key.
An identical normalized payload preserves `updatedAt`; a changed payload replaces
the complete selection and updates its timestamp. Concurrent different saves have
last-writer-wins behavior, with no mixed coordinates or duplicate records.

## Setup and automated verification

Use the existing ignored development `.env`. Apply the additive migration before
starting the new API; do not reset the database.

```bash
npm run db:generate
npm run db:migrate
npm run verify
npm run test:location
npm run test:auth
npm run test:profile
npm run test:provider
npm run test:admin
npm run test:database
npm run db:status
```

Local tests cover required fields, all eleven subcities, strict types, explicit
confirmation, finite coordinates, rounding, and rectangle edges. The real database
test uses disposable accounts to check options, authorization, session expiration,
CSRF, account isolation, body limits, concurrent saves, idempotent timestamps,
restart persistence, PostGIS SRID/X/Y/validity, database constraints, rollback, and
account-deletion cleanup.

## API contract

- `GET /api/location-options`: 200 with `country`, `region`, `city`, `subcities`,
  and `bounds`. Country is `ET`, region `addis-ababa`, city `addis-ababa-city`.
- `GET /api/location`: 200 with `{ "location": null }` before saving; otherwise
  `location` has `countryId`, `regionId`, `cityId`, `subcityId`, `latitude`,
  `longitude`, `confirmed: true`, and an ISO `updatedAt` timestamp.
- `PUT /api/location`: exactly the seven selection fields, excluding `updatedAt`;
  200 with the saved `location`, including on first creation and equal retries.
- Invalid selection: 400 `INVALID_LOCATION`; malformed JSON: 400 `INVALID_JSON`.
- Missing/expired/revoked session: 401 `UNAUTHENTICATED`.
- Missing/foreign write Origin: 403 `ORIGIN_REJECTED`.
- Wrong method: 405 (`Allow: GET, PUT` for location, `GET` for options).
- Wrong media type: 415; oversized body: 413; database failure: generic 503.
- `/api/location/<account-id>`: 404; another account cannot read this selection.

## Exact browser check

1. Open `http://127.0.0.1:3000/` with the API and browser application running.
2. Sign in as disposable account `auth-manual@example.test`, password
   `AkGebeya manual passphrase 2026!`. This is sample data, not a production account.
3. Under **Your location**, verify the preselected **Ethiopia**, **Addis Ababa**
   under **Region / city administration**, and **Addis Ababa** under **City**.
   These are the only supported parent choices. Choose **Bole** under **Subcity**.
4. Click the map to place a pin. Confirm that latitude and longitude update and the
   pin appears. Enter **Latitude** `8.995` and **Longitude** `38.785` for a repeatable
   final sample, and verify the pin moves to these coordinates.
5. Leave **I confirm this pin matches my selected location.** unchecked and choose
   **Save location**. Expect required-confirmation validation; no save occurs.
6. Check confirmation and choose **Save location**. Expect saved feedback with
   Bole and the coordinates. Save the same values again; expect the same saved
   selection. The API checks below verify that its timestamp remains unchanged.
7. Refresh, then choose **Reload location and map**. Expect Bole, `8.995`, `38.785`,
   and the saved selection restored. Sign out and back in; expect the same record.
   Signing out must hide and clear the account's location display.
8. Change either a hierarchy choice or coordinate. Confirmation must clear; a new
   save needs confirmation again. Restore the sample values, confirm, and save.
9. Enter latitude `38.785` and longitude `8.995`. Expect out-of-area validation and
   no overwrite. Restore `8.995` and `38.785`, confirm, and save.
10. At a 390×844 mobile viewport, inspect the selects, map, coordinate fields,
    confirmation, and save/reload controls. Expect readable controls and no horizontal
    overflow. Restore the normal viewport. Keep OSM attribution visible.

The sample account may already contain a selection. These steps deliberately save
the documented sample on that disposable account; do not replace a real user's data.

## Exact Git Bash API checks

The API cookie stays in a shell variable. Do not print or share it. The login must
return a cookie; a failed login makes the following authenticated checks return 401.

```bash
BASE=http://127.0.0.1:3000
COOKIE=$(curl -sS -D - -o /dev/null "$BASE/api/auth/login" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"email":"auth-manual@example.test","password":"AkGebeya manual passphrase 2026!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' | tr -d '\r')
curl -i "$BASE/api/location-options" -H "Cookie: $COOKIE"
# 200: ET / Addis Ababa / Addis Ababa and eleven subcities, plus service bounds.
curl -i "$BASE/api/location" -H "Cookie: $COOKIE"
# 200: location null or the existing private selection.
LOCATION='{"countryId":"ET","regionId":"addis-ababa","cityId":"addis-ababa-city","subcityId":"bole","latitude":8.995,"longitude":38.785,"confirmed":true}'
curl -i -X PUT "$BASE/api/location" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data "$LOCATION"
# 200: Bole, latitude 8.995, longitude 38.785, confirmed true, updatedAt.
curl -i -X PUT "$BASE/api/location" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data "$LOCATION"
# 200: identical updatedAt; one record remains.
curl -i -X PUT "$BASE/api/location" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"countryId":"ET","regionId":"addis-ababa","cityId":"addis-ababa-city","subcityId":"bole","latitude":38.785,"longitude":8.995,"confirmed":true}'
# 400 INVALID_LOCATION: swapped coordinates do not overwrite the saved selection.
curl -i -X PUT "$BASE/api/location" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"countryId":"ET","regionId":"addis-ababa","cityId":"addis-ababa-city","subcityId":"bole","latitude":8.995,"longitude":38.785,"confirmed":false}'
# 400 INVALID_LOCATION: explicit confirmation is required.
curl -i -X PUT "$BASE/api/location" -H "Cookie: $COOKIE" \
  -H 'Origin: https://attacker.example' -H 'Content-Type: application/json' --data "$LOCATION"
# 403 ORIGIN_REJECTED.
curl -i "$BASE/api/location"
curl -i "$BASE/api/location-options"
# Both 401 UNAUTHENTICATED.
curl -i "$BASE/api/location" -H "Cookie: $COOKIE"
# 200: the original valid sample remains after rejected writes.
curl -i "$BASE/api/auth/logout" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{}'
# 200: signed_out.
unset COOKIE LOCATION
```

## Verification record

Verified on 2026-09-16 against the configured development Neon database:

- `npm run verify`: PASS (typecheck, lint, 16 local tests, production builds).
- `npm run test:location`, `test:auth`, `test:profile`, `test:provider`,
  `test:admin`, and `test:database`: PASS. The first profile regression attempt
  failed while opening a database connection (connection timeout); an unchanged
  rerun passed. No validation or tests were disabled.
- `npm run db:migrate` and `db:status`: PASS; six migrations applied and current.
- Built website: real map click populated coordinates; required confirmation and
  swapped-coordinate validation blocked saves. Bole at 8.995, 38.785 persisted
  through refresh, map reload, and sign-out/sign-in. Sign-out cleared private UI.
- Mobile 390×844 override: readable map, visible attribution and pin, usable
  controls; rendered width and scroll width both 375px. Normal viewport restored.
- Built-preview HTTP checks: success, equal retries, invalid coordinates,
  unconfirmed selection, account-ID injection, unauthenticated access, CSRF,
  persistence after rejected writes, and logout all passed.
- Direct inspection of the browser-created sample: subcity `bole`, latitude
  8.995, longitude 38.785, PostGIS SRID 4326, X=38.785, Y=8.995.
- Security review: session-derived ownership, strict allowlist/body validation,
  exact-origin writes, parameterized SQL, generated geometry, atomic upsert,
  safe text rendering, logout clearing, and no committed credentials checked.
  Disposable integration accounts were removed by their test cleanup.

The new map types initially entered non-browser workspaces through TypeScript's
automatic type discovery. Explicit API (`node`) and shared (`[]`) type scopes
fixed the cause; all checks then passed. The sandbox also blocked test child
processes; verification passed with the required execution permission. The map
dependency was installed and the local server restarted before browser checks.
