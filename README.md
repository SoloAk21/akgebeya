# AkGebeya

An Ethiopian property marketplace, developed one verified product capability at a time.

## Requirements

- Node.js 22.x (minimum 22.14.0)
- npm 10.x (baseline: 10.9.2)
- Git

## Install and verify

Run these commands from the repository root in Git Bash, PowerShell, or a terminal:

```bash
npm ci
npm run verify
```

The verification command runs typecheck, lint, foundation tests, and builds all workspaces.
Each command is also available separately as `npm run typecheck`, `npm run lint`,
`npm test`, and `npm run build`.

## Structure

- `apps/web`: browser application workspace.
- `apps/api`: backend workspace.
- `packages/shared`: shared contract workspace.
- `tests`: repository foundation checks.
- `docs`: milestone scope and verification instructions.

## Run locally

```bash
npm run dev
```

Open http://127.0.0.1:3000. The page calls the real API at
http://127.0.0.1:3001/api/health through a same-origin development proxy.
Both servers bind only to this computer. Occupied ports cause startup to fail instead
of silently moving the app to another address. Press Ctrl+C to stop both services.

To check the built application, run `npm run build`, then in separate terminals:

```bash
npm start --workspace @akgebeya/api
npm run preview --workspace @akgebeya/web
```

The preview uses the same local URL and API proxy. Vite preview is a local build check,
not a production hosting server.

## Current capability

The running skeleton provides a browser app and public backend health endpoint. The page
shows the service and server timestamp, supports retry, and displays an error when
the API is unavailable or its response is invalid. Every reload makes a fresh request.
The health check proves the HTTP service is reachable. Feature 3 adds PostgreSQL/PostGIS
and a separate `/api/ready` database readiness endpoint. Copy `.env.example` to `.env`,
configure a development database, inspect it with `npm run db:inspect`, then apply the
additive migration with `npm run db:migrate`. Save and read the controlled record using
`npm run db:probe:write` and `npm run db:probe:read`. Run `npm run test:database` for real
database verification. Database setup is isolated in the `akgebeya_foundation` schema;
existing schemas and migration histories are preserved.

Feature 4 adds email/password accounts and database-backed sessions. Open the local
page to create an account, sign in, refresh with the session intact, and sign out.
Passwords are hashed and cookies are HttpOnly. Configure the exact `AUTH_ORIGIN`
before deployment; production requires HTTPS. Email ownership verification, recovery,
legacy-account linking, and Telegram sign-in are not implemented in this milestone.
Run `npm run test:auth` against the development database for the real authentication
integration test.

Feature 5 adds a saved display name to each account. Sign in, edit **Display name**,
and choose **Save profile**; the name persists across refresh and later sign-ins.
Run `npm run test:profile` for real database and account-isolation checks. See
[the profile guide](docs/profile.md) for API commands and browser verification.

Feature 6 adds provider applications for Owners, Brokers, Agents, Agencies, and
Developers. Signed-in users can submit once and see their saved verification status.
Applications start pending; Feature 7 adds admin review. Run
`npm run test:provider` for persistence, concurrency, and authorization checks. See
[the provider onboarding guide](docs/provider-onboarding.md) for exact verification steps.

Feature 7 adds an admin provider-review queue, protected approval/rejection actions,
and an atomic review audit. Providers see their decision and rejection reason after
reloading. No account is an admin by default; operators grant/revoke trusted account
UUIDs with `npm run admin:access -- grant|revoke ACCOUNT_UUID`. See
[the admin verification guide](docs/admin-provider-verification.md) for setup and tests.

Feature 8 adds a private saved location: Ethiopia → Addis Ababa city administration →
Addis Ababa → one of its eleven subcities. Choose a map pin or enter coordinates,
confirm the selection, and save it across refresh and later sign-ins. Coverage is
currently limited to an Addis Ababa service rectangle; official subcity boundaries
are not verified. Run `npm run test:location` for real PostGIS persistence and
authorization checks. See [the location guide](docs/location-selection.md) for
sample data, map attribution, limitations, and verification instructions.

The advanced location picker adds Geoapify autocomplete and reverse lookup,
optional device location, a draggable pin, and recent selections kept in memory.
Set the server-only `GEOAPIFY_API_KEY` in `.env` to enable address lookup; manual
coordinates remain available without it. See [advanced location setup and verification](docs/advanced-location.md).
Live checks found Addis Ababa landmarks and matched “Bolle” to Bole; the Amharic
query “ቦሌ” returned no suggestions. Coverage varies with the provider’s map data.

Feature 9 adds private listing drafts for approved providers. Enter a title, choose
Rent or Sale and a property type, then create a draft using your saved confirmed
location. Drafts retain their own location snapshot and remain available after
refresh. Run `npm run test:listing` for authorization, duplicate-request, snapshot,
and persistence checks. See [the listing draft guide](docs/listing-drafts.md).

Feature 10 adds private listing editing, partial draft saves, field validation, and
a COMPLETE readiness state. Add a description, ETB price, area, and applicable room
counts; the server checks completeness and rejects stale edits. COMPLETE listings
remain private. Run `npm run test:listing-editing`; see [the editing guide](docs/listing-editing.md).

Build output is written to each workspace's `dist/` directory and is excluded from Git.
Keep credentials in untracked environment files; never commit real secrets.

See [the authentication guide](docs/authentication.md) for sample data, exact curl
commands, browser checks, and security details; [the database guide](docs/database-foundation.md) for connection, migration, and
database verification steps, [the skeleton verification guide](docs/running-skeleton.md) for exact API and
browser tests, and [the foundation record](docs/foundation.md) for milestone history.
