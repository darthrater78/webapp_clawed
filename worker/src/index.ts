export type Env = {
  USAGE_KV: KVNamespace;
  /** Set after deploy (`npm run configure`). Until then the API answers 503. */
  APP_SHARED_KEY?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  /** One origin, or several separated by commas. Set after the static app has an address. */
  ALLOWED_ORIGIN?: string;
  CLAUDE_TOKEN_URL?: string;
  CLAUDE_CLIENT_ID?: string;
};

type Account = { id: string; label: string };
type AccountIndex = { accounts: Account[] };
/** `revoked` is set when Claude rejects the refresh token, so it is never retried. */
type TokenRecord = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  revoked?: boolean;
};
type UsageWindow = { utilization: number; resets_at?: string | null } | null;
type AnthropicUsage = {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_sonnet?: UsageWindow;
  seven_day_opus?: UsageWindow;
};
type CachedUsage = {
  accountId: string;
  label: string;
  fetchedAt: string;
  stale: boolean;
  /** Why the reading is stale, when it is. */
  error?: string;
  /** The stored credentials are dead; only enrolling the account again fixes it. */
  needsReauth?: boolean;
  fiveHour: { utilization: number; resetsAt: string | null };
  sevenDay: { utilization: number; resetsAt: string | null };
  sevenDaySonnet: { utilization: number; resetsAt: string | null } | null;
  sevenDayOpus: { utilization: number; resetsAt: string | null } | null;
};
type Cooldown = { until: number; error: string; needsReauth: boolean };

const CACHE_SECONDS = 120;
const STALE_SECONDS = 24 * 60 * 60;
const COOLDOWN_SECONDS = 5 * 60;
/** The cron refreshes anything expiring within this window, well before a request needs it. */
const PROACTIVE_REFRESH_MS = 2 * 60 * 60 * 1000;
/** Claude Code's public OAuth client. The token endpoint rejects refreshes without it. */
const DEFAULT_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const ACCOUNT_ID = /^[0-9a-f]{16}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class ReauthRequired extends Error {}

