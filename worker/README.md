# Clawdmeter usage Worker

This folder deploys separately from the static app. The app stays static; the Worker holds Claude credentials so browsers never store them.

> Claude's subscription usage endpoint is undocumented and can change without notice.

## How enrolment works

1. An admin deploys this Worker once and hands out the app key.
2. Each person enters the Worker address and app key in Clawdmeter.
3. Each person pastes their own Claude Code credentials in the app. The Worker encrypts them and ties them to a random key that only that browser holds — nobody else can list or read those accounts.

## 1. Create storage

```sh
npx wrangler kv namespace create USAGE_KV
```

Put the returned namespace ID in `wrangler.jsonc`.

## 2. Configure the Worker

Set `ALLOWED_ORIGIN` in `wrangler.jsonc` to the exact deployed app origin. Add these secrets:

```sh
npx wrangler secret put APP_SHARED_KEY --config worker/wrangler.jsonc
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config worker/wrangler.jsonc
```

Use two different strong random values (`openssl rand -hex 32`). Share only `APP_SHARED_KEY` with app users.

If your Claude OAuth client requires its client ID during refresh, also set `CLAUDE_CLIENT_ID`. `CLAUDE_TOKEN_URL` is configurable in `wrangler.jsonc` because this unofficial flow may change.

## 3. Deploy

```sh
npx wrangler deploy --config worker/wrangler.jsonc
```

## 4. Each person connects and enrols

In Clawdmeter, open setup, enter the Worker URL and `APP_SHARED_KEY`, then press Connect. Next, add an account by pasting Claude Code credentials:

- Linux/Windows: contents of `~/.claude/.credentials.json`
- macOS: the “Claude Code” entry in Keychain Access

The app accepts that file as-is, or a plain `{ "accessToken": "…", "refreshToken": "…", "expiresAt": 0 }` object. Usage is cached for two minutes and the last good reading stays visible during temporary failures.

Alternatively pick **Sign in with Claude**: the app opens Claude's own approval page with a PKCE challenge, Claude shows a one-time code, and pasting that code back sends it to the Worker, which exchanges it for tokens and stores them encrypted. This uses Claude Code's unofficial OAuth client, so it can change without notice.

## API

All requests carry `Authorization: Bearer <APP_SHARED_KEY>` and `X-Owner-Key: <per-browser key>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/accounts` | List this browser's enrolled accounts |
| `POST` | `/api/accounts` | Enrol one account (`label`, `accessToken`, `refreshToken`, `expiresAt`) |
| `POST` | `/api/accounts/oauth` | Enrol by exchanging a sign-in code (`label`, `code`, `state`, `verifier`, `redirectUri`, `clientId`) |
| `DELETE` | `/api/accounts/:id` | Delete an account and its stored credentials |
| `GET` | `/api/usage/:id` | Five-hour and weekly usage for one account |

## Security limitations

- The app key only gates who may enrol; it does not reveal anyone's usage on its own.
- Losing a browser's stored owner key means losing access to the accounts it enrolled — enrol them again.
- Rotate `APP_SHARED_KEY` if it leaks. Rotating `TOKEN_ENCRYPTION_KEY` invalidates every enrolled account.
- Credentials are only ever entered in the app and stored encrypted in KV. Never place Claude tokens in the repository, Wrangler files, chat, or command history.
