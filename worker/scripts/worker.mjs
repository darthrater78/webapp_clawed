/**
 * Deploys and configures the usage Worker on Cloudflare. Dev-time only; never shipped.
 *
 *   npm run deploy                              KV namespace + deploy, prints the URL
 *   npm run configure                           in a terminal: guided setup of the origin,
 *                                               app key and encryption key (keep, generate,
 *                                               or enter your own for each)
 *   npm run configure -- --origin https://app   no prompts; also --app-key, --encryption-key
 *                                               (your own value, typed hidden or piped in),
 *                                               --rotate-app-key, --rotate-encryption-key --yes
 *   npm run status -- https://<worker-url>      which settings are still missing
 *
 * Secrets go to Wrangler over stdin, never on a command line. Existing keys are
 * kept unless asked otherwise, because a new TOKEN_ENCRYPTION_KEY makes every
 * enrolled account unreadable.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const config = path.join(import.meta.dirname, "..", "wrangler.jsonc");
const placeholder = "REPLACE_WITH_KV_NAMESPACE_ID";
const wranglerBin = path.join(
  import.meta.dirname,
  "..",
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

function wrangler(args, { input, quiet } = {}) {
  if (!existsSync(wranglerBin))
    fail("Wrangler is not installed. Run `npm ci` in the worker folder first.");
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
  if (!wrangler(["whoami"], { quiet: true }).ok)
    fail(
      "Wrangler can't authenticate. Export CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID), or run `npx wrangler login`.",
    );
}

async function ensureKvNamespace() {
  const text = await readFile(config, "utf8");
  if (!text.includes(placeholder)) return;
  const listed = wrangler(["kv", "namespace", "list"], { quiet: true });
  if (!listed.ok) fail("Could not list KV namespaces.");
  const existing = jsonFrom(listed.out).find((ns) =>
    ["USAGE_KV", "clawdmeter-usage-USAGE_KV"].includes(ns.title),
  );
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
  if (!state)
    return console.log(
      `Could not reach ${url}/api/health yet — try \`npm run status -- ${url}\` in a minute.`,
    );
  if (!Array.isArray(state.missing))
    return console.log(
      "That Worker has no /api/health — it predates this version. Redeploy with `npm run deploy`.",
    );
  if (state.ok) return console.log("✔ Worker is fully configured.");
  console.log(`Still to set: ${state.missing.join(", ")}`);
  console.log("Set them with the guided setup: npm run configure");
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
  return value
    .split(",")
    .map((raw) => {
      const trimmed = raw.trim().replace(/\/+$/, "");
      let parsed;
      try {
        parsed = new URL(trimmed);
      } catch {
        fail(
          `"${trimmed}" is not a URL. Use the app's origin, e.g. https://clawdmeter.example.com`,
        );
      }
      const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !local) fail(`"${trimmed}" must use https.`);
      if (parsed.origin !== trimmed)
        fail(`"${trimmed}" should be just the origin: ${parsed.origin}`);
      return parsed.origin;
    })
    .join(",");
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : (process.argv[index + 1] ?? "");
}

const MIN_KEY_LENGTH = 32;
/** Names of keys generated in this run; only these are ever printed. */
const generated = new Set();
const generateKey = (name) => {
  generated.add(name);
  return randomBytes(32).toString("hex");
};

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Reads a value without echoing it. Piped input is read whole instead. */
async function askHidden(question) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    let piped = "";
    for await (const chunk of stdin) piped += chunk;
    return piped.trim();
  }
  stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0003") {
          stdin.setRawMode(false);
          stdout.write("\n");
          process.exit(130);
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

function checkKey(name, value) {
  if (value.length < MIN_KEY_LENGTH || /\s/.test(value)) {
    fail(`${name} must be at least ${MIN_KEY_LENGTH} characters with no spaces.`);
  }
  return value;
}

async function enterKey(name) {
  const first = await askHidden(`Enter ${name} (hidden): `);
  checkKey(name, first);
  if (process.stdin.isTTY && (await askHidden("Enter it again to confirm: ")) !== first) {
    fail(`The two ${name} entries did not match. Nothing was changed.`);
  }
  return first;
}

function existingSecrets() {
  const listed = wrangler(["secret", "list", "--format", "json"], { quiet: true });
  if (!listed.ok)
    fail("Could not read the Worker's secrets. Deploy it first with `npm run deploy`.");
  return new Set(jsonFrom(listed.out).map((secret) => secret.name));
}

/** Asks keep / generate / enter for one key; returns the new value, or undefined to keep. */
async function chooseKey(name, isSet, { purpose, replaceWarning }) {
  console.log(`\n${name} — ${purpose}`);
  console.log(`  Currently: ${isSet ? "set (value hidden)" : "not set"}`);
  const options = isSet
    ? "[k]eep, [g]enerate new, [e]nter your own"
    : "[g]enerate, [e]nter your own";
  const fallback = isSet ? "k" : "g";
  const answer = ((await ask(`  ${options} (default ${fallback}): `)) || fallback).toLowerCase()[0];
  if (answer === "k" && isSet) return undefined;
  if (isSet) {
    console.log(`  ⚠ ${replaceWarning}`);
    if ((await ask("  Type yes to replace it: ")) !== "yes") return undefined;
  }
  if (answer === "e") return enterKey(name);
  if (answer === "g") return generateKey(name);
  fail(`Unknown choice "${answer}". Nothing was changed.`);
}

