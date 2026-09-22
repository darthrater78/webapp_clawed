# Clawdmeter

Static Claude five-hour and weekly usage dashboard for full-page, side-panel, and adaptive widget contexts.

Based on [ha-clawdmeter](https://github.com/corgan2222/ha-clawdmeter) and [lovelace-clawdmeter](https://github.com/corgan2222/lovelace-clawdmeter) by Stefan Knaak (MIT). See [Credits](#credits).

## Static app build

```sh
npm ci
npm run build
```

The deployable browser files are written to `dist/`. No app server ships in that output.

## Usage Worker

Claude credentials and usage requests go through a Cloudflare Worker in [`worker/`](worker/README.md), deployed separately from the static app. Each person connects with the Worker URL and shared app key, then adds their own Claude account with **Sign in with Claude** (OAuth). The Worker encrypts the resulting tokens and scopes them to that browser.

**Known exception:** this Worker is a backend the operator controls, which the widget's "no backend you control, SDK-only host communication" rule otherwise forbids. It exists because the widget SDK has no way to run OAuth, refresh Claude tokens, or fetch usage on its own (`getToken` doesn't cover any of that). This is an accepted, deliberate exception, not an oversight — everything else in this app follows the static SPA and SDK-only rules.

## Deploy the usage Worker

The Worker is its own npm package and is **not** in the app's upload zip. Get it from a clone of this repo, or from the **Source code (zip)** that GitHub attaches to every release.

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

From `worker/`, whenever the values are known, and with no redeploy needed:

```sh
npm run configure
```

This guided setup covers the app's origin (CORS), the shared **app key**, and the private **encryption key**. For each key you can keep the current one, generate a new one, or enter your own. It's the same command for a brand-new Worker, for one that has none of these values yet, and for changing them later. Generated keys are printed once: hand out the app key, and store the encryption key privately. Options for running it without prompts, and what happens to enrolled accounts when a key changes, are in the [Worker README](worker/README.md#configure-any-time-after-deploy).

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

| Asset                                   | Contents                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clawdmeter-v<version>-upload.zip`      | The app source for the hosting platform to upload and build (`npm ci && npm run build`). It excludes `worker/`, `.github/`, and editor state (see `.gitattributes`). |
| `clawdmeter-v<version>-static-site.zip` | The built static files, ready for any static host.                                                                                                                   |
| `SHA256SUMS.txt`                        | Checksums for both zips.                                                                                                                                             |

To release:

1. On a branch, bump `version` in both `package.json` and `worker/package.json`, and add a `## [x.y.z]` section to `CHANGELOG.md`.
2. Open a pull request. CI builds the zips and proves the upload zip builds on its own.
3. Merge, then tag the merge commit: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `.github/workflows/release.yml` checks that the tag is on `main`, that CI passed for that commit, and that the tag matches both versions. It then attaches the zips CI built, with release notes taken from `CHANGELOG.md`.

Pre-release tags such as `v0.2.0-rc.1` can be pushed from any branch and publish as GitHub pre-releases.

Release notes for each version: https://github.com/darthrater78/webapp_clawed/releases

## Credits

Clawdmeter is based on work by **Stefan Knaak** ([@corgan2222](https://github.com/corgan2222)):

- [ha-clawdmeter](https://github.com/corgan2222/ha-clawdmeter): the Home Assistant integration this app is derived from. It provided the Clawdmeter concept, Claude usage API access, and the burn-rate, time-to-limit and runway metrics.
- [lovelace-clawdmeter](https://github.com/corgan2222/lovelace-clawdmeter): the animated Lovelace card behind the pixel-art Clawdmeter character and the card-style display.

Both are MIT-licensed. Their copyright and license notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which also ships inside every release zip.

## License

[MIT](LICENSE) © 2026 Nathaniel Scriven. Portions are derived from MIT-licensed work by Stefan Knaak; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
