# Changelog

All notable changes to Clawdmeter are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Each release on GitHub carries an
upload zip (what the hosting platform builds) and a static-site zip (the
static output).

## [0.2.0] - 2026-09-22

### Added

- `npm run configure` in a terminal is now a guided setup for the app origin,
  app key and encryption key. For each key you can keep it, generate a new one,
  or enter your own, which is typed hidden and confirmed. It works the same on
  a brand-new Worker, on one with none of these values, and for later changes.
- `--app-key` and `--encryption-key` let scripts supply their own key values
  over a hidden prompt or stdin, never as command-line arguments.
- A generated encryption key is now shown once, so it can be stored and
  re-entered if the Worker is ever rebuilt.
- The Space Grotesk and JetBrains Mono fonts are now bundled with the app
  instead of loaded from Google Fonts, so the page makes no requests to a host
  outside the SDK. Their SIL Open Font License notices are in
  `THIRD_PARTY_NOTICES.md`, included in both release zips.

### Removed

- The unused shadcn template components (`src/components/ui/`) and the 39
  packages only they needed, including recharts, react-day-picker, cmdk, vaul,
  the Radix primitives, zod and react-hook-form. 125 packages leave the install.
- `src/server.ts`, `src/start.ts`, and the Lovable error-reporting hook
  (`src/lib/error-capture.ts`, `src/lib/error-page.ts`,
  `src/lib/lovable-error-reporting.ts`), which read and wrote host globals
  outside the widget SDK. `vite.config.ts` no longer points at a custom
  server entry; the build still prerenders to static HTML at build time and
  ships no server output.

### Changed

- Updated TanStack Router/Start, React 19.3, Vite 8.3, @vitejs/plugin-react 6,
  globals 17, typescript-eslint, prettier, and tailwind-merge. The root error
  component now uses the router's `ErrorComponentProps` type.
- Dependabot groups ESLint packages together and skips `@types/node` majors,
  which follow the Node 22 runtime.
- The release zips are renamed for clarity: `-source.zip` is now
  `-upload.zip`, and `-dist.zip` is now `-static-site.zip`.
- The page body is transparent by default; the full-page and side-panel root
  layouts now paint the background themselves, and the 404/error pages render
  as a single card-safe root (24px radius, clipped overflow), matching the
  widget card rules.

### Known exceptions

- The usage Worker (`worker/`) is a backend the operator controls, which the
  widget's "no backend you control, SDK-only host communication" rule
  otherwise forbids. It is an accepted, deliberate exception: the widget SDK
  has no way to run OAuth, refresh Claude tokens, or fetch usage on its own.
  Documented in the README.

## [0.1.0] - 2026-09-22

First versioned release.

### Fixed

- The usage Worker now sends `client_id` when refreshing Claude tokens. Without it
  Claude rejected every refresh, so once the first access token expired the app
  stayed on "Stale".
- `npm run build` starts from an empty `dist/`, so files from earlier builds can
  no longer ship.
- A browser that had lost its per-browser key now keeps the replacement it
  creates, instead of making a new one on every load.

### Added

- A cron trigger refreshes every enrolled account's tokens every 30 minutes,
  ahead of expiry.
- Stale readings show why they are stale. Accounts whose sign-in Claude has
  revoked are marked **Re-enrol**, and the Worker stops retrying them.
- The Worker is now its own npm package in `worker/` with `deploy`, `configure`,
  and `status` commands. The app origin and keys can be set after deploy, and
  `/api/health` reports which are missing.
- Instructions for updating an existing Worker, including what to expect when
  coming from a Worker older than v0.1.0, and rollback limits.
- MIT license (`LICENSE`), included in both release zips.
- Credits for ha-clawdmeter and lovelace-clawdmeter by Stefan Knaak, which
  Clawdmeter is based on, with their MIT notices in `THIRD_PARTY_NOTICES.md`.
  The file is included in both release zips.
- CI build check, tag-driven release workflow with source and dist zips, workflow
  linting, and Dependabot.

### Changed

- Accounts can only be added with **Sign in with Claude** (OAuth with PKCE).
  Pasting Claude Code credential files is no longer supported.
- The Worker URL must use `https://`.
- The shared app key is kept in memory only and never saved in the browser, so
  a script running on the page later cannot read it. After a reload the app shows
  **Locked** and explains why until the key is entered again. A key saved by an
  earlier version is removed from storage the first time the app loads.
- Stored Claude tokens are now bound to their account's storage key, so a
  record copied under another account cannot be decrypted. Existing records are
  still read and are rewritten in the new format on their next refresh.
- The Worker fixes the OAuth client ID and redirect URI itself instead of
  accepting them from the browser, and only returns CORS headers to allowed
  origins.

### Removed

- The out-of-date `bun.lock`. `package-lock.json` is the only lockfile, matching
  `npm ci`.
- The unused `nitro` server runtime and the app's `wrangler` dependency.
  `npm audit` reports no vulnerabilities for either package.
