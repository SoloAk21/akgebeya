# Feature 1: Project Foundation

## Scope

Initialize an npm monorepo, Git baseline, strict TypeScript compilation, ESLint,
and a repeatable validation command. Do not add speculative database schemas,
authentication, integrations, or application features.

The initial workspaces use ES modules and separate output directories. Shared code
has no browser-specific types. Framework selection and application runtime dependencies
belong to the running-skeleton milestone, where they can be tested end to end.

## Automated verification

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: every command exits with status 0. The foundation test independently compiles
each workspace into a temporary directory, verifies declaration output, and imports its
JavaScript. It cleans up only the temporary directory it created.

## Manual operational verification

From the repository root in Git Bash:

```bash
npm ci
npm run verify
node --input-type=module -e "await import('./apps/web/dist/index.js'); await import('./apps/api/dist/index.js'); await import('@akgebeya/shared'); console.log('AkGebeya foundation OK')"
git check-ignore apps/web/dist/index.js apps/api/dist/index.js packages/shared/dist/index.js .env
```

Expected: installation and quality gates succeed; the import command prints
`AkGebeya foundation OK`; Git lists all four ignored paths. No URL, browser control,
API, persistent database record, or Telegram action exists at this milestone.

## Next capability

Feature 2: start the browser app and backend locally and display the real backend health
response in the browser, including a useful error state when the backend is unavailable.

## Verification record (2026-09-16)

- Clean lockfile installation (`npm ci --no-audit --no-fund`): passed.
- Workspace typecheck and ESLint: passed.
- Foundation compilation/import test: passed (1 test).
- All workspace builds: passed.
- Manual built-module import command: printed `AkGebeya foundation OK`.
- Ignore checks for build output and `.env`: passed.

The Windows execution sandbox denied the test runner's child process (`spawn EPERM`).
The unchanged test command passed when rerun with approved execution outside the sandbox.
An initial lint failure for the test's `URL` reference was fixed by explicitly importing
`URL` from `node:url`; lint passed after that correction.

## Git checkpoint

Review and commit only intended foundation files after verification. Push to `origin/main`
when a remote is configured. A local checkpoint alone does not satisfy the roadmap's
requirement to push; report that limitation explicitly.
