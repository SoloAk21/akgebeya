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

## Current capability

Feature 1 establishes the repository, strict TypeScript, linting, reproducible installation,
and independently compiled ES module workspaces. The source entry points are intentionally
empty scaffolding. There is no running website, HTTP server, database, or Telegram bot yet.

Feature 2 will provide a running browser application that calls the backend health API.
No API curl requests or database checks apply to this foundation milestone.

Build output is written to each workspace's `dist/` directory and is excluded from Git.
Keep credentials in untracked environment files; never commit real secrets.

See [the milestone record](docs/foundation.md) for scope and manual verification.
