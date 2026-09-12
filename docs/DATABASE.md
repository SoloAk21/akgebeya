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

## Phone OTP migration (Step 4.3)

The new PhoneOtp table has a unique normalized phone, keyed OTP hash, expiration,
resend cooldown, failed-attempt counter and consumption/revocation timestamps.
It adds four indexes and seven checks: the application schema now has eleven
tables, 46 indexes and 31 CHECK constraints. Existing models and applied migrations
are unchanged. See [Phone OTP](PHONE_OTP.md) for atomicity and verification.

## Google identity migration (Step 4.4)

The new migration adds nullable unique User.googleSub (VARCHAR(255)) and rejects
blank/whitespace-only subjects. The existing identity CHECK and all other models
remain unchanged. There are now 47 indexes and 32 CHECK constraints.
See [Google authentication](GOOGLE_AUTH.md) for verification and account conflicts.

## Provider verification (Step 4.5)

Provider profiles, review requests, ADMIN decisions and provider authorization are
documented in [Provider verification](PROVIDER_VERIFICATION.md).
The new migration preserves legacy null roles and existing authentication data.

## Listing draft migration (Step 4.6)

The new listing_draft_foundation migration requires an empty listings table and
replaces the property taxonomy without changing existing applied migrations.
Draft details become nullable; category/type compatibility, supplied content,
finite positive prices/dimensions, non-DRAFT completeness and draft publication
safety are enforced by CHECK constraints. All existing indexes/FKs remain.
There are 48 application indexes and 36 CHECK constraints.
See [Listing drafts](LISTING_DRAFTS.md) for the exact taxonomy, concurrency contract,
preservation checks and rollback-isolated live database tests.

## Listing completion migration (Step 4.7)

One new migration adds COMPLETE/VALIDATE and requires unpublished DRAFT, COMPLETE
and VALIDATE rows. Existing statuses, columns, defaults, indexes, foreign keys,
rows and the PUBLISHED constraint are preserved. Counts remain 48 indexes and
36 CHECK constraints. See [Listing completion](LISTING_COMPLETION.md).

## Listing AI assist migration (Step 4.8)

One new migration adds AI_ASSIST and extends the unpublished-state CHECK.
AI_ASSIST requires non-null Amharic title/description, alongside the existing
nonblank and non-DRAFT completeness checks. Existing rows, columns, defaults,
indexes/FKs and the PUBLISHED check remain unchanged. Counts are 48 indexes and
37 CHECK constraints. See [Listing AI assist](LISTING_AI_ASSIST.md).

## Listing preview migration (Step 4.9)

One new migration adds PREVIEW and extends the existing unpublished-state and
bilingual-content CHECKs to cover it. Existing rows, columns, defaults, indexes,
foreign keys and all other checks are preserved. Counts remain 48 indexes and
37 CHECK constraints. See [Listing preview](LISTING_PREVIEW.md).

## Listing fee migration (Step 4.10)

One new migration adds CALCULATE_FEE and an immutable ListingFeeQuote table with
a unique listing relation, exact V1 amount/currency/version, source ETag and
calculation/creation timestamps. Quotes have no mutable updatedAt or expiry.
Deferred triggers enforce quote/state agreement at commit; publication and
bilingual checks extend to CALCULATE_FEE. Existing records and schema objects
remain unchanged. Counts are 12 application tables, 50 indexes and 40 CHECKs.
No Payment row is created. See [Listing fee](LISTING_FEE.md).
