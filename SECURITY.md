# Security architecture

How Clawdmeter was built, and later changed, with regard to security. Every
statement below can be checked against the code it names.

To report a vulnerability, use
[GitHub's private reporting](https://github.com/darthrater78/webapp_clawed/security/advisories/new)
rather than a public issue.

## Design

Clawdmeter has two parts that deploy separately:

- **The static app** (`src/`, built to `dist/`): HTML, JS and CSS only. No app
  server ships in the build.
- **The usage Worker** (`worker/`): a Cloudflare Worker with one KV namespace.
  It is the only place Claude credentials exist. Whoever deploys it is its
  operator.

### Input and trust

- The Worker trusts nothing the browser sends. Every request passes, in order
  (`handle` in `worker/src/index.ts`): an origin check, the configuration
  check, the app key, then the owner key.
- A request whose `Origin` is not in `ALLOWED_ORIGIN` gets `403`, and CORS
  headers are only returned to allowed origins. This is a browser control, not
  authentication: a request sent without an `Origin` header skips it and is
  stopped by the keys instead.
- Until all three settings exist the Worker fails closed with `503` for every
  API route.
- Account IDs must match `^[0-9a-f]{16}$` and belong to the caller's own
  account list. Labels are trimmed to 60 characters. A browser can enrol at
  most 10 accounts.
- The OAuth client ID and redirect URI are constants in the Worker, never
  taken from the request.
- Errors return a fixed message. Unexpected failures return a generic `500`,
  and logs carry error messages and account IDs, never tokens or keys.
- The app renders usage data as React text. It has no `dangerouslySetInnerHTML`,
  `innerHTML` or `eval`.
- All host communication goes through `ai-publish-sdk` (`src/lib/clawd/host.ts`).

### Who can do what

| Secret                 | Held by                       | Grants                                                       |
| ---------------------- | ----------------------------- | ------------------------------------------------------------ |
| `APP_SHARED_KEY`       | Everyone the operator invites | Use of the Worker at all. Reveals nobody's accounts or usage |
| Owner key              | One browser                   | That browser's enrolled accounts and their usage             |
| `TOKEN_ENCRYPTION_KEY` | The operator only             | Decrypting every stored Claude token                         |

- The app key is compared in constant time (`authorized`).
- Each browser mints a random 24-byte owner key (`createOwnerKey`). The Worker
  stores only an HMAC-SHA-256 of it, and every KV key is prefixed with that
  value, so one browser cannot list, read or delete another's accounts.
- There is no admin API and no user login. Accounts are added only through
  Claude's own OAuth sign-in with PKCE (S256); the Worker exchanges the code
  and never returns tokens to the browser.
- The sign-in's `state` is its own random value, separate from the PKCE
  verifier. The app rejects a pasted code whose `state` does not match the
  sign-in it started (`createClaudeAuthRequest`, `WorkerPanel.tsx`).
- `GET /api/health` needs no key and returns only which setting names are
  missing.
- The operator can read everything: they hold the encryption key and the
  Cloudflare account. Users are trusting the operator with their Claude
  sign-in.

### What is stored, and how it is protected

**In the Worker's KV namespace**

| Data                               | Protection                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude access and refresh tokens   | AES-256-GCM, key derived from `TOKEN_ENCRYPTION_KEY`, fresh 12-byte IV per write. The record's KV key is bound in as additional data, so a copied record won't decrypt |
| Account list (IDs and labels)      | Not encrypted. Reachable only under the owner's HMAC prefix                                                                                                            |
| Cached usage readings and cooldown | Not encrypted. Expire after 24 hours and 5 minutes                                                                                                                     |

`APP_SHARED_KEY` and `TOKEN_ENCRYPTION_KEY` are Cloudflare Worker secrets.
`npm run configure` passes them to Wrangler over stdin, never as command-line
arguments, and generates them from 32 random bytes.

**In the browser** (`localStorage`, plus one IndexedDB key)

| Data                                 | Protection                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| App key                              | AES-256-GCM under a non-extractable Web Crypto key held in IndexedDB (`src/lib/clawd/secretBox.ts`). Never written in the clear |
| Owner key and Worker URL             | Not encrypted                                                                                                                   |
| Pending sign-in (PKCE verifier)      | Not encrypted. Dropped after an hour or once the sign-in completes                                                              |
| Usage history, manual logs, settings | Not encrypted. No credentials                                                                                                   |

No Claude token is ever stored in, or sent to, the browser.

### Network exposure

- The Worker is public on `workers.dev` over HTTPS. Its only routes are
  `/api/health`, `/api/accounts`, `/api/accounts/oauth`, `/api/accounts/:id`
  and `/api/usage/:id`. Preview URLs are off.
- The Worker calls two hosts: Claude's token endpoint and Claude's usage
  endpoint.
- The app only accepts an `https://` Worker URL, since the app key travels
  with every request (`http://` is allowed for `localhost` only).
- The app makes no request to any other external origin. Fonts are bundled.
  `npm run verify:release` fails the build if one appears.

### Dependencies and releases

- One lockfile per package (`package-lock.json`), installed with `npm ci`.
- CI runs `npm audit --audit-level=high` for the app and the Worker on every
  push and pull request that changes anything other than documentation. A
  docs-only change skips the build jobs, the audit included; Dependabot alerts
  cover the gap.
- Dependabot opens weekly updates for npm (both packages) and GitHub Actions,
  skipping versions less than a day old. Dependabot alerts are enabled on the
  repository.
- Every workflow action is pinned to a commit SHA, with `contents: read` by
  default, no persisted checkout credentials, and job timeouts. Only the
  release job gets `contents: write`, plus the permissions it needs to sign
  an attestation. `lint-workflows.yml` runs actionlint from a
  checksum-verified download.
- A pull request that adds a dependency with a known High or Critical
  advisory fails `dependency-review.yml`. CodeQL (GitHub's default setup)
  scans the code and the workflows on every pull request and on `main`.
- A release publishes only when the tag is on `main`, CI passed for that
  commit, and the tag matches both package versions. The release attaches the
  zips CI built plus `SHA256SUMS.txt`, and from the release after v0.2.2 it
  signs a provenance attestation for each zip.

### Known limits

- A script running in the app's own origin can use the app key and owner key.
  Encrypting the app key protects it from being read off disk, not from that.
- Losing a browser's owner key loses access to the accounts it enrolled.
  There is no recovery path; enrol them again.
- The app key is shared. Revoking one person means rotating it for everyone.
- The Worker does not rate-limit requests.
- The sign-in requests the same scopes as Claude Code's public OAuth client
  (`org:create_api_key user:profile user:inference`), which is more than
  reading usage needs. This is why the tokens stay in the Worker.
- Claude's subscription usage endpoint is undocumented and can change.

## Changes

Newest first. One line per security issue fixed or risk accepted.

- **2026-10-11. Fixed:** the local server inside `npm run verify:release`
  listened on every network interface and would serve a file outside `dist/`
  for a path containing `..`, for as long as the check ran. It now listens on
  loopback only and serves nothing outside `dist/`. Found by CodeQL.
- **2026-10-11. Fixed:** the Worker trimmed trailing slashes from
  `ALLOWED_ORIGIN` with a regular expression that is slow on a long run of
  slashes. The value is operator configuration, never request input; it is
  now trimmed with a loop. Found by CodeQL.
- **2026-10-11. Risk accepted:** CI skips its build jobs, `npm audit` included,
  for a change that only touches documentation. Such a change cannot alter a
  dependency, and Dependabot alerts report new advisories in the meantime.
- **2026-10-11, v0.2.2. Fixed:** the sign-in's `state` value was the PKCE
  verifier, so the verifier appeared in the sign-in URL and in the
  `code#state` string Claude shows. `state` is now an independent random
  value, and a pasted code with a different `state` is rejected.
- **2026-10-11, v0.2.2. Fixed:** build and deploy tooling carried High
  advisories: `source-map-js` 1.2.1 (GHSA-68fv-2mgg-jv7q) in the app, and
  `sharp` (GHSA-wq5f-xc86-pv6w) and `undici` (GHSA-w293-vg96-wgc3 and others)
  under `wrangler` in the Worker package. Updated to `source-map-js` 1.2.2 and
  `wrangler` 4.149.0. None of these ship in the app bundle or the Worker.
- **2026-10-11. Fixed:** Dependabot alerts were disabled on the repository, so
  advisories were only seen when CI ran. They are now enabled.

- **2026-09-22, v0.2.0. Risk accepted:** the app key is saved in the browser
  again, encrypted under a non-extractable per-browser key, instead of being
  held in memory only. A script already running on the page can use it. A
  plaintext key left by an older version is re-saved encrypted on first load.
- **2026-09-22, v0.2.0. Risk accepted:** the usage Worker is a backend the
  operator controls, an exception to the widget's "no backend you control"
  rule, because the SDK cannot run OAuth, refresh tokens or fetch usage.
- **2026-09-22, v0.2.0. Fixed:** the page loaded fonts from Google Fonts and
  carried an error-reporting hook that touched host globals outside the SDK.
  Fonts are now bundled, the hook is removed, and CI fails on any external
  request.
- **2026-09-22, v0.1.0. Fixed:** accounts could be added by pasting a Claude
  Code credentials file. Enrolment is now OAuth with PKCE only.
- **2026-09-22, v0.1.0. Fixed:** the Worker accepted the OAuth client ID and
  redirect URI from the browser, and returned CORS headers to any origin. Both
  are now fixed in the Worker, and CORS headers go to allowed origins only.
- **2026-09-22, v0.1.0. Fixed:** an encrypted token record could be copied
  under another account's key and still decrypt. Records are now bound to
  their own storage key.
- **2026-09-22, v0.1.0. Fixed:** the app key was saved in the browser in the
  clear. It was moved to memory only (superseded in v0.2.0, above).
- **2026-09-22, v0.1.0. Fixed:** the Worker URL could be plain `http://`. It
  must now be `https://`.
- **2026-09-22, v0.1.0. Fixed:** removed the unused `nitro` server runtime and
  the app's `wrangler` dependency; `npm audit` reports no vulnerabilities for
  either package.
