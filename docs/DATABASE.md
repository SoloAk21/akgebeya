# Database foundation (Step 3)

PostgreSQL with PostGIS, managed through Prisma migrations. The database models
remain unchanged by [authentication Step 4.1](AUTHENTICATION.md). Payment processing
and listing behavior remain outside the database foundation.

## Database target and Neon

Application tables and Prisma migration history live in the `akgebeya` PostgreSQL
schema. PostGIS lives in `public`. The configured Neon development branch already
contained eleven empty legacy tables in `public`, including `Report`; those tables
are preserved and are not managed by this repository's migrations. This foundation
does not copy or migrate legacy records. Do not point this schema at a populated
legacy application and assume the data has been converted.

Keep connection strings only in the ignored `apps/backend/.env` or environment:

- `DATABASE_URL`: the Neon pooled endpoint, with `sslmode=require&schema=akgebeya`.
- `DIRECT_URL`: the matching endpoint without `-pooler` in its hostname, with
  `sslmode=require&schema=akgebeya`, used by migrations and database verification.

Both URLs must target the same database and application schema. Database tooling
validates them with Zod and requires TLS for Neon. Existing process environment
variables take precedence over `.env`. No credentials belong in Git or command-line
arguments. The example file contains only credential-free local placeholders.

## Models and integrity

| Model | Purpose and key relationships |
| --- | --- |
| User | Unique normalized email/phone, role, status, locale, optional referral code |
| Provider | One provider profile per user; English/Amharic names and descriptions |
| Listing | Provider and location, sale/rent type, property type, status and decimal price |
| Location | Separate English/Amharic address fields and a WGS84 spatial point |
| Payment | Paying user, optional listing, unique idempotency key and gateway reference |
| Session | User, unique token hash, expiry and revocation timestamps |
| Verification | Subject user, optional reviewer, type/status, hashed challenge or private identity documents |
| Media | Uploader, optional listing or verification, storage object key and private-by-default visibility |
| Referral | Referrer and uniquely attributed referred user; self-referrals rejected |
| Notification | User, type, separate English/Amharic title/body and read timestamp |

All ten tables have database-generated UUID primary keys, `createdAt`, and
`updatedAt` using timezone-aware timestamps. Prisma maintains `updatedAt` for ORM
updates; raw SQL writers must set it explicitly. English text is required for core
public content; optional Amharic fields use the `Am` suffix and remain null until
translated. Display names are user-entered rather than artificially translated.

Currency is currently ETB. Listing prices use `Decimal(18,2)`; payment amounts use
integer ETB minor units (`BigInt`, cents), with positive amounts and bounded refunds.
Future API serializers must handle Decimal/BigInt explicitly. Payment state is
storage only; these models do not verify a payment or authorize an action.

Session/challenge fields accept only 64-character lowercase hexadecimal hashes,
never bearer tokens. Identity verifications have no plaintext identity-number
field. Their media must remain private; generate authorized storage access in a
later step. Schema constraints do not replace future authentication, authorization,
or upload validation.

Financial and attribution relations use restricted deletion. Sessions and
notifications cascade with a deleted user. Optional media/listing and reviewer
relations use explicit deletion policies. Users/listings can be soft-deleted;
retention and anonymization policy are not implemented here.

The initial migration creates 14 foreign keys, 41 indexes (including primary and
unique indexes), and 24 CHECK constraints. Every foreign key has an index whose
leading column supports that relation. CHECK constraints cover normalized contact
identifiers, required content, valid dimensions/amounts, expirations, publication
state, private verification media, and self-referrals. These SQL checks are not
fully expressible in Prisma's schema language; retain them in migration history.

## PostGIS

The migration runs `CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public`
before creating application tables. It does not upgrade an existing PostGIS
installation. `locations.coordinates` is nullable `geography(Point,4326)` with a
GiST index. Geographic distances use meters; points take longitude before latitude.

Prisma represents the field as `Unsupported` and omits it from ordinary model
reads/writes. Use parameterized raw SQL for this field, with explicitly qualified
application tables and PostGIS functions, for example
`"akgebeya"."locations"` and `public.ST_DWithin`. A Prisma URL's `schema` selects
model tables but does not necessarily change the session search path for raw SQL.
The database test demonstrates a spatial write and distance query without adding
a listing service.

## Setup and verification

From the repository root, after setting the two URLs:

```sh
npm ci
npm run prisma:validate --workspace apps/backend
npm run prisma:generate --workspace apps/backend
npm run db:inspect --workspace apps/backend
npm run db:migrate --workspace apps/backend
npm run db:status --workspace apps/backend
npm run typecheck --workspace apps/backend
npm test --workspace apps/backend
npm run test:database --workspace apps/backend
npm run build --workspace apps/backend
```

`db:migrate` uses `prisma migrate deploy` to apply reviewed migration files. The
initial SQL is transactional, has lock/statement timeouts, and refuses a target
schema other than `akgebeya`. It was generated from the schema, then extended with
PostGIS and CHECK constraints. This workflow avoids a shadow database, destructive
reset, or accepting data loss. On an existing populated application schema, stop
and plan a reviewed baseline/data migration instead of resetting it.

Generated client files are ignored and must be regenerated after checkout or schema
changes, before typechecking/tests. The existing npm-managed Prisma versions are
unchanged. Database setup requires no additional packages.

The offline suite checks backend behavior and database configuration. The live
suite requires the migrated development branch: it checks actual catalog objects,
both Neon endpoints, relations, precision, uniqueness, foreign keys, CHECK
constraints and spatial operations. Database-foundation fixtures are created inside a
transaction and rolled back even on failure. Authentication integration tests use
uniquely identified temporary users/sessions and delete them in cleanup. Missing database configuration fails
explicitly; live checks are never silently skipped.

## Telegram identity migration (Step 4.2)

The second migration adds nullable unique User.telegramId (BIGINT) and extends
users_identity_check to require at least one of email, phone or telegramId.
Existing contact identifiers, relations and the original migration are unchanged.
There are now 42 application indexes and still 24 CHECK constraints.
See [Telegram authentication](AUTHENTICATION.md#telegram-authentication-step-42)
for identity mapping, configuration and verification.
