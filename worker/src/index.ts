export type Env = {
  USAGE_KV: KVNamespace;
  APP_SHARED_KEY: string;
  ALLOWED_ORIGIN: string;
  TOKEN_ENCRYPTION_KEY: string;
  CLAUDE_TOKEN_URL?: string;
  CLAUDE_CLIENT_ID?: string;
};

type Account = { id: string; label: string };
type AccountIndex = { accounts: Account[] };
type TokenRecord = { accessToken: string; refreshToken: string; expiresAt: number };
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
  fiveHour: { utilization: number; resetsAt: string | null };
  sevenDay: { utilization: number; resetsAt: string | null };
  sevenDaySonnet: { utilization: number; resetsAt: string | null } | null;
  sevenDayOpus: { utilization: number; resetsAt: string | null } | null;
};

const CACHE_SECONDS = 120;
const STALE_SECONDS = 24 * 60 * 60;
const COOLDOWN_SECONDS = 5 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function corsHeaders(env: Env, request: Request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Owner-Key",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(env: Env, request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...corsHeaders(env, request), "Cache-Control": "no-store" } });
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
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** Constant-time gate on the shared app key: it only decides who may enrol at all. */
async function authorized(request: Request, env: Env) {
  if (!env.APP_SHARED_KEY) return false;
  const presented = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!presented) return false;
  const [left, right] = await Promise.all([hmac(presented, env.APP_SHARED_KEY), hmac(env.APP_SHARED_KEY, env.APP_SHARED_KEY)]);
  let difference = 0;
  for (let index = 0; index < right.length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

/**
 * Each browser holds its own random owner key. Only its HMAC is ever stored, so
 * one person's accounts and usage are unreachable without that browser's key.
 */
async function ownerIdFor(request: Request, env: Env) {
  const ownerKey = request.headers.get("X-Owner-Key")?.trim() ?? "";
  if (ownerKey.length < 24 || ownerKey.length > 200) return null;
  return hex(await hmac(`owner:${ownerKey}`, env.TOKEN_ENCRYPTION_KEY)).slice(0, 40);
}

async function encryptionKey(env: Env) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(env.TOKEN_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptTokens(tokens: TokenRecord, env: Env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), encoder.encode(JSON.stringify(tokens)));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptTokens(value: string, env: Env): Promise<TokenRecord> {
  const [ivValue, cipherValue] = value.split(".");
  if (!ivValue || !cipherValue) throw new Error("Invalid encrypted token record");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivValue) }, await encryptionKey(env), base64ToBytes(cipherValue));
  return JSON.parse(decoder.decode(plaintext)) as TokenRecord;
}

async function refreshTokens(tokens: TokenRecord, env: Env): Promise<TokenRecord> {
  if (tokens.expiresAt > Date.now() + 60_000) return tokens;
  const response = await fetch(env.CLAUDE_TOKEN_URL ?? "https://platform.claude.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      ...(env.CLAUDE_CLIENT_ID ? { client_id: env.CLAUDE_CLIENT_ID } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Claude token refresh failed (${response.status})`);
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Claude token refresh returned no access token");
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? tokens.refreshToken, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
}

function normalizedWindow(window: UsageWindow) {
  return { utilization: typeof window?.utilization === "number" ? window.utilization : 0, resetsAt: typeof window?.resets_at === "string" ? window.resets_at : null };
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
  return (await env.USAGE_KV.get<AccountIndex>(`owner:${ownerId}:accounts`, "json"))?.accounts ?? [];
}

async function writeAccounts(env: Env, ownerId: string, accounts: Account[]) {
  await env.USAGE_KV.put(`owner:${ownerId}:accounts`, JSON.stringify({ accounts }));
}

async function fetchUsage(env: Env, ownerId: string, account: Account) {
  const tokenKey = `tokens:${ownerId}:${account.id}`;
  const encrypted = await env.USAGE_KV.get(tokenKey);
  if (!encrypted) throw new Error("This account's Claude credentials are missing. Enrol it again.");
  let tokens = await decryptTokens(encrypted, env);
  const refreshed = await refreshTokens(tokens, env);
  if (refreshed.accessToken !== tokens.accessToken || refreshed.refreshToken !== tokens.refreshToken) {
    tokens = refreshed;
    await env.USAGE_KV.put(tokenKey, await encryptTokens(tokens, env));
  }
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: { Authorization: `Bearer ${tokens.accessToken}`, "anthropic-beta": "oauth-2025-04-20", "anthropic-version": "2023-06-01", "User-Agent": "clawdmeter-worker/1.0", "x-app": "cli" },
  });
  if (!response.ok) throw new Error(`Claude usage request failed (${response.status})`);
  return normalizeUsage(account.id, account.label, (await response.json()) as AnthropicUsage);
}

async function usageFor(env: Env, ownerId: string, account: Account): Promise<CachedUsage> {
  const usageKey = `usage:${ownerId}:${account.id}`;
  const cooldownKey = `cooldown:${ownerId}:${account.id}`;
  const cached = await env.USAGE_KV.get<CachedUsage>(usageKey, "json");
  const cachedAt = cached ? Date.parse(cached.fetchedAt) : 0;
  if (cached && Date.now() - cachedAt < CACHE_SECONDS * 1000) return { ...cached, label: account.label };
  const cooldown = Number(await env.USAGE_KV.get(cooldownKey));
  if (cached && cooldown > Date.now()) return { ...cached, label: account.label, stale: true };
  try {
    const usage = await fetchUsage(env, ownerId, account);
    await env.USAGE_KV.put(usageKey, JSON.stringify(usage), { expirationTtl: STALE_SECONDS });
    await env.USAGE_KV.delete(cooldownKey);
    return usage;
  } catch (error) {
    await env.USAGE_KV.put(cooldownKey, String(Date.now() + COOLDOWN_SECONDS * 1000), { expirationTtl: COOLDOWN_SECONDS });
    if (cached) return { ...cached, label: account.label, stale: true };
    throw error;
  }
}

