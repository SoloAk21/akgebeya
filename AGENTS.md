# AkGebeya Engineering Rules

Work on ONE task at a time.

Flow:

TASK
→ INSPECT
→ IMPLEMENT
→ RUN
→ TEST
→ FIX
→ RETEST
→ VERIFY
→ REVIEW DIFF
→ COMMIT
→ PUSH
→ STOP

Never automatically continue to another task.

## Rules

- Inspect existing files before editing.
- Do not modify unrelated files.
- Do not implement future tasks.
- Use strict TypeScript.
- Reuse existing code.
- Never duplicate logic.
- Never hardcode secrets.
- Validate external input with Zod.
- Never trust frontend authentication or payment state.

## npm

Never manually hardcode package versions.

Use:

npm install <package>

or:

npm install -D <package>

Inspect package.json before installing packages.

## Testing

Every implementation must be tested.

If anything fails:

STOP
→ FIND ROOT CAUSE
→ FIX
→ RUN SAME TEST
→ VERIFY

Never bypass failing tests.

## Git

Before committing:

git status
git diff

Stage only intended files.

Commit and push only after testing succeeds.

## Documentation

Read only documentation relevant to the current task.

Main docs are inside:

docs/
