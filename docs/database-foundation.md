# Feature 3 — Database Foundation

## Scope

Prisma connects the API to PostgreSQL/PostGIS. An operator can save one controlled
record, terminate the process, and retrieve that same committed record in a new process.
This milestone adds no user, listing, authentication, or speculative location schema.

## Development setup (Git Bash)

1. Copy `.env.example` to `.env` at the repository root.
2. Set `DATABASE_URL` to a development Neon/PostgreSQL connection URL. Never put it in
   a `VITE_` variable, command argument, frontend file, or Git. Use verified TLS for Neon.
3. Optionally set `DIRECT_URL` to a direct connection for migration commands when using
   a pooler for runtime. Both URLs must target the same development database/schema.
   Migration metadata and the probe are isolated in `akgebeya_foundation`; the Prisma
   configuration enforces that schema even when the supplied URL has no schema parameter.
4. Run:

```bash
npm ci
npm run db:inspect
npm run db:status
```

Inspect the returned table/extension inventory before migrating an existing database.
On a new database, status reports the initial migration as pending. `db:inspect` never
prints connection URLs or row contents. Do not run the integration test on production.

```bash
npm run db:migrate
npm run db:status
npm run db:probe:write
npm run db:probe:read
```

Expected: migration applied and status up to date. Both probe commands return
`status: "ok"` and a record containing:

- `id: "foundation"`
- `message: "AkGebeya database foundation verified"`
- `createdAt`: the same creation timestamp on subsequent reads and repeated writes.

The read command runs in a separate process, proving persistence beyond an in-memory
client. Repeating the write maintains exactly one row. It is intentionally a local
operator command, not an unauthenticated HTTP write endpoint.

Restart the API after changing `.env`. Without database configuration, the server still
starts and `/api/health` remains available; `/api/ready` returns 503.

## Migration safety

`prisma/migrations/20260916000100_database_foundation/migration.sql` is an additive,
transaction-wrapped migration: enable PostGIS if needed, then create
`akgebeya_foundation.foundation_probe`. Prisma migration history also uses that isolated
schema. The existing `public`, `akgebeya`, and `pgboss` tables/history are not managed
by this new repository and must not be reset or baselined by it.
There are no resets, drops, destructive alterations, or changes to existing application
records. If the table already exists without this migration, stop and reconcile its
ownership/schema rather than resetting the database or marking an unverified migration
as applied. The singleton primary key and check constraint restrict the table to one
controlled record; a nonempty 120-character message limit is enforced by PostgreSQL.
There are no relationships in this milestone. PostGIS is verified with SRID 4326 and
a known longitude/latitude point; no property location records are invented.

## Exact HTTP checks

Start both services with `npm run dev`.

```bash
curl -i http://127.0.0.1:3001/api/ready
curl -i http://127.0.0.1:3000/api/ready
```

Expected after migration: HTTP 200 and `{"status":"ok","database":"ready"}`.
This checks PostGIS and the migrated table, not just connectivity. Responses use
`Cache-Control: no-store`; no credentials, database hostnames, or raw errors are returned.

```bash
curl -I http://127.0.0.1:3001/api/ready
curl -i -X POST http://127.0.0.1:3001/api/ready
curl -i http://127.0.0.1:3001/api/missing
```

Expected: HEAD 200 with no body; POST 405 with `error: "METHOD_NOT_ALLOWED"` and
`Allow: GET, HEAD`; unknown path 404 with `error: "NOT_FOUND"`.

For a configuration failure test, stop the API, temporarily remove DATABASE_URL from
the local configuration, and restart it:

```bash
curl -i http://127.0.0.1:3001/api/ready
curl -i http://127.0.0.1:3001/api/health
```

Expected: readiness 503 with `{"status":"unavailable","database":"unavailable"}`;
liveness 200 with `status: "ok"`, `service: "akgebeya-api"`, and a timestamp.
Restore configuration and restart to recover readiness. No HTTP authentication tests
are applicable: these checks are public, read-only, and expose no diagnostic secrets.

## Automated database verification

```bash
npm run verify
npm run test:database
```

The normal quality gates run without a database connection. The explicit integration
command requires the configured development database and fails if it is missing or
unavailable. It checks real persistence through separate connections, five concurrent
writes, uniqueness, singleton/nonempty/length constraints, PostGIS, and transaction
rollback. It leaves the one controlled record for manual read-back. Invalid writes
run inside rolled-back transactions and do not change the committed probe.

## Browser regression

Open http://127.0.0.1:3000, click **Check again**, and refresh. The existing connected
status must still work. No new browser form is needed for this operational milestone.
Use the proxied readiness curl command above to verify the database through the same
web origin. The in-app browser may block top-level navigation to a raw JSON response.

## Tooling references

- [Prisma 7 configuration](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
- [Neon PostGIS](https://neon.com/docs/extensions/postgis)

## Verification record — 2026-09-16

- Inspected the supplied Neon database before mutation. It already contained `public`,
  `akgebeya`, and `pgboss` tables, 13 existing application migrations, and PostGIS 3.6.0.
  Those tables and migration records were not modified by this feature.
- Applied the single additive migration in the unused `akgebeya_foundation` schema;
  Prisma reports the schema up to date.
- `npm run verify`: typecheck, lint, seven regression tests, and build passed.
- `npm run test:database`: real Neon/PostGIS integration passed, including separate
  connections, five concurrent writes, exact uniqueness/check/length errors, the
  accepted 120-character boundary, and rollback. Exactly one controlled row remains.
- Separate `db:probe:write` and `db:probe:read` processes returned the same record and
  creation timestamp.
- Compiled API and development API: readiness 200, HEAD 200, POST 405, liveness 200.
  The frontend proxy returned readiness 200.
- Browser reload and retry regression passed. The in-app browser blocked navigation
  to raw JSON; the proxied JSON response was verified using curl instead.
- `.env` and generated Prisma files are ignored. Only placeholder credentials appear
  in `.env.example`. The local connection uses certificate-verifying TLS.
- Docker startup was not approved, so database verification used the isolated schema
  in the supplied Neon database rather than a local container.

Two test failures were corrected and rerun: PostGIS lives outside Prisma's search path,
so its namespace is discovered from PostgreSQL's catalog and safely quoted; Prisma 7's
adapter reports PostgreSQL constraint codes in nested metadata, which the integration
test now checks explicitly. No validation or constraint was removed.

Future work must reconcile the pre-existing application's schema/history before reusing
it. This repository does not claim to implement the features represented by that older
migration history.
