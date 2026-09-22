# Clawdmeter usage Worker

This folder is its own npm package and deploys separately from the static app. It is not needed in the app's distribution zip. The app stays static; the Worker holds Claude credentials so browsers never store them.

> Claude's subscription usage endpoint is undocumented and can change without notice.

The usage API access and token refresh follow [ha-clawdmeter](https://github.com/corgan2222/ha-clawdmeter) by Stefan Knaak (MIT). See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

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

Three settings, which can be set in any order, whenever they are known. They are stored as Worker secrets and take effect immediately, with no redeploy.

| Setting                | What it is                                                   | Who needs it            |
| ---------------------- | ------------------------------------------------------------ | ----------------------- |
| `ALLOWED_ORIGIN`       | The web address(es) the Clawdmeter app is served from (CORS) | Only the Worker         |
| `APP_SHARED_KEY`       | The shared key people enter in the app to connect            | Everyone using the app  |
| `TOKEN_ENCRYPTION_KEY` | Encrypts the stored Claude sign-ins                          | Nobody: keep it private |

### Guided setup

In a terminal, from `worker/`:

```sh
npm run configure
```

For each setting it shows whether it is already set, then asks what to do:

- **Origin:** type the address(es), comma-separated, or press Enter to leave it as is.
- **Each key:** **keep** it (only offered when set), **generate** a new random one, or **enter your own**. Your own value is typed hidden and asked for twice. It must be at least 32 characters with no spaces.
- **Replacing a key that is already set** needs you to type `yes`. A new app key means everyone has to reconnect. A new encryption key makes every account enrolled under the old one unreadable.

It lists what will change and applies nothing until you confirm. Generated keys are printed **once**, because Cloudflare never shows secrets again:

- Give the **app key** to Clawdmeter users.
- Store the **encryption key** somewhere private, such as a password manager. Re-entering it is the only way to keep enrolled accounts readable if the Worker is ever rebuilt.

Keys you typed yourself are never printed.

### Without prompts (scripts and automation)

Passing any option, or running without a terminal, skips the questions:

```sh
npm run configure -- --origin https://clawdmeter.example.com   # set or change the origin
npm run configure -- --app-key                                 # enter your own app key (hidden prompt, or piped in)
npm run configure -- --encryption-key --yes                    # enter your own encryption key over an existing one
npm run configure -- --rotate-app-key                          # generate a new app key
npm run configure -- --rotate-encryption-key --yes             # generate a new encryption key
```

In this mode, any key that is missing is generated. Existing keys are only replaced when you ask, and replacing the encryption key always needs `--yes`. Values are never taken as command-line arguments: they reach Wrangler over stdin, so they stay out of shell history and process lists. To pipe in a value, use `printf '%s' "$KEY" | npm run configure -- --app-key`.

Check the result with `npm run status -- https://clawdmeter-usage.<your-subdomain>.workers.dev`.

If `ALLOWED_ORIGIN` (or either key) already exists as a **plain variable** set in the Cloudflare dashboard, Cloudflare won't let a secret of the same name be created. Delete the variable under _Worker → Settings → Variables and Secrets_ first. Plain variables are otherwise kept across redeploys (`keep_vars`).

## Updating an existing Worker

Updating replaces only the code. Your KV storage, secrets (`APP_SHARED_KEY`, `TOKEN_ENCRYPTION_KEY`), enrolled accounts, and an `ALLOWED_ORIGIN` set in the Cloudflare dashboard all carry over.

1. **Get the new code.** Run `git pull` in your clone, or download the release's **Source code (zip)** from GitHub and use its `worker/` folder.
2. **Check the Worker name.** `"name"` in `wrangler.jsonc` must match the deployed Worker (`clawdmeter-usage` by default). If it doesn't, deploy creates a second Worker instead of updating yours.
3. **Sign in to Cloudflare** the same way as for the first deploy (`CLOUDFLARE_API_TOKEN`, or `npx wrangler login`).
4. **Deploy:**

   ```sh
   cd worker
   npm ci
   npm run deploy
   ```

   This finds your existing `USAGE_KV` namespace by name. If yours has a different title, first replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.jsonc` with its ID (`npx wrangler kv namespace list` shows it).

5. **Check it:** `npm run status -- https://clawdmeter-usage.<your-subdomain>.workers.dev` should print `✔ Worker is fully configured`. If it lists anything missing, run `npm run configure`. It keeps existing keys unless you choose to replace them. To update the origin or keys at any time, see [Configure](#configure-any-time-after-deploy).
6. **Watch the first refresh:** `npm run tail`. Within 30 minutes the cron logs `token refresh: N accounts checked, 0 need attention`.
7. **Tidy up:** deploy writes your KV namespace ID into `wrangler.jsonc`. It isn't needed in the repo because the next deploy looks it up again, so discard the change with `git restore worker/wrangler.jsonc`.

Also update the static app to the same version. Older app builds can still read usage, but they offer the credential-paste option, which the Worker no longer accepts.

### Updating into a Worker with no settings

If the Worker you are deploying to has none of the three settings (a new or reset Worker), deploy first, then run the guided setup:

```sh
npm run deploy
npm run configure
```

1. **Origin:** enter the app's address.
2. **App key:** **generate** a new one and hand it out, or **enter** the key your users already have so nobody needs a new one.
3. **Encryption key:** if the Worker still uses the same `USAGE_KV` storage as before and you have the **previous encryption key**, choose **enter your own** and type it in, and every enrolled account stays readable. Otherwise choose **generate**. Existing accounts then show **Re-enrol**, and each person removes theirs and signs in again.

### Updating from a Worker older than v0.1.0

- **"Stale" accounts recover on their own** at the next cron run (at most 30 minutes), or straight away with **Refresh now**. Older Workers never managed to refresh, so the saved refresh token is still valid unless something else has used it.
- **An account marked "Re-enrol" needs signing in again:** remove it and add it back with **Open Claude sign-in**. This usually happens to accounts that were added by pasting a credentials file from a machine where Claude Code has since refreshed them.
- **The app asks for the app key again after each reload.** The key is no longer saved in the browser.

### Rolling back

`npx wrangler rollback --config wrangler.jsonc` returns to the previous deployed version without touching secrets or storage. **Only roll back before the first token refresh.** From v0.1.0, refreshed tokens are stored in a format older Workers cannot read, so after a rollback those accounts have to be enrolled again.

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
