/**
 * Deploys and configures the usage Worker on Cloudflare. Dev-time only; never shipped.
 *
 *   npm run deploy                              KV namespace + deploy, prints the URL
 *   npm run configure -- --origin https://app   origin, app key, encryption key (any subset)
 *   npm run status -- https://<worker-url>      which settings are still missing
 *
 * Secrets go to Wrangler over stdin, never on a command line. Existing keys are
 * kept unless a --rotate flag asks otherwise, because a new TOKEN_ENCRYPTION_KEY
 * makes every enrolled account unreadable.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const config = path.join(import.meta.dirname, "..", "wrangler.jsonc");
const placeholder = "REPLACE_WITH_KV_NAMESPACE_ID";
const wranglerBin = path.join(import.meta.dirname, "..", "node_modules", "wrangler", "bin", "wrangler.js");

function wrangler(args, { input, quiet } = {}) {
  if (!existsSync(wranglerBin)) fail("Wrangler is not installed. Run `npm ci` in the worker folder first.");
  const result = spawnSync(process.execPath, [wranglerBin, ...args, "--config", config], {
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "inherit" : "pipe", "pipe", quiet ? "pipe" : "inherit"],
  });
  return { ok: result.status === 0, out: result.stdout ?? "", err: result.stderr ?? "" };
}

/** Wrangler may print a banner before its JSON. */
function jsonFrom(text) {
  const start = text.search(/[[{]/);
  return JSON.parse(start === -1 ? "null" : text.slice(start));
}

function fail(message) {
  console.error(`\n✘ ${message}`);
  process.exit(1);
}

function requireLogin() {
  if (!wrangler(["whoami"], { quiet: true }).ok) fail("Wrangler can't authenticate. Export CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID), or run `npx wrangler login`.");
}

async function ensureKvNamespace() {
  const text = await readFile(config, "utf8");
  if (!text.includes(placeholder)) return;
  const listed = wrangler(["kv", "namespace", "list"], { quiet: true });
  if (!listed.ok) fail("Could not list KV namespaces.");
  const existing = jsonFrom(listed.out).find((ns) => ["USAGE_KV", "clawdmeter-usage-USAGE_KV"].includes(ns.title));
  let id = existing?.id;
  if (id) {
    console.log(`Reusing KV namespace ${existing.title} (${id}).`);
  } else {
    const created = wrangler(["kv", "namespace", "create", "USAGE_KV"], { quiet: true });
    id = created.out.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/)?.[1];
    if (!created.ok || !id) fail(`Could not create the KV namespace.\n${created.err}`);
    console.log(`Created KV namespace USAGE_KV (${id}).`);
  }
  await writeFile(config, text.replace(placeholder, id));
}

async function health(url) {
  try {
    const response = await fetch(new URL("/api/health", url));
    return await response.json();
  } catch {
    return null;
  }
}

function reportHealth(url, state) {
  if (!state) return console.log(`Could not reach ${url}/api/health yet — try \`npm run status -- ${url}\` in a minute.`);
  if (!Array.isArray(state.missing)) return console.log("That Worker has no /api/health — it predates this version. Redeploy with `npm run deploy`.");
  if (state.ok) return console.log("✔ Worker is fully configured.");
  console.log(`Still to set: ${state.missing.join(", ")}`);
  console.log("When you have them: npm run configure -- --origin https://<your-app-origin>");
}

async function deploy() {
  requireLogin();
  await ensureKvNamespace();
  const result = wrangler(["deploy"]);
  if (!result.ok) fail("Deploy failed (see above).");
  process.stdout.write(result.out);
  const url = result.out.match(/https:\/\/\S+\.workers\.dev/)?.[0];
  if (!url) return;
  console.log(`\nWorker URL: ${url}`);
  reportHealth(url, await health(url));
}

function parseOrigins(value) {
  return value.split(",").map((raw) => {
    const trimmed = raw.trim().replace(/\/+$/, "");
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      fail(`"${trimmed}" is not a URL. Use the app's origin, e.g. https://clawdmeter.example.com`);
    }
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !local) fail(`"${trimmed}" must use https.`);
    if (parsed.origin !== trimmed) fail(`"${trimmed}" should be just the origin: ${parsed.origin}`);
    return parsed.origin;
  }).join(",");
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : (process.argv[index + 1] ?? "");
}

async function configure() {
  requireLogin();
  const listed = wrangler(["secret", "list", "--format", "json"], { quiet: true });
  if (!listed.ok) fail("Could not read the Worker's secrets. Deploy it first with `npm run deploy`.");
  const existing = new Set(jsonFrom(listed.out).map((secret) => secret.name));
  const secrets = {};

  const origin = flag("--origin");
  if (origin !== undefined) secrets.ALLOWED_ORIGIN = parseOrigins(origin);

  const rotateApp = process.argv.includes("--rotate-app-key");
  if (!existing.has("APP_SHARED_KEY") || rotateApp) secrets.APP_SHARED_KEY = randomBytes(32).toString("hex");

  const rotateEncryption = process.argv.includes("--rotate-encryption-key");
  if (rotateEncryption && existing.has("TOKEN_ENCRYPTION_KEY") && !process.argv.includes("--yes")) {
    fail("Rotating TOKEN_ENCRYPTION_KEY makes every enrolled account unreadable. Add --yes if that is intended.");
  }
  if (!existing.has("TOKEN_ENCRYPTION_KEY") || rotateEncryption) secrets.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");

  if (!Object.keys(secrets).length) {
    console.log("Nothing to change: APP_SHARED_KEY and TOKEN_ENCRYPTION_KEY are already set. Pass --origin to set the app origin.");
    return;
  }
  const result = wrangler(["secret", "bulk"], { input: JSON.stringify(secrets), quiet: true });
  if (!result.ok) {
    const conflict = /already in use|binding/i.test(result.err);
    fail(
      conflict
        ? "Cloudflare refused: one of these names already exists as a plain variable (set in the dashboard). Delete that variable under Worker → Settings → Variables, then run this again."
        : `Setting secrets failed.\n${result.err}`,
    );
  }
  console.log(`✔ Set ${Object.keys(secrets).join(", ")}.`);
  if (secrets.APP_SHARED_KEY) {
    console.log("\nApp key — give this to people using Clawdmeter. It is shown only now:\n");
    console.log(`  ${secrets.APP_SHARED_KEY}\n`);
  }
}

async function status() {
  const url = process.argv[3];
  if (!url) fail("Usage: npm run status -- https://<worker-url>");
  reportHealth(url, await health(url));
}

const commands = { deploy, configure, status };
const command = commands[process.argv[2]];
if (!command) fail(`Unknown command. Use one of: ${Object.keys(commands).join(", ")}`);
await command();
