# Authentication foundation (Step 4.1)

Only `GET /api/v1/auth/me` and `POST /api/v1/auth/logout` are added. There is no
login, signup, refresh, impersonation, or token-issuance HTTP endpoint. Telegram,
phone OTP, Google OAuth, provider verification, and payment/listing behavior remain
outside this step.

## Boundaries and trust

Routes validate requests with Zod. Authentication middleware delegates JWT/session
checks to `AuthService`; controllers only translate HTTP requests/responses.
`PrismaAuthRepository` performs all authentication database access using the
existing User and Session models. No migration is needed.

`createSessionForVerifiedUser` is an internal service method for future trusted
login adapters. Those adapters must verify identity before supplying a user ID.
Never bind this method directly to a client-provided user ID. It also rejects
missing, suspended, deactivated, and soft-deleted users.

Bearer JWTs use HS256 with an explicit issuer, audience, type, and expiration.
Each token has a cryptographically random 256-bit identifier (`jti`). The database
stores only its SHA-256 hash in `Session.tokenHash`, not the JWT or raw identifier.
The JWT contains no role or contact details. Every authenticated request verifies
the signature/claims, reloads the session and user, and checks revocation, both
expirations, subject matching, and active user state. Database failures fail closed.

User IDs/roles from headers, query parameters, request bodies, or JWT role claims
cannot choose the current user or grant permissions. `requireRoles('ADMIN')`, or an
explicit allow-list such as `requireRoles('USER', 'ADMIN')`, must follow
`authenticate(service)`. It uses the current database role; an empty role list
fails configuration. No administrative endpoint is added in this step.

Logout marks only the authenticated session's `revokedAt`. Other sessions remain
valid. Subsequent requests using the logged-out token receive 401, including a
repeated logout. Checks happen per request; an already-authorized in-flight request
is not cancelled by concurrent revocation. Expiration is fixed, not sliding, and
there is no refresh token. Session cleanup workers are not implemented.

## Configuration and build

Keep the existing database URLs in the ignored `apps/backend/.env` and add:

- `AUTH_JWT_SECRET`: at least 32 cryptographically random bytes encoded as unpadded
  base64url. There is no default, and startup rejects missing/weak configuration.
- `AUTH_SESSION_TTL_SECONDS`: defaults to 3600; accepted range is 60 through 86400.

Never commit, print, or log signing keys or bearer tokens. Use HTTPS outside local
development and share the configured signing key only among trusted backend
instances. Changing the key invalidates existing JWTs; database sessions do not
replace signature validation. Authorization uses a header, not cookies or URL
parameters. CORS permits Authorization and Content-Type for configured origins.

The local signing key was generated without displaying it. For a fresh deployment,
generate a random key in your secret manager and inject it through the environment.
Preserve existing local database credentials when adding configuration.

From the repository root:

```sh
npm ci
npm run prisma:generate --workspace apps/backend
npm run typecheck --workspace apps/backend
npm test --workspace apps/backend
npm run test:database --workspace apps/backend
npm run build --workspace apps/backend
npm start --workspace apps/backend
```

Generate Prisma for the deployment platform before building. The build copies its
native engine into `dist/generated/prisma` alongside the compiled client. Database
configuration is shared by the server and existing Prisma tooling; shutdown closes
the Prisma connection pool. No lint tool is configured.

## Exact curl commands and expected responses

With the server running on its default local port, use PowerShell:

```powershell
curl.exe --silent --show-error --include http://127.0.0.1:3000/api/v1/auth/me
curl.exe --silent --show-error --include --request POST http://127.0.0.1:3000/api/v1/auth/logout
'Authorization: Bearer invalid.token.value' | curl.exe --silent --show-error --include --header '@-' http://127.0.0.1:3000/api/v1/auth/me
```

Each returns HTTP **401** and:

```json
{"error":{"code":"UNAUTHORIZED","message":"Authentication required"}}
```

For a session issued through the trusted internal service, privately supply its
JWT as `AKGEBEYA_TEST_TOKEN`. These commands pass the header through stdin so the
token is not exposed in curl's command-line arguments:

```powershell
"Authorization: Bearer $env:AKGEBEYA_TEST_TOKEN" | curl.exe --silent --show-error --include --header '@-' http://127.0.0.1:3000/api/v1/auth/me
"Authorization: Bearer $env:AKGEBEYA_TEST_TOKEN" | curl.exe --silent --show-error --include --header '@-' --request POST http://127.0.0.1:3000/api/v1/auth/logout
"Authorization: Bearer $env:AKGEBEYA_TEST_TOKEN" | curl.exe --silent --show-error --include --header '@-' http://127.0.0.1:3000/api/v1/auth/me
```

The first returns HTTP **200** with the current database user's fields:

```json
{"user":{"id":"<verified-user-uuid>","email":"<email-or-null>","phone":null,"displayName":"<display-name>","role":"USER","preferredLocale":"en"}}
```

Values reflect the current user; email/phone can be JSON null. The second returns
HTTP **200** with `{"status":"ok"}` and sets the Session row's `revokedAt`. The third
returns the **401** JSON above. Missing, invalid, expired, revoked, and inactive-user
sessions intentionally share the same safe response. Auth responses use
`Cache-Control: no-store`; 401 includes `WWW-Authenticate: Bearer`.

Unexpected query/body fields return **400** with
`{"error":{"code":"BAD_REQUEST","message":"Invalid request"}}` after authentication.
An authenticated user without an allowed role gets **403** with
`{"error":{"code":"FORBIDDEN","message":"Access denied"}}` from the RBAC middleware.
There is no RBAC-only public test endpoint. Unexpected database errors return the
existing generic **500** JSON without token, key, or database details.

## Repeatable verification without exposing a token

```sh
npm run build --workspace apps/backend
npm run verify:auth --workspace apps/backend
```

The verifier starts the compiled server on a free local port, creates one uniquely
identified development user, calls the internal session service, and executes the
curl scenarios above plus an expired JWT and replayed logout. Tokens stay in
memory and are passed to curl through stdin. It verifies the actual Session hash
and revocation state, then removes its user/sessions and stops its server. It
refuses `NODE_ENV=production`; use only the configured development branch.

Automated tests cover claims/signatures/expiration, duplicate Authorization
headers, inactive users, logout/revocation, role changes, untrusted IDs/roles, safe
errors, and real Neon persistence. The live auth test creates isolated temporary
fixtures and deletes them in cleanup; it never modifies an existing user's session.
