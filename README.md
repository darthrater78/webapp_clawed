# Clawdmeter

Static Claude five-hour and weekly usage dashboard for full-page, side-panel, and adaptive widget contexts.

## Static app build

```sh
npm ci
npm run build
```

The deployable browser files are written to `dist/`. No app server ships in that output.

## Usage Worker

Claude credentials and usage requests go through a Cloudflare Worker in [`worker/`](worker/README.md), deployed separately from the static app. Each person connects with the Worker URL and shared app key, then adds their own Claude account with **Sign in with Claude** (OAuth). The Worker encrypts the resulting tokens and scopes them to that browser.

## Deploy the usage Worker

The Worker is its own npm package and is **not** in the app's source zip. Get it from a clone of this repo, or from the **Source code (zip)** that GitHub attaches to every release.

### What you need

- Node.js 22 or newer
- A Cloudflare account (the free plan is enough)
- A way for Wrangler to sign in to Cloudflare, either of:
  - **API token** (for servers). Create one under _Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token_, limited to your account, with only these permissions:
    - Account · Workers Scripts · Edit
    - Account · Workers KV Storage · Edit
    - Account · Account Settings · Read
    - User · User Details · Read

    Then export it:

    ```sh
    export CLOUDFLARE_API_TOKEN=…     # keep it out of the repo and shell history
    export CLOUDFLARE_ACCOUNT_ID=…    # optional
    ```

  - **Browser login:** `npx wrangler login`

### 1. Deploy

```sh
cd worker
npm ci
npm run deploy
```

This finds or creates the `USAGE_KV` storage, deploys the Worker with its 30-minute token-refresh schedule, and prints the Worker URL (`https://clawdmeter-usage.<your-subdomain>.workers.dev`) along with any settings still missing. Until those are set, the Worker answers every app request with `503 not configured`.

### 2. Configure (now or later)

Run these from `worker/` whenever the values are known, in any order. There is no need to redeploy.

```sh
npm run configure                                         # creates the app key and encryption key if missing
npm run configure -- --origin https://<your-app-origin>   # the static app's address; comma-separate several
```

- **Save the app key when it is printed.** It is shown only once, and every Clawdmeter user needs it.
- Keys that already exist are never overwritten, so rerunning is safe. See the [Worker README](worker/README.md#configure-any-time-after-deploy) for rotation.

### 3. Check it

```sh
npm run status -- https://clawdmeter-usage.<your-subdomain>.workers.dev
```

It prints `✔ Worker is fully configured`, or lists what is still missing.

### 4. Connect the app

In Clawdmeter, open setup (the sliders icon), enter the Worker URL and app key, press **Connect**, then **Open Claude sign-in** to add your Claude account. The app key is held in memory only, so after a page reload the badge shows **Locked** until you enter it again.

### Updating an existing Worker

From `worker/` in the new version, run `npm ci && npm run deploy`. Storage, keys, enrolled accounts, and an origin set in the Cloudflare dashboard are all kept. Before updating, read [Updating an existing Worker](worker/README.md#updating-an-existing-worker). It covers checking the Worker name, what changes when updating from a Worker older than v0.1.0, and why a rollback is only safe before the first token refresh.

Troubleshooting, the API, and security notes are in the [Worker README](worker/README.md).

## Development checks

```sh
npm run lint        # ESLint + Prettier
npm run typecheck
npm run build
npm run package     # release zips into release/ (commit first; see below)
```

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request, plus `npm audit` and a Worker bundle check.

## Releases

Each version is published as a GitHub release with these assets:

| Asset                              | Contents                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clawdmeter-v<version>-source.zip` | The app source for the hosting platform to upload and build (`npm ci && npm run build`). It excludes `worker/`, `.github/`, and editor state (see `.gitattributes`). |
| `clawdmeter-v<version>-dist.zip`   | The built static files, ready for any static host.                                                                                                                   |
| `SHA256SUMS.txt`                   | Checksums for both zips.                                                                                                                                             |

To release:

1. On a branch, bump `version` in both `package.json` and `worker/package.json`, and add a `## [x.y.z]` section to `CHANGELOG.md`.
2. Open a pull request. CI builds the zips and proves the source zip builds on its own.
3. Merge, then tag the merge commit: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `.github/workflows/release.yml` checks that the tag is on `main`, that CI passed for that commit, and that the tag matches both versions. It then attaches the zips CI built, with release notes taken from `CHANGELOG.md`.

Pre-release tags such as `v0.2.0-rc.1` can be pushed from any branch and publish as GitHub pre-releases.

Release notes for each version: https://github.com/darthrater78/webapp_clawed/releases
