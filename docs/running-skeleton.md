# Feature 2 — Running AkGebeya Skeleton

## Tangible result

A local browser page calls the real backend health API, displays the server's response,
and supports recovery from a failed connection without reloading the page.

## Implementation

- Vite serves the TypeScript browser app on `127.0.0.1:3000`.
- Node HTTP serves `/api/health` on `127.0.0.1:3001`.
- Vite proxies `/api` to the backend in development and local build preview.
- API responses disable caching and contain no credentials or internal diagnostics.
- The browser validates the status, service identity, and timestamp; requests time out
  after five seconds and the retry control is disabled during a request.
- No database, worker, external integration, or Telegram behavior is introduced.

## Automated checks

```bash
npm ci
npm run verify
```

Expected: install, typecheck, lint, tests, and build all exit 0. Tests cover real HTTP
responses, repeated requests, HEAD, query strings, invalid methods, missing routes,
the client/API contract, malformed JSON, invalid payloads, and network failures.

## Exact browser test

1. Run `npm run dev` at the repository root.
2. Open http://127.0.0.1:3000.
3. Expect “You’re connected.” and “Connected”, service `akgebeya-api`, and a current
   server response time.
4. Click **Check again**. Expect a fresh successful response and an enabled retry button.
5. Refresh. Expect a new successful check; no saved or fabricated status is used.
6. At a 390-pixel mobile width, expect readable text, a usable full-width retry button,
   and no horizontal scrolling. Repeat **Check again**.

No form input or sample data is required.

## Failure and recovery

Stop the combined development command with Ctrl+C, then run the services in separate
terminals so the API can be stopped independently:

```bash
npm run dev --workspace @akgebeya/web
```

```bash
npm run dev --workspace @akgebeya/api
```

1. Open the same URL and confirm success.
2. Stop only the API terminal with Ctrl+C.
3. Click **Check again**. Within five seconds expect “Connection unavailable.”,
   a useful retry message, and no previous service/timestamp details.
4. Restart the API with the same command.
5. Click **Check again**. Expect “You’re connected.” without a page reload.

An HTTP/network error in browser developer tools during the intentional outage is
expected; an unhandled JavaScript error is not.

## Exact Git Bash API tests

Start the backend first. These commands need no secrets or sample input.

```bash
curl -i http://127.0.0.1:3001/api/health
```

Expected: HTTP 200; JSON `status: "ok"`, `service: "akgebeya-api"`, and a valid UTC
ISO `timestamp`. Headers include `Cache-Control: no-store` and JSON content type.

```bash
curl -i http://127.0.0.1:3000/api/health
```

Expected with both servers running: HTTP 200 and the same fields via the frontend proxy.

```bash
curl -i -X POST http://127.0.0.1:3001/api/health
```

Expected: HTTP 405; `error: "METHOD_NOT_ALLOWED"`; `Allow: GET, HEAD`.

```bash
curl -i http://127.0.0.1:3001/api/missing
```

Expected: HTTP 404; `error: "NOT_FOUND"`.

```bash
curl -I http://127.0.0.1:3001/api/health
curl -i 'http://127.0.0.1:3001/api/health?check=1'
curl -i http://127.0.0.1:3001/api/health
curl -i http://127.0.0.1:3001/api/health
```

Expected: all HTTP 200; HEAD has no body; the other requests return the three health
fields. Repeated requests are read-only and create no records.

Authentication/authorization failure tests and field-validation tests are not applicable:
this endpoint is intentionally public, accepts no data fields, and performs no mutations.
It does not set permissive CORS headers. Database/schema/persistence checks are not applicable.

## Built application

Run `npm run build`, then start `npm start --workspace @akgebeya/api` and
`npm run preview --workspace @akgebeya/web` in separate terminals. Repeat the browser
success and retry tests at the same URL to verify the generated frontend assets.

## Verification record — 2026-09-16

- Clean `npm ci --no-audit --no-fund`: passed.
- Typecheck, ESLint, all five tests, and production build: passed.
- Real HTTP checks: direct/proxied health 200, unsupported POST 405, unknown route 404.
- Browser: initial connection, retry with a new timestamp, and refresh passed.
- Mobile viewport 390 × 844: retry passed; document width and scroll width both 375 px
  (the remaining viewport width was occupied by the scrollbar).
- Actual backend shutdown: the browser showed the unavailable state and removed stale
  response details. Restarting the compiled API and retrying recovered without reload.
- Built frontend preview with compiled API: initial connection and retry passed; no
  console errors were captured in the browser check.
- Security scope: no credentials, state mutation, or persistent data; loopback-only
  listeners, no permissive API CORS, no-store responses, and text-only DOM updates.

The original foundation import test needed a real file URL instead of a data URL
because the TypeScript test runtime resolves source maps. The corrected test passed
without removing its compilation, declaration, or import checks.