async function guidedSecrets(existing) {
  console.log(
    "Guided setup. Values are sent to Cloudflare as Worker secrets; nothing is saved here.",
  );
  const secrets = {};

  console.log("\nALLOWED_ORIGIN — the web address(es) the Clawdmeter app is served from");
  console.log(
    `  Currently: ${existing.has("ALLOWED_ORIGIN") ? "set as a secret (value hidden)" : "not set as a secret (it may be a dashboard variable)"}`,
  );
  const origin = await ask("  New origin(s), comma-separated, or Enter to leave as is: ");
  if (origin) secrets.ALLOWED_ORIGIN = parseOrigins(origin);

  const appKey = await chooseKey("APP_SHARED_KEY", existing.has("APP_SHARED_KEY"), {
    purpose: "the shared key everyone enters in the app to connect",
    replaceWarning: "Everyone using Clawdmeter will need the new key to reconnect.",
  });
  if (appKey) secrets.APP_SHARED_KEY = appKey;

  console.log(
    "\n  To keep accounts enrolled under an earlier Worker readable, enter that Worker's TOKEN_ENCRYPTION_KEY.",
  );
  const encryptionKey = await chooseKey(
    "TOKEN_ENCRYPTION_KEY",
    existing.has("TOKEN_ENCRYPTION_KEY"),
    {
      purpose: "encrypts stored Claude sign-ins; never shared with users",
      replaceWarning:
        "Accounts enrolled under the current key become unreadable and must be enrolled again.",
    },
  );
  if (encryptionKey) secrets.TOKEN_ENCRYPTION_KEY = encryptionKey;

  if (!Object.keys(secrets).length) return secrets;
  console.log(`\nWill set: ${Object.keys(secrets).join(", ")}`);
  if ((await ask("Apply? (y/N): ")).toLowerCase() !== "y") {
    console.log("Nothing was changed.");
    process.exit(0);
  }
  return secrets;
}

async function flagSecrets(existing) {
  const secrets = {};
  const origin = flag("--origin");
  if (origin !== undefined) secrets.ALLOWED_ORIGIN = parseOrigins(origin);

  const typedApp = process.argv.includes("--app-key");
  const typedEncryption = process.argv.includes("--encryption-key");
  if (typedApp && typedEncryption && !process.stdin.isTTY) {
    fail("Pipe in one key at a time: use --app-key and --encryption-key in separate runs.");
  }
  const rotateEncryption = process.argv.includes("--rotate-encryption-key") || typedEncryption;
  if (rotateEncryption && existing.has("TOKEN_ENCRYPTION_KEY") && !process.argv.includes("--yes")) {
    fail(
      "Replacing TOKEN_ENCRYPTION_KEY makes every account enrolled under the current key unreadable. Add --yes if that is intended.",
    );
  }

  if (typedApp) secrets.APP_SHARED_KEY = await enterKey("APP_SHARED_KEY");
  else if (!existing.has("APP_SHARED_KEY") || process.argv.includes("--rotate-app-key"))
    secrets.APP_SHARED_KEY = generateKey("APP_SHARED_KEY");

  if (typedEncryption) secrets.TOKEN_ENCRYPTION_KEY = await enterKey("TOKEN_ENCRYPTION_KEY");
  else if (!existing.has("TOKEN_ENCRYPTION_KEY") || rotateEncryption)
    secrets.TOKEN_ENCRYPTION_KEY = generateKey("TOKEN_ENCRYPTION_KEY");
  return secrets;
}

async function configure() {
  requireLogin();
  const existing = existingSecrets();
  const flagged = process.argv.slice(3).some((arg) => arg.startsWith("--"));
  const guided = !flagged && process.stdin.isTTY && process.stdout.isTTY;
  const secrets = guided ? await guidedSecrets(existing) : await flagSecrets(existing);

  if (!Object.keys(secrets).length) {
    console.log("Nothing to change.");
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
  // Show generated keys once; Cloudflare never reveals secrets again. Keys the user
  // typed in are never echoed.
  if (generated.has("APP_SHARED_KEY")) {
    console.log("\nApp key — give this to people using Clawdmeter. It is shown only now:\n");
    console.log(`  ${secrets.APP_SHARED_KEY}\n`);
  }
  if (generated.has("TOKEN_ENCRYPTION_KEY")) {
    console.log(
      "\nEncryption key — PRIVATE, never share it. Store it in a password manager: re-entering it",
    );
    console.log(
      "is the only way to keep enrolled accounts readable if the Worker is ever rebuilt. Shown only now:\n",
    );
    console.log(`  ${secrets.TOKEN_ENCRYPTION_KEY}\n`);
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
