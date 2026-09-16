# Feature 7 — Admin provider verification

An administrator can inspect pending provider applications, approve one, or reject
one with a reason. The provider sees the saved status, review time, and optional note
after reloading their application or signing in again. Decisions are final in this
milestone; appeals, reversals, document uploads, and broader admin tools are not included.
Approval records a human review decision; the app does not independently verify
identity documents or email ownership.

## Administrator setup

There are no default administrators, public admin credentials, or email-based role
allowlists. New and existing accounts default to `isAdmin: false`. An operator with
database access grants a role to the exact UUID of an existing, trusted account:

```bash
npm run admin:access -- grant ACCOUNT_UUID
npm run admin:access -- revoke ACCOUNT_UUID
```

Replace `ACCOUNT_UUID` with that account's ID from its authenticated `/api/profile`
response or a trusted database lookup. Verify account ownership outside this app:
email strings are not ownership proof. These commands do not create accounts or
change passwords. Keep database credentials in the ignored `.env` file. Do not
grant admin access to the documented public-password sample account.

Role checks read the database on every request, so revocation also affects existing
sessions. A decision transaction locks the reviewer account against concurrent role
changes and locks the target application against competing decisions. Self-review
is forbidden and the review queue excludes the administrator's own application.

## Database and security

Migration `20260916000500_admin_provider_verification` adds the false-by-default role
and `provider_review` inside `akgebeya_foundation`. Existing records and legacy schemas
are preserved. Each review has the application ID as its primary key, reviewer ID,
decision, optional reason, and server-generated timestamp. Foreign keys enforce
relationships; checks forbid self-review, PENDING decisions, and rejection without
a meaningful reason. Reviewer deletion is restricted while their reviews exist.

Status and audit creation occur in one transaction. Identical decision/reason retries
return the original record and timestamp; a different decision or reason returns 409.
Competing administrators cannot overwrite each other. An audit insertion failure
rolls back the status change. Older terminal applications without an audit are not
silently rewritten. Direct database changes bypass the service's status/audit invariant
and must not be used as a review workflow.

Only administrators can read applicant names/emails or submit decisions. Public
registration/profile/provider payloads cannot set `isAdmin` or review fields. Providers
receive only their own review reason/time, not the reviewer's identifier. Mutations
require the exact configured Origin, a valid session, and bounded JSON. Strict enums,
UUID checks, parameterized queries, and text-only UI rendering prevent input/query/HTML
injection. Responses are uncached and unexpected errors return sanitized 503 responses.

The browser check reproduced a Prisma `P2028` transaction failure during sign-in.
The installed runtime defaults were 2 seconds to acquire a transaction and 5 seconds
for the entire transaction. The shared client now explicitly permits 5 seconds to
acquire and 15 seconds for the multi-statement transaction, while retaining 5-second
connection, query, and statement limits. This gives Neon round trips a bounded budget.
Errors log only a Prisma code and a timeout classification, never raw exception text.

## API contract

- `GET /api/admin/access`: authenticated 200 `{ "isAdmin": true|false }`.
- `GET /api/admin/provider-applications`: admin 200 `{ "applications": [...], "nextCursor": UUID|null }`.
  Returns at most 50 PENDING applications in ascending account-ID order. Pass
  `?cursor=<nextCursor>` for the next page. Reload starts at the first page.
- `GET /api/admin/provider-applications/<account UUID>`: admin 200 `{ "application": ... }`.
  Includes requested type, submitted time, name/email, status, and review audit.
- `POST` to the same URL accepts `{ "decision": "APPROVED" }` or
  `{ "decision": "REJECTED", "reason": "Please correct your provider type." }`.
  Optional approval notes and mandatory rejection reasons are trimmed and bounded to
  500 UTF-16 code units. Control/format characters and unknown fields are rejected.
  Success and identical retries return 200 with the stored application/audit.
- Unauthenticated/expired/revoked session: 401. Non-admin or self-review: 403.
  Invalid ID, cursor, or decision: 400. Missing application: 404. Wrong method: 405.
  Missing/foreign write Origin: 403. Wrong media type: 415. Body over 4096 bytes: 413.
  Already-reviewed conflict: 409 `ALREADY_REVIEWED`.

## Automated verification

```bash
npm run db:generate
npm run db:migrate
npm run verify
npm run test:admin
npm run test:provider
npm run test:profile
npm run test:auth
npm run test:database
npm run db:status
```

Admin integration tests use isolated fixture accounts and real HTTP/Neon operations.
They cover pagination, authorization, self-review, CSRF, validation, concurrent decisions,
duplicate requests, audit constraints, transaction rollback, provider visibility,
role revocation, session expiration, and persistence after server/client restart.
Cleanup removes only fixture applications/reviews before their accounts.

## Exact browser verification