function allowedOrigins(env: Env) {
  return (env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Owner-Key",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(env: Env, request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(env, request), "Cache-Control": "no-store" },
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** Constant-time gate on the shared app key: it only decides who may enrol at all. */
async function authorized(request: Request, appKey: string) {
  const presented = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!presented) return false;
  const [left, right] = await Promise.all([hmac(presented, appKey), hmac(appKey, appKey)]);
  let difference = 0;
  for (let index = 0; index < right.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

/**
 * Each browser holds its own random owner key. Only its HMAC is ever stored, so
 * one person's accounts and usage are unreachable without that browser's key.
 */
async function ownerIdFor(request: Request, secret: string) {
  const ownerKey = request.headers.get("X-Owner-Key")?.trim() ?? "";
  if (ownerKey.length < 24 || ownerKey.length > 200) return null;
  return hex(await hmac(`owner:${ownerKey}`, secret)).slice(0, 40);
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Records are `v2.<iv>.<cipher>`, with the KV key as AES-GCM additional data so a
 * record copied under another owner's or account's key fails to decrypt. Legacy
 * two-part records (no additional data) are still read and upgrade on next write.
 */
async function encryptTokens(tokens: TokenRecord, secret: string, tokenKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(tokenKey) },
    await encryptionKey(secret),
    encoder.encode(JSON.stringify(tokens)),
  );
  return `v2.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptTokens(
  value: string,
  secret: string,
  tokenKey: string,
): Promise<TokenRecord> {
  const parts = value.split(".");
  const bound = parts.length === 3 && parts[0] === "v2";
  const [ivValue, cipherValue] = bound ? parts.slice(1) : parts;
  if (!ivValue || !cipherValue || (!bound && parts.length !== 2))
    throw new Error("Invalid encrypted token record");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(ivValue),
      ...(bound ? { additionalData: encoder.encode(tokenKey) } : {}),
    },
    await encryptionKey(secret),
    base64ToBytes(cipherValue),
  );
  return JSON.parse(decoder.decode(plaintext)) as TokenRecord;
}

async function postToken(env: Env, body: Record<string, string>) {
  return fetch(env.CLAUDE_TOKEN_URL || DEFAULT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, client_id: env.CLAUDE_CLIENT_ID || DEFAULT_CLIENT_ID }),
  });
}

/** Exchanges the refresh token. Claude rotates it, so the caller must persist the result. */
async function refreshTokens(tokens: TokenRecord, env: Env): Promise<TokenRecord> {
  const response = await postToken(env, {
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: unknown } | null;
    // invalid_grant: the refresh token was revoked or already used. Retrying cannot help.
    if (response.status === 400 && detail?.error === "invalid_grant") {
      throw new ReauthRequired(
        "Claude no longer accepts this account's saved sign-in. Remove it and enrol it again.",
      );
    }
    throw new Error(`Claude token refresh failed (${response.status})`);
  }
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new Error("Claude token refresh returned no access token");
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

/**
 * Loads, refreshes when due, and persists one account's tokens. A rejected refresh
 * token is recorded so neither requests nor the cron keep hammering the endpoint.
 */
async function currentTokens(
  env: Env,
  secret: string,
  tokenKey: string,
  refreshBefore: number,
): Promise<TokenRecord> {
  const encrypted = await env.USAGE_KV.get(tokenKey);
  if (!encrypted)
    throw new ReauthRequired("This account's Claude credentials are missing. Enrol it again.");
  let tokens: TokenRecord;
  try {
    tokens = await decryptTokens(encrypted, secret, tokenKey);
  } catch {
    // Wrong TOKEN_ENCRYPTION_KEY, or a record that does not belong under this key.
    throw new ReauthRequired(
      "This account's stored sign-in could not be read. Remove it and enrol it again.",
    );
  }
  if (tokens.revoked)
    throw new ReauthRequired(
      "Claude no longer accepts this account's saved sign-in. Remove it and enrol it again.",
    );
  if (tokens.expiresAt > Date.now() + refreshBefore) return tokens;
  try {
    const refreshed = await refreshTokens(tokens, env);
    await env.USAGE_KV.put(tokenKey, await encryptTokens(refreshed, secret, tokenKey));
    return refreshed;
  } catch (error) {
    if (error instanceof ReauthRequired)
      await env.USAGE_KV.put(
        tokenKey,
        await encryptTokens({ ...tokens, revoked: true }, secret, tokenKey),
      );
    throw error;
  }
}

function normalizedWindow(window: UsageWindow) {
  return {
    utilization: typeof window?.utilization === "number" ? window.utilization : 0,
    resetsAt: typeof window?.resets_at === "string" ? window.resets_at : null,
  };
}

function normalizeUsage(accountId: string, label: string, usage: AnthropicUsage): CachedUsage {
  return {
    accountId,
    label,
    fetchedAt: new Date().toISOString(),
    stale: false,
    fiveHour: normalizedWindow(usage.five_hour ?? null),
    sevenDay: normalizedWindow(usage.seven_day ?? null),
    sevenDaySonnet: usage.seven_day_sonnet ? normalizedWindow(usage.seven_day_sonnet) : null,
    sevenDayOpus: usage.seven_day_opus ? normalizedWindow(usage.seven_day_opus) : null,
  };
}

async function readAccounts(env: Env, ownerId: string) {
  return (
    (await env.USAGE_KV.get<AccountIndex>(`owner:${ownerId}:accounts`, "json"))?.accounts ?? []
  );
}

async function writeAccounts(env: Env, ownerId: string, accounts: Account[]) {
  await env.USAGE_KV.put(`owner:${ownerId}:accounts`, JSON.stringify({ accounts }));
}

async function fetchUsage(env: Env, secret: string, ownerId: string, account: Account) {
  // Normally the cron has already refreshed; this only refreshes a token that has actually expired.
  const tokens = await currentTokens(env, secret, `tokens:${ownerId}:${account.id}`, 60_000);
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "anthropic-version": "2023-06-01",
      "User-Agent": "clawdmeter-worker",
      "x-app": "cli",
    },
  });
  if (!response.ok) throw new Error(`Claude usage request failed (${response.status})`);
  return normalizeUsage(account.id, account.label, (await response.json()) as AnthropicUsage);
}

async function usageFor(
  env: Env,
  secret: string,
  ownerId: string,
  account: Account,
): Promise<CachedUsage> {
  const usageKey = `usage:${ownerId}:${account.id}`;
  const cooldownKey = `cooldown:${ownerId}:${account.id}`;
  const cached = await env.USAGE_KV.get<CachedUsage>(usageKey, "json");
  const cachedAt = cached ? Date.parse(cached.fetchedAt) : 0;
  if (cached && Date.now() - cachedAt < CACHE_SECONDS * 1000)
    return { ...cached, label: account.label };
  const cooldown = await env.USAGE_KV.get<Cooldown>(cooldownKey, "json");
  if (cooldown && cooldown.until > Date.now()) {
    if (cached)
      return {
        ...cached,
        label: account.label,
        stale: true,
        error: cooldown.error,
        needsReauth: cooldown.needsReauth,
      };
    throw cooldown.needsReauth ? new ReauthRequired(cooldown.error) : new Error(cooldown.error);
  }
  try {
    const usage = await fetchUsage(env, secret, ownerId, account);
    await env.USAGE_KV.put(usageKey, JSON.stringify(usage), { expirationTtl: STALE_SECONDS });
    if (cooldown) await env.USAGE_KV.delete(cooldownKey);
    return usage;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Usage unavailable";
    const needsReauth = error instanceof ReauthRequired;
    console.warn(`usage ${account.id}: ${message}`);
    const record: Cooldown = {
      until: Date.now() + COOLDOWN_SECONDS * 1000,
      error: message,
      needsReauth,
    };
    await env.USAGE_KV.put(cooldownKey, JSON.stringify(record), {
      expirationTtl: COOLDOWN_SECONDS,
    });
    if (cached)
      return { ...cached, label: account.label, stale: true, error: message, needsReauth };
    throw error;
  }
}

function labelFrom(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 60) : "";
}

async function storeAccount(
  env: Env,
  secret: string,
  ownerId: string,
  accounts: Account[],
  label: string,
  tokens: TokenRecord,
) {
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  const tokenKey = `tokens:${ownerId}:${id}`;
  await env.USAGE_KV.put(tokenKey, await encryptTokens(tokens, secret, tokenKey));
  await writeAccounts(env, ownerId, [...accounts, { id, label }]);
  return { account: { id, label } };
}

/** Finishes the browser's "Sign in with Claude" flow: code + PKCE verifier in, tokens stored. */
async function enrolWithCode(request: Request, env: Env, secret: string, ownerId: string) {
  let body: { label?: string; code?: unknown; state?: unknown; verifier?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return { error: "Invalid JSON", status: 400 as const };
  }
  const label = labelFrom(body.label);
  if (!label) return { error: "A name for this account is required", status: 400 as const };
  if (
    typeof body.code !== "string" ||
    typeof body.verifier !== "string" ||
    !body.code ||
    !body.verifier
  ) {
    return { error: "The authorization code is incomplete", status: 400 as const };
  }
  const accounts = await readAccounts(env, ownerId);
  if (accounts.length >= 10)
    return {
      error: "This browser already has the maximum of 10 enrolled accounts",
      status: 400 as const,
    };

  // The client ID and redirect URI are fixed here, never taken from the request.
  const response = await postToken(env, {
    grant_type: "authorization_code",
    code: body.code,
    state: typeof body.state === "string" ? body.state : "",
    code_verifier: body.verifier,
    redirect_uri: REDIRECT_URI,
  });
  if (!response.ok) {
    return {
      error: `Claude rejected that authorization code (${response.status}). Start the sign-in again.`,
      status: 400 as const,
    };
  }
  const tokens = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    return { error: "Claude did not return usable tokens", status: 502 as const };
  }
  return storeAccount(env, secret, ownerId, accounts, label, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
}

/** What is still missing after deploy; names only, never values. */
function missingSettings(env: Env) {
  return [
    ...(allowedOrigins(env).length ? [] : ["ALLOWED_ORIGIN"]),
    ...(env.APP_SHARED_KEY ? [] : ["APP_SHARED_KEY"]),
    ...(env.TOKEN_ENCRYPTION_KEY ? [] : ["TOKEN_ENCRYPTION_KEY"]),
  ];
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const missing = missingSettings(env);

  // Lets whoever deploys confirm the Worker is up and which settings remain.
  if (url.pathname === "/api/health" && request.method === "GET") {
    return Response.json(
      { ok: missing.length === 0, missing },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const origin = request.headers.get("Origin");
  if (origin && allowedOrigins(env).length && !allowedOrigins(env).includes(origin)) {
    return json(env, request, { error: "Origin not allowed" }, 403);
  }
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(env, request) });
  if (!env.APP_SHARED_KEY || !env.TOKEN_ENCRYPTION_KEY || !allowedOrigins(env).length) {
    return json(
      env,
      request,
      { error: `The usage Worker is not configured yet (missing ${missing.join(", ")}).` },
      503,
    );
  }
  if (!(await authorized(request, env.APP_SHARED_KEY)))
    return json(env, request, { error: "Unauthorized" }, 401);

  const secret = env.TOKEN_ENCRYPTION_KEY;
  const ownerId = await ownerIdFor(request, secret);
  if (!ownerId) return json(env, request, { error: "Missing or invalid owner key" }, 400);

  // Accounts are only ever added through Claude's own OAuth sign-in (below); pasted
  // credential files are not accepted.
  if (url.pathname === "/api/accounts" && request.method === "GET") {
    return json(env, request, { accounts: await readAccounts(env, ownerId) });
  }

  if (url.pathname === "/api/accounts/oauth" && request.method === "POST") {
    const result = await enrolWithCode(request, env, secret, ownerId);
    return "error" in result
      ? json(env, request, { error: result.error }, result.status)
      : json(env, request, result, 201);
  }

  const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (request.method === "DELETE" && accountMatch?.[1]) {
    const accountId = accountMatch[1];
    const accounts = await readAccounts(env, ownerId);
    if (!ACCOUNT_ID.test(accountId) || !accounts.some((candidate) => candidate.id === accountId)) {
      return json(env, request, { error: "Account not found" }, 404);
    }
    await Promise.all([
      writeAccounts(
        env,
        ownerId,
        accounts.filter((candidate) => candidate.id !== accountId),
      ),
      env.USAGE_KV.delete(`tokens:${ownerId}:${accountId}`),
      env.USAGE_KV.delete(`usage:${ownerId}:${accountId}`),
      env.USAGE_KV.delete(`cooldown:${ownerId}:${accountId}`),
    ]);
    return json(env, request, { ok: true });
  }

  const usageMatch = url.pathname.match(/^\/api\/usage\/([^/]+)$/);
  if (request.method === "GET" && usageMatch?.[1]) {
    const accountId = usageMatch[1];
    const account = ACCOUNT_ID.test(accountId)
      ? (await readAccounts(env, ownerId)).find((candidate) => candidate.id === accountId)
      : undefined;
    if (!account) return json(env, request, { error: "Account not found" }, 404);
    try {
      return json(env, request, await usageFor(env, secret, ownerId, account));
    } catch (error) {
      const needsReauth = error instanceof ReauthRequired;
      return json(
        env,
        request,
        { error: error instanceof Error ? error.message : "Usage unavailable", needsReauth },
        502,
      );
    }
  }

  return json(env, request, { error: "Not found" }, 404);
}

/** Keeps every enrolled account's tokens fresh so no request has to refresh one itself. */
async function refreshAll(env: Env) {
  const secret = env.TOKEN_ENCRYPTION_KEY;
  if (!secret) return;
  let cursor: string | undefined;
  let checked = 0;
  let failed = 0;
  do {
    const page = await env.USAGE_KV.list({ prefix: "tokens:", ...(cursor ? { cursor } : {}) });
    for (const { name } of page.keys) {
      checked += 1;
      try {
        await currentTokens(env, secret, name, PROACTIVE_REFRESH_MS);
      } catch (error) {
        failed += 1;
        console.warn(
          `refresh ${name.split(":").pop()}: ${error instanceof Error ? error.message : "failed"}`,
        );
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  console.log(`token refresh: ${checked} accounts checked, ${failed} need attention`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Unhandled error");
      return json(env, request, { error: "The usage Worker hit an unexpected error." }, 500);
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(refreshAll(env));
  },
};
