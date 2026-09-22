# Clawdmeter usage Worker

This folder is its own npm package and deploys separately from the static app. It is not needed in the app's distribution zip. The app stays static; the Worker holds Claude credentials so browsers never store them.

> Claude's subscription usage endpoint is undocumented and can change without notice.

## How enrolment works

1. An admin deploys this Worker once and hands out the app key.
2. Each person enters the Worker address and app key in Clawdmeter. The app keeps the key in memory only, so it is asked for again after each page reload.
3. Each person adds their Claude account with **Sign in with Claude** (OAuth with PKCE). The Worker swaps the one-time code for tokens, encrypts them, and ties them to a random key that only that browser holds — nobody else can list or read those accounts. Pasted credential files are not accepted.

## Deploy (one command)

You need a Cloudflare account and one of these ways for Wrangler to authenticate:

- **API token (recommended for servers and CI).** In the Cloudflare dashboard go to _My Profile → API Tokens → Create Token → Custom token_, scope it to your one account, and grant only:
  - Account · **Workers Scripts** · Edit (deploy, secrets, cron triggers)
  - Account · **Workers KV Storage** · Edit (find or create `USAGE_KV`)
  - Account · **Account Settings** · Read (lets Wrangler resolve the account)
  - User · **User Details** · Read (lets `wrangler whoami` confirm the token)

  Then export it in the shell that runs the scripts:

  ```sh
  export CLOUDFLARE_API_TOKEN=…        # keep it in a secret store or a chmod 600 env file, never in the repo
  export CLOUDFLARE_ACCOUNT_ID=…       # optional; avoids a prompt when the token can see several accounts
  ```

  Wrangler picks these up automatically and `npx wrangler login` is not needed. Set a token expiry and rotate the token if the machine is shared.

- **Interactive login:** `npx wrangler login` opens a browser once and stores an OAuth session for your user.

```sh
cd worker
npm ci
npm run deploy
```

This reuses an existing `USAGE_KV` namespace (or creates one), writes its ID into `wrangler.jsonc`, deploys, and prints the Worker URL along with which settings are still missing. The Worker is live straight away. Until it is configured it answers `503 not configured` and nothing else.

## Configure (any time after deploy)

The app origin and the two keys usually aren't known on day one, so they are set separately and can be set in any order:

```sh
npm run configure                                     # generates APP_SHARED_KEY + TOKEN_ENCRYPTION_KEY if missing
npm run configure -- --origin https://clawdmeter.example.com   # sets ALLOWED_ORIGIN (comma-separate several)
npm run status -- https://clawdmeter-usage.<you>.workers.dev   # shows what is still missing
```

- Values are stored as Worker secrets and take effect immediately. No redeploy is needed.
- The app key is printed **once** when it is generated. Share it with Clawdmeter users.
- Existing keys are never overwritten. `--rotate-app-key` issues a new app key. `--rotate-encryption-key --yes` issues a new encryption key and **makes every enrolled account unreadable**.
- Secrets reach Wrangler over stdin, so they never appear in shell history or process lists.
- A value set in the Cloudflare dashboard as a plain variable is kept across redeploys (`keep_vars`). To manage it with `npm run configure` instead, delete it from the dashboard first.

## Keeping tokens fresh

A cron trigger runs every 30 minutes and refreshes any account whose Claude access token expires within two hours, so requests never have to refresh tokens themselves. If Claude rejects an account's refresh token, the account is marked **Re-enrol** in the app and no further refreshes are attempted for it. Remove it and enrol it again.

Watch it with `npm run tail`, or in the dashboard under Workers Logs. Each cron run logs `token refresh: N accounts checked, M need attention`.

## Troubleshooting "Stale"

"Stale" means the Worker is showing its last good reading. Hover the badge to see why:

| Reason                                                  | Fix                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Claude token refresh failed (400)`                     | Worker deployed before v0.1.0 refreshed without `client_id`. Redeploy with `npm run deploy`.                   |
| `Claude no longer accepts this account's saved sign-in` | The refresh token was revoked (signed out, or access removed in Claude). Remove the account and sign in again. |
| `Claude usage request failed (429)`                     | Claude is rate-limiting. The Worker backs off for five minutes.                                                |

## API

All requests carry `Authorization: Bearer <APP_SHARED_KEY>` and `X-Owner-Key: <per-browser key>`.

`GET /api/health` needs no key and returns only `{ ok, missing: [setting names] }`.

| Method   | Path                  | Purpose                                                                                              |
| -------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/accounts`       | List this browser's enrolled accounts                                                                |
| `POST`   | `/api/accounts/oauth` | Enrol by exchanging a sign-in code (`label`, `code`, `state`, `verifier`, `redirectUri`, `clientId`) |
| `DELETE` | `/api/accounts/:id`   | Delete an account and its stored credentials                                                         |
| `GET`    | `/api/usage/:id`      | Five-hour and weekly usage for one account                                                           |

## Security limitations

- The app key only gates who may enrol; it does not reveal anyone's usage on its own.
- Losing a browser's stored owner key means losing access to the accounts it enrolled — enrol them again.
- Rotate `APP_SHARED_KEY` if it leaks. Rotating `TOKEN_ENCRYPTION_KEY` invalidates every enrolled account.
- Credentials are only ever entered in the app and stored encrypted in KV. Never place Claude tokens in the repository, Wrangler files, chat, or command history.
