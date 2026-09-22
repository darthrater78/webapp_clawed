# Changelog

All notable changes to Clawdmeter are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Each release on GitHub carries a
source zip (what the hosting platform builds) and a dist zip (the static output).

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
