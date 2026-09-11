# AkGebeya

An npm monorepo with a backend foundation. Frontend, bot, and shared packages
remain empty placeholders.

## Backend

The backend uses Node.js, Express, strict TypeScript, CORS, Helmet, dotenv, Zod,
and Prisma. Use Node.js 22.14 or a compatible newer release.

Copy `apps/backend/.env.example` to `apps/backend/.env` for local configuration.
The example URLs suffice for client generation; live database checks require your
configured development database. Starting the server also requires AUTH_JWT_SECRET and TELEGRAM_BOT_TOKEN
(see the authentication guide below). From the repository root:

```sh
npm ci
npm run prisma:generate --workspace apps/backend
npm run typecheck --workspace apps/backend
npm test --workspace apps/backend
npm run build --workspace apps/backend
npm start --workspace apps/backend
```

For development, run `npm run dev --workspace apps/backend`.
No lint tool is configured; typecheck and automated HTTP/configuration tests are
available. The build emits only backend runtime code into `apps/backend/dist`.

Backend configuration
is centralized and validated with Zod at startup. Defaults are development mode,
host `127.0.0.1`, port `3000`, and no allowed cross-origin browser origins.
`CORS_ORIGINS` accepts comma-separated HTTP(S) origins. Existing environment
variables take precedence over the `.env` file. Invalid configuration stops
startup without printing its values. Bind `HOST=0.0.0.0` when external access is
needed.

Manually check the running server:

```sh
curl -i http://127.0.0.1:3000/api/v1/health
```

Expected: HTTP `200`, JSON content type, and `{"status":"ok"}`. This is a process
health check; it does not query a database. Unknown routes return JSON `404`
errors; malformed JSON returns `400`, oversized JSON returns `413`, unsupported
body encodings return `415`, and unexpected errors return a generic JSON `500`.

## Database (Step 3)

The ten-model PostgreSQL foundation uses the `akgebeya` schema, with PostGIS and
versioned, transactional migrations. Existing legacy `public` tables are preserved.
See [database setup and design](docs/DATABASE.md) for Neon URLs, model relationships,
constraints, spatial queries, and verification commands.

```sh
npm run prisma:validate --workspace apps/backend
npm run db:inspect --workspace apps/backend
npm run db:migrate --workspace apps/backend
npm run db:status --workspace apps/backend
npm run test:database --workspace apps/backend
```

The health check does not query the database. Payment logic, listing services,
frontend/bot code and Google OAuth are not implemented.

## Authentication (Steps 4.1–4.2)

Database-backed JWT sessions now support `GET /api/v1/auth/me` and
`POST /api/v1/auth/logout`, with session revocation and role middleware. Telegram Mini Apps can log in through POST /api/v1/auth/telegram using server-verified initData. See [authentication setup and exact curl
commands](docs/AUTHENTICATION.md) for configuration, boundaries, and expected JSON.
Run `npm run verify:auth --workspace apps/backend` after building for live curl and
Session-row verification using a temporary development fixture.

The workspace paths are `apps/frontend`, `apps/backend`, `apps/bot`, and
`packages/shared`. Engineering rules are in `AGENTS.md`; project documentation
is in `docs/`, including `docs/ROADMAP.md`.

## Phone OTP (Step 4.3)

Phone OTP request/verify endpoints reuse the database-backed session service.
No SMS provider is implemented; phone authentication defaults to unavailable.
See [Phone OTP setup and manual curl/Postman verification](docs/PHONE_OTP.md).

```sh
npm run build --workspace apps/backend
node --import tsx apps/backend/scripts/verify-phone.ts
```

## Google authentication (Step 4.4)

POST /api/v1/auth/google verifies Google ID tokens and issues existing database-backed
sessions. Email conflicts require a later explicit account-linking flow.
See [Google setup and curl/Postman/real-login verification](docs/GOOGLE_AUTH.md).
