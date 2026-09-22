# Clawdmeter

Static Claude five-hour and weekly usage dashboard for full-page, side-panel, and adaptive widget contexts.

## Static app build

```sh
npm ci
npm run build
```

The deployable browser files are written to `dist/`. No app server ships in that output.

## Usage Worker

Claude credentials and usage requests run through the separately deployed Cloudflare Worker in [`worker/`](worker/README.md). Each person connects with the Worker URL and shared app key, then enrols their own Claude account from inside the app; the Worker encrypts those credentials and scopes them to that browser.

Run `npm run worker:check` to validate the Worker bundle. See its README for deployment, enrolment, caching, and security limitations.
