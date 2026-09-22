# Clawdmeter

Static Claude five-hour and weekly usage dashboard for full-page, side-panel, and adaptive widget contexts.

## Static app build

```sh
npm ci
npm run build
```

The deployable browser files are written to `dist/`. No app server ships in that output.

## Usage Worker

Claude credentials and usage requests run through the separately deployed Cloudflare Worker in [`worker/`](worker/README.md). Each person connects with the Worker URL and shared app key, then adds their own Claude account with **Sign in with Claude** (OAuth). The Worker encrypts the resulting tokens and scopes them to that browser.

It is a separate npm package with its own lockfile and is not part of the app's distribution zip. Deploy it from `worker/` with `npm ci && npm run deploy`, then set the app origin and keys whenever they are known with `npm run configure`. See the Worker README for enrolment, token refresh, troubleshooting, and security limitations.

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