1. Use two disposable provider accounts with pending OWNER applications, one to approve
   and one to reject. Record their emails. Use a separate trusted admin account granted
   access with the setup command above. Never approve the admin's own application.
2. Open `http://127.0.0.1:3000/` and sign in as the admin.
3. Under **Provider review**, select **Review <approval account email> (OWNER)**.
4. Choose **Approve** under **Decision**, leave the reason blank, and click **Save decision**.
5. Expect **Decision saved**, status APPROVED, and a review time. Refresh the selected
   application; its decision must remain the same and its decision form stays hidden.
6. Click **Reload review queue** and select **Review <rejection account email> (OWNER)**.
7. Choose **Reject**, leave the reason empty, and click **Save decision**. Expect required
   field validation. Enter `Please correct your provider type.` and save.
8. Expect REJECTED, the reason, and a review time.
9. Sign out and sign in as each provider. Expect Approved or Rejected respectively;
   the rejected provider sees `Please correct your provider type.`. Refresh and verify
   persistence. Ordinary users must not see the review queue.
10. Verify review controls and saved status at a 390-pixel mobile viewport with no
    horizontal overflow, then restore the normal viewport.

## Git Bash API verification

Use the trusted admin's existing credentials. Enter the UUID of a disposable pending
application. The cookie stays in a shell variable and must not be printed or shared.

```bash
BASE=http://127.0.0.1:3000
read -r -p 'Trusted admin email: ' ADMIN_EMAIL
read -r -s -p 'Admin password: ' ADMIN_PASSWORD; echo
export ADMIN_EMAIL ADMIN_PASSWORD
LOGIN_JSON=$(node -e 'process.stdout.write(JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD}))')
COOKIE=$(printf '%s' "$LOGIN_JSON" | curl -sS -D - -o /dev/null "$BASE/api/auth/login" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data-binary @- \
  | sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' | tr -d '\r')
unset ADMIN_PASSWORD LOGIN_JSON
# Login: 200 and HttpOnly session cookie.
curl -i "$BASE/api/admin/provider-applications" -H "Cookie: $COOKIE"
# 200, applications and nextCursor; only pending records.
read -r -p 'Disposable pending application UUID: ' APPLICATION_ID
curl -i "$BASE/api/admin/provider-applications/$APPLICATION_ID" -H "Cookie: $COOKIE"
# 200, application with status PENDING and review null.
curl -i "$BASE/api/admin/provider-applications/$APPLICATION_ID" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"decision":"REJECTED","reason":"Please correct your provider type."}'
# 200, REJECTED plus reviewerId, reason, and reviewedAt in review.
curl -i "$BASE/api/admin/provider-applications/$APPLICATION_ID" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' \
  --data '{"decision":"REJECTED","reason":"Please correct your provider type."}'
# 200, identical audit and timestamp; no duplicate.
curl -i "$BASE/api/admin/provider-applications/$APPLICATION_ID" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{"decision":"APPROVED"}'
# 409 ALREADY_REVIEWED, original rejection unchanged.
curl -i "$BASE/api/admin/provider-applications/$APPLICATION_ID" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{"decision":"REJECTED"}'
# 400 INVALID_REVIEW.
curl -i "$BASE/api/admin/provider-applications"
# 401 UNAUTHENTICATED; with an ordinary user's cookie expect 403 ADMIN_REQUIRED.
curl -i "$BASE/api/auth/logout" -H "Cookie: $COOKIE" \
  -H "Origin: $BASE" -H 'Content-Type: application/json' --data '{}'
# 200 signed_out.
unset COOKIE ADMIN_EMAIL APPLICATION_ID
```

## Verification record — 2026-09-16

- Typecheck, lint, 14 local tests, and production builds passed.
- Admin, provider, profile, authentication, and PostgreSQL/PostGIS integration
  suites passed against Neon; none were skipped. All five migrations are applied.
- Admin integration verified pagination with 55 fixture accounts, both decision
  outcomes, duplicates, races, audit constraints, rollback, and live role revocation.
- Browser approved one disposable application and rejected another after required
  reason validation. Reloading the selected approval preserved its decision/time.
- Both providers signed in, saw their respective decisions, and retained those
  decisions after refresh. The rejected provider saw `Please correct your provider type.`
  Neither provider saw the review queue.
- Mobile review submission passed at a 390×844 override (375px content/scroll width).
  The normal viewport was restored afterward.
- A direct database read verified APPROVED/REJECTED statuses, matching audit decisions,
  the correct reviewer, and timestamps. The temporary admin grant was revoked; all
  three manual fixture accounts, their applications, and audits were removed.
- Browser sign-in initially reproduced P2028; it passed after the explicit transaction
  budget adjustment. Authentication, provider, and admin suites also passed afterward.
- Review: no public role-grant route, user-controlled reviewer identity, self-review,
  role fields in profile responses, raw error logging, or HTML interpolation of notes.
