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

Feature 2 adds a running browser app and public backend health endpoint. The page
shows the service and server timestamp, supports retry, and displays an error when
the API is unavailable or its response is invalid. Every reload makes a fresh request.
The health check proves the HTTP service is reachable; it does not check a database
or any future integration. There is no database, authentication, or Telegram bot yet.

Build output is written to each workspace's `dist/` directory and is excluded from Git.
Keep credentials in untracked environment files; never commit real secrets.

See [the skeleton verification guide](docs/running-skeleton.md) for exact API and
browser tests, and [the foundation record](docs/foundation.md) for milestone history.