async function enrol(request: Request, env: Env, ownerId: string) {
  let body: Partial<TokenRecord> & { label?: string };
  try {
    body = (await request.json()) as Partial<TokenRecord> & { label?: string };
  } catch {
    return { error: "Invalid JSON", status: 400 as const };
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
  if (!label) return { error: "A name for this account is required", status: 400 as const };
  if (!body.accessToken || !body.refreshToken || typeof body.accessToken !== "string" || typeof body.refreshToken !== "string") {
    return { error: "Both an access token and a refresh token are required", status: 400 as const };
  }
  const expiresAt = Number.isFinite(body.expiresAt) ? Number(body.expiresAt) : 0;
  const accounts = await readAccounts(env, ownerId);
  if (accounts.length >= 10) return { error: "This browser already has the maximum of 10 enrolled accounts", status: 400 as const };
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  await env.USAGE_KV.put(
    `tokens:${ownerId}:${id}`,
    await encryptTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken, expiresAt }, env),
  );
  await writeAccounts(env, ownerId, [...accounts, { id, label }]);
  return { account: { id, label } };
}

/** Finishes the browser's "Sign in with Claude" flow: code + PKCE verifier in, tokens stored. */
async function enrolWithCode(request: Request, env: Env, ownerId: string) {
  let body: { label?: string; code?: string; state?: string; verifier?: string; redirectUri?: string; clientId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return { error: "Invalid JSON", status: 400 as const };
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
  if (!label) return { error: "A name for this account is required", status: 400 as const };
  if (!body.code || !body.verifier) return { error: "The authorization code is incomplete", status: 400 as const };
  const accounts = await readAccounts(env, ownerId);
  if (accounts.length >= 10) return { error: "This browser already has the maximum of 10 enrolled accounts", status: 400 as const };

  const response = await fetch(env.CLAUDE_TOKEN_URL ?? "https://platform.claude.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: body.code,
      state: body.state ?? "",
      code_verifier: body.verifier,
      redirect_uri: body.redirectUri,
      client_id: env.CLAUDE_CLIENT_ID ?? body.clientId,
    }),
  });
  if (!response.ok) {
    return { error: `Claude rejected that authorization code (${response.status}). Start the sign-in again.`, status: 400 as const };
  }
  const tokens = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tokens.access_token || !tokens.refresh_token) {
    return { error: "Claude did not return usable tokens", status: 502 as const };
  }
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  await env.USAGE_KV.put(
    `tokens:${ownerId}:${id}`,
    await encryptTokens(
      { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 },
      env,
    ),
  );
  await writeAccounts(env, ownerId, [...accounts, { id, label }]);
  return { account: { id, label } };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (!env.ALLOWED_ORIGIN || (origin && origin !== env.ALLOWED_ORIGIN)) {
      return json(env, request, { error: "Origin not allowed" }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    if (!env.TOKEN_ENCRYPTION_KEY) return json(env, request, { error: "Worker secrets are not configured" }, 503);
    if (!(await authorized(request, env))) return json(env, request, { error: "Unauthorized" }, 401);

    const ownerId = await ownerIdFor(request, env);
    if (!ownerId) return json(env, request, { error: "Missing or invalid owner key" }, 400);

    const url = new URL(request.url);

    if (url.pathname === "/api/accounts") {
      if (request.method === "GET") return json(env, request, { accounts: await readAccounts(env, ownerId) });
      if (request.method === "POST") {
        const result = await enrol(request, env, ownerId);
        return "error" in result ? json(env, request, { error: result.error }, result.status) : json(env, request, result, 201);
      }
    }

    if (url.pathname === "/api/accounts/oauth" && request.method === "POST") {
      const result = await enrolWithCode(request, env, ownerId);
      return "error" in result ? json(env, request, { error: result.error }, result.status) : json(env, request, result, 201);
    }

    const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
    if (request.method === "DELETE" && accountMatch?.[1]) {
      const accountId = decodeURIComponent(accountMatch[1]);
      const accounts = await readAccounts(env, ownerId);
      if (!accounts.some((candidate) => candidate.id === accountId)) return json(env, request, { error: "Account not found" }, 404);
      await Promise.all([
        writeAccounts(env, ownerId, accounts.filter((candidate) => candidate.id !== accountId)),
        env.USAGE_KV.delete(`tokens:${ownerId}:${accountId}`),
        env.USAGE_KV.delete(`usage:${ownerId}:${accountId}`),
        env.USAGE_KV.delete(`cooldown:${ownerId}:${accountId}`),
      ]);
      return json(env, request, { ok: true });
    }

    const usageMatch = url.pathname.match(/^\/api\/usage\/([^/]+)$/);
    if (request.method === "GET" && usageMatch?.[1]) {
      const accountId = decodeURIComponent(usageMatch[1]);
      const account = (await readAccounts(env, ownerId)).find((candidate) => candidate.id === accountId);
      if (!account) return json(env, request, { error: "Account not found" }, 404);
      try {
        return json(env, request, await usageFor(env, ownerId, account));
      } catch (error) {
        return json(env, request, { error: error instanceof Error ? error.message : "Usage unavailable" }, 502);
      }
    }

    return json(env, request, { error: "Not found" }, 404);
  },
};
