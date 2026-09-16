# Feature 6 — Provider onboarding

A signed-in user can apply as OWNER, BROKER, AGENT, AGENCY, or DEVELOPER and
view the saved verification status. Every application starts PENDING. The browser
shows the submitted type, status, and submission time after refresh or a later login.
Submitting an application grants no additional access or publishing permission.

One application is allowed per account. An identical retry returns the existing
application, including its original timestamp and current status. A different type
returns a conflict; changing, withdrawing, or resubmitting an application is outside
this milestone. Admin approval/rejection is now documented in
[Feature 7](admin-provider-verification.md).
No identity documents, phone numbers, or business details are collected here.

## Database and safety

`20260916000400_provider_onboarding` is an additive, transactional migration inside
`akgebeya_foundation`. It adds two enum types and the `provider_application` table.
The account UUID is both primary key and cascading foreign key. PostgreSQL enforces
one application per account, valid types/statuses, a required timestamp, and ownership
relationships. Existing accounts and legacy schemas are unchanged.

The API authenticates the session, derives the account ID on the server, validates
the exact JSON shape, and ignores no extra fields. Client-supplied account IDs,
status, timestamps, and roles are rejected. All writes require the configured Origin.
Reads are private and uncached. Enum allowlists and parameterized database operations
prevent query injection; UI values are written as text, never HTML.

A transaction inserts with duplicate skipping, then reads the saved application.
The primary key serializes competing insertions. Retries never update an existing
record or reset a review decision. Conflicting types produce 409 without mutation.
The operation creates at most one small record per authenticated account and has no
external side effects; account creation retains its existing rate limits.

Deploy the migration before the new API:

```bash
npm run db:generate
npm run db:migrate
npm run verify
npm run test:provider
npm run test:auth
npm run test:profile
npm run test:database
npm run db:status
```

## API contract

- `GET /api/provider-application`: 200 with `application: null` before applying,
  otherwise `application: { providerType, status, submittedAt }`.
- `POST /api/provider-application` with `{ "providerType": "OWNER" }`: 201 on
  creation, 200 for an identical repeat, 409 `APPLICATION_EXISTS` for a different type.
- Invalid input: 400 `INVALID_PROVIDER_APPLICATION`; malformed JSON: 400 `INVALID_JSON`.
- Missing/expired/revoked session: 401 `UNAUTHENTICATED`.
- Missing/foreign Origin on POST: 403 `ORIGIN_REJECTED`.
- Wrong method: 405 with `Allow: GET, POST`; wrong media type: 415 `JSON_REQUIRED`;
  body over 4096 bytes: 413 `BODY_TOO_LARGE`; database failure: generic 503.
- No per-account-ID URL exists: `/api/provider-application/<id>` returns 404.

## Exact browser check

1. Open `http://127.0.0.1:3000/` with the API and web server running.
2. Sign in using the disposable sample account `auth-manual@example.test` and
   password `AkGebeya manual passphrase 2026!`.
3. In **Become a property provider**, leave **Provider type** unselected and click
   **Submit application**. Expect the browser to require a selection.
4. Choose **Owner**, then click **Submit application**.
5. Expect **Owner**, **Pending review**, and a submission time. The form disappears;
   text explains that the application is saved but the account is not verified yet.
6. Refresh and then click **Reload application**. Expect the same type, status, and time.
7. Sign out and back in. Expect the same saved application; signed-out users see no
   application data.
8. At a 390-pixel mobile viewport, check readable controls and no horizontal overflow.
   Restore the normal viewport afterward.

The sample account can have an existing application from a previous verification.
In that case, verify its saved status; create a fresh disposable account to repeat
the first-submission test. Do not delete an existing application to replay these steps.

## Exact Git Bash API checks

These commands use the disposable manual account and retain its existing application.
For a fresh account, the first OWNER POST returns 201. After the browser check it
returns 200. Neither creates a duplicate or changes the submission time.

```bash
BASE=http://127.0.0.1:3000
COOKIE=$(curl -sS -D - -o /dev/null "$BASE/api/auth/login" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"email":"auth-manual@example.test","password":"AkGebeya manual passphrase 2026!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' | tr -d '\r')
# Login: 200 with an HttpOnly session cookie. Do not print or share COOKIE.
curl -i "$BASE/api/provider-application" -H "Cookie: $COOKIE"
# 200: application null or the saved application's type, status, and submittedAt.
curl -i "$BASE/api/provider-application" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{"providerType":"OWNER"}'
# 201 on first submission, otherwise 200; OWNER and PENDING on a newly created application.
curl -i "$BASE/api/provider-application" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{"providerType":"OWNER"}'
# 200: identical original submittedAt, no duplicate.
curl -i "$BASE/api/provider-application" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{"providerType":"BROKER"}'
# 409: APPLICATION_EXISTS; OWNER is unchanged.
curl -i "$BASE/api/provider-application" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{"providerType":"OWNER","status":"APPROVED"}'
# 400: INVALID_PROVIDER_APPLICATION; status is unchanged.
curl -i "$BASE/api/provider-application" -H "Cookie: $COOKIE" \
  -H 'Origin: https://attacker.example' -H 'Content-Type: application/json' --data '{"providerType":"OWNER"}'
# 403: ORIGIN_REJECTED.
curl -i "$BASE/api/provider-application"
# 401: UNAUTHENTICATED.
curl -i "$BASE/api/auth/logout" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{}'
# 200: signed_out.
unset COOKIE
```

The real-database integration test covers all five types with disposable accounts,
simultaneous identical/different submissions, session expiry/revocation, account
isolation, invalid input, foreign keys, uniqueness, enum constraints, and fresh
server/client reads. It simulates review decisions only on its own fixtures to
confirm retries cannot reset status. Cleanup removes only those fixture accounts
and verifies cascading application deletion.

## Verification record — 2026-09-16

- `npm run verify`: passed typecheck, lint, all 13 local tests, and production builds.
- `npm run test:provider`: passed all five types, same/different-type concurrency,
  ownership isolation, validation, status preservation, constraints, and persistence.
- Authentication, profile, and PostgreSQL/PostGIS integration suites passed without skips.
- Migration deployment and `npm run db:status`: all four migrations applied.
- Browser: required-selection validation, Owner submission, Pending review display,
  refresh, status reload, and mobile submission passed. Application data cleared
  on sign-out and the original application returned after signing back in.
- Mobile viewport override 390×844: rendered content and scroll widths both 375px;
  controls and saved status were readable, with no horizontal overflow.
- Direct Neon read: one OWNER/PENDING application linked to the sample account,
  submitted at `2026-09-16T10:53:13.575Z`.
- Independent HTTP check: repeat returned 200 with the original record, conflicting
  type 409, forged status 400, and anonymous read 401.
- Security review: ownership comes from the session; strict input rejects status
  escalation; no submitted HTML is rendered; no secrets are included in intended changes.
- Two earlier browser sign-in attempts returned generic 503 errors. Direct HTTP
  sign-in and readiness succeeded; the browser recovered, and a fresh complete
  sign-out/sign-in cycle plus the authentication regression suite passed. The
  original exception was not logged, so its precise cause could not be established.
  The API now logs only an allowlisted Prisma diagnostic code (or `UNEXPECTED`),
  never request data, credentials, or raw exception messages, if this recurs.
