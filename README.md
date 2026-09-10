# AkGebeya

An npm monorepo with a backend foundation. Frontend, bot, and shared packages
remain empty placeholders.

## Backend (Step 2)

The backend uses Node.js, Express, strict TypeScript, CORS, Helmet, dotenv, Zod,
and Prisma. Use Node.js 22.14 or a compatible newer release.

From the repository root:

```sh
npm ci
npm run typecheck --workspace apps/backend
npm test --workspace apps/backend
npm run build --workspace apps/backend
npm start --workspace apps/backend
```

For development, run `npm run dev --workspace apps/backend`.
No lint tool is configured; typecheck and automated HTTP/configuration tests are
available. The build emits only backend runtime code into `apps/backend/dist`.

Optionally copy `apps/backend/.env.example` to `apps/backend/.env`. Configuration
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

Prisma includes an empty PostgreSQL schema. There are no
models, migrations, generated client, credentials, or database connections.
Database connectivity and client generation are deferred to a later step.
To validate the schema, copy `apps/backend/.env.example` to `apps/backend/.env`
and run `npm run prisma:validate --workspace apps/backend`. The example URL has
no credentials; validation does not connect to it. The server does not require
`DATABASE_URL`. Prisma CLI and client versions are selected by npm audit and
saved exactly by npm to avoid reintroducing the reported tooling advisories.
The health handler needs no service or repository because it has no business
logic or persistence. Authentication and Step 3 are not implemented.

The workspace paths are `apps/frontend`, `apps/backend`, `apps/bot`, and
`packages/shared`. Engineering rules are in `AGENTS.md`; project documentation
is in `docs/`, including `docs/ROADMAP.md`.
