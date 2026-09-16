# Feature 12 — Private bilingual listing assistant

An approved provider can generate English and Amharic titles and descriptions
from their own COMPLETE, saved listing. Both language drafts persist separately
from the source property. Generation never changes its title, factual fields,
editing version, location, photos, readiness status, or publication state.

## Setup

Set `GEMINI_API_KEY` in the untracked root `.env`. Optionally set `GEMINI_MODEL`
(default `gemini-3.6-flash`). Neither variable may use a `VITE_` prefix. Restart
the API after changing them. No browser key or additional dependency is needed.

The server adapter calls Google's
[generateContent API](https://ai.google.dev/api/generate-content) with a JSON
schema and validates the response again locally. Model availability varies by
Google project. Live verification found that `gemini-2.5-flash` was listed but
refused new users; Google's response recommended `gemini-3.6-flash`, which worked.

Apply the additive migration using `npm run db:generate` and `npm run db:migrate`.
The `listing_ai_content` table retains one current bilingual draft per listing.
It is private, bounded in size, and deleted with its listing. Existing listings
are preserved and start without generated copy.

## Browser workflow and privacy

1. Sign in as an approved provider, select a listing, complete its required fields,
   and choose **Mark complete privately**.
2. In **AI listing assistant**, review the sharing notice and select the consent
   checkbox. Generation is disabled while property edits remain unsaved.
3. Choose **Generate English and Amharic copy**. The generated copy is saved
   privately and displayed in two language sections. Review both for factual and
   translation accuracy. Nothing is published or substituted into source fields.
4. Refresh and select the listing again to see saved copy. Changing the source
   listing marks earlier copy outdated; save a complete listing and generate again.

Only the saved title, description, rent/sale category, property type, ETB price,
area, room counts, and subcity are sent to Google Gemini. Exact coordinates,
structured address, photos, account identifiers, and credentials are excluded.
Personal information typed into the title or description is still part of those
fields; the disclosure asks the owner to remove it before sharing.

Google processes the submitted text under the project's Gemini service terms.
The application does not log prompts, responses, keys, or raw provider errors.
Private copy is rendered with `textContent`, with `lang="am"` on Amharic content.
Sign-out/session expiry clears the panel and aborts pending browser requests.

## Validation and resilience

- POST requires owner authentication, approved provider status, exact Origin,
  explicit consent, a UUID request ID, and the current complete listing version.
- Facts are validated using the same validator as listing editing, and reconstructed
  from an explicit allowlist before transmission. Embedded instructions are treated
  as untrusted data; the model receives no tools or remote retrieval capability.
- Output must contain exactly English/Amharic sections, each with only a plain-text
  title (1–120 characters) and description (20–2,000). Script, control-character,
  markup/contact-link, and numeric checks reject malformed output. Negative or
  unsupported numeric quantities are rejected. Only a completed, unblocked response
  is accepted. These checks cannot prove semantic truth or translation quality;
  owner review remains necessary. No automated publishing occurs.
- Provider requests have a 45-second timeout, a 64-KiB response cap, and no automatic
  retries. Up to five attempts per account per hour are allowed using a shared
  database counter. Rate-limit responses include `Retry-After`.
- At most two generations run concurrently per API process; each listing permits
  one within that process. This deployment runs one API process. Multi-instance
  deployment requires a distributed generation lock to avoid duplicate billable
  provider calls. Final database writes remain transactional and version-checked.
- Database transactions are short; no provider network call occurs inside them.
  Ownership, approval, completeness, and source version are checked again before
  saving. A concurrent source edit cannot attach generated copy to the new version.
- Retrying the latest saved request ID/version returns saved copy without another
  provider call or quota charge. Only the latest request is remembered; a superseded
  request can generate again. Failed/uncertain requests may have incurred Google
  usage even if no copy was saved. The UI retains a retry ID and offers reload.
- Provider failures, timeouts, unavailable configuration, invalid output, and stale
  versions show actionable messages while preserving existing property/copy data.

## API

- `GET /api/listings/:id/ai-content` returns 200 with
  `{content:null|{en,am,sourceVersion,model,generatedAt},currentVersion,stale}`.
  An owner whose provider approval changed can still read existing private copy.
- `POST /api/listings/:id/ai-content` accepts exactly
  `{version:2,requestId:"UUID",consent:true}` and returns the same shape after saving.
- Errors: 400 input/consent; 401 signed out; 403 Origin/provider approval; 404 other
  owner or missing listing; 409 incomplete/stale source; 429 local/provider quota;
  502 invalid output; 503 unavailable configuration/provider; 504 provider timeout.

## Verification

Verified on 2026-09-16:

- `npm run verify`: typecheck, lint, 41 unit tests, and production build passed.
- `npm run test:listing-ai`: real API/database integration passed, covering ownership,
  Origin, consent, complete-input validation, latest-request retries, source-edit
  races, invalid output, provider failures, quotas, restart persistence and cleanup.
  These deterministic tests inject a fake generator; they do not claim live AI use.
- `npm run test:listing-editing`: source-editing regression passed.
- `npm run db:status`: all eleven migrations applied.
- Public npm registry audit: zero reported vulnerabilities. Browser bundle scan:
  no configured database, Gemini, or Geoapify secrets present.
- Live Gemini adapter and browser generation both succeeded using synthetic Bole
  apartment details (2 bedrooms, 1 bathroom, 90 square metres, 25,000 ETB/month).
  English and Ethiopic-script Amharic copy passed validation and displayed correctly.
  This is a functional check, not certification of native-level translation quality.
- Browser: consent gating, unsaved-edit gating, source-field preservation, saved-copy
  refresh, and outdated-copy notice after changing the fixture price all passed.
- Browser: 390×844 mobile and 1280×900 desktop layouts checked; no horizontal overflow.
  Stopping the API showed retry feedback while preserving displayed copy and disabling
  generation until a successful reload.
- Restart/reload recovered the same saved copy. Disposable account, listing,
  generated copy and quota records were removed after verification. Device-location
  testing remained skipped, as requested.

## Changed files

- API: `gemini.ts`, `listing-ai.ts`, and `auth.ts` under `apps/api/src`.
- UI: `listing-ai.ts`, `listings.ts`, and `style.css` under `apps/web/src`, plus
  `apps/web/index.html`.
- Database: `prisma/schema.prisma` and
  `prisma/migrations/20260916001100_listing_ai_content/migration.sql`.
- Tests: `tests/gemini.test.mjs`, `tests/integration/listing-ai.test.mjs`.
- Setup/docs: `.env.example`, `package.json`, `README.md`, this guide.
