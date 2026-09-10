# AkGebeya

Step 1 establishes the monorepo layout and Git setup.

## Structure

```text
apps/
  frontend/
  backend/
  bot/
packages/
  shared/
package.json
tsconfig.base.json
.gitignore
README.md
```

The private root package declares these four npm workspace paths. Each workspace
currently contains only a `.gitkeep` so Git preserves its directory. Package
manifests, application code, dependencies, and application commands are deferred
to later steps. No dependency installation is needed for this scaffold.

`tsconfig.base.json` enables strict TypeScript checking for future packages to
extend. There is no TypeScript compiler dependency or application to build yet.

Repository engineering rules are in `AGENTS.md`; project documentation is in
`docs/`, including `docs/ROADMAP.md`.
