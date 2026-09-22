import { clamp, type Level, type Mood, type Snapshot, SESSION_MS, WEEK_MS } from "./metrics";

export type WorkerConfig = {
  baseUrl: string;
  appKey: string;
  /** Random per-browser key. Only this browser can read the accounts it enrolled. */
  ownerKey: string;
  accountId?: string;
};

export type WorkerAccount = { id: string; label: string };

export type ClaudeCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type UsageWindow = {
  utilization: number;
  resetsAt: string | null;
};

export type WorkerReading = {
  accountId: string;
  label: string;
  fetchedAt: string;
  stale: boolean;
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
  sevenDaySonnet: UsageWindow | null;
  sevenDayOpus: UsageWindow | null;
};

export type WorkerStatus =
  | { state: "off" }
  | { state: "connecting" }
  | { state: "empty" }
  | { state: "live"; at: number; stale: boolean }
  | { state: "error"; message: string; at: number };

export type DayPeaks = Record<string, number>;

const CONFIG_KEY = "clawdmeter.worker.v1";
const HISTORY_KEY = "clawdmeter.worker.history.v1";
const key = (userId: string | null, base: string) => (userId ? `${base}.${userId}` : base);

export function normalizeWorkerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Minted once per browser and never sent anywhere except this Worker. */
export function createOwnerKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function loadWorkerConfig(userId: string | null): WorkerConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(userId, CONFIG_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkerConfig>;
    if (!parsed.baseUrl || !parsed.appKey) return null;
    return {
      baseUrl: parsed.baseUrl,
      appKey: parsed.appKey,
      ownerKey: parsed.ownerKey || createOwnerKey(),
      ...(typeof parsed.accountId === "string" ? { accountId: parsed.accountId } : {}),
    };
  } catch {
    return null;
  }
}

export function saveWorkerConfig(userId: string | null, config: WorkerConfig | null) {
  if (typeof window === "undefined") return;
  try {
    const storageKey = key(userId, CONFIG_KEY);
    if (config) window.localStorage.setItem(storageKey, JSON.stringify(config));
    else window.localStorage.removeItem(storageKey);
  } catch {
    // The live session still works when browser storage is blocked.
  }
}

async function workerJson<T>(
  config: WorkerConfig,
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal | undefined },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${config.appKey}`,
        "X-Owner-Key": config.ownerKey,
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: init?.signal ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Could not reach the usage Worker. Check its address and allowed app origin.");
  }

  if (response.status === 401) throw new Error("The shared app key was rejected.");
  if (response.status === 403) throw new Error("This app origin is not allowed by the Worker.");
  if (!response.ok) {
    let message = "";
    try {
      const body = (await response.json()) as { error?: string };
      message = typeof body.error === "string" ? body.error : "";
    } catch {
      message = "";
    }
    throw new Error(message || `The usage Worker returned ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function fetchWorkerAccounts(config: WorkerConfig, signal?: AbortSignal) {
  const data = await workerJson<{ accounts: WorkerAccount[] }>(config, "/api/accounts", { signal });
  return Array.isArray(data.accounts) ? data.accounts : [];
}

export async function enrollWorkerAccount(
  config: WorkerConfig,
  account: { label: string } & ClaudeCredentials,
) {
  const data = await workerJson<{ account: WorkerAccount }>(config, "/api/accounts", {
    method: "POST",
    body: account,
  });
  return data.account;
}

export async function removeWorkerAccount(config: WorkerConfig, accountId: string) {
  await workerJson<{ ok: boolean }>(config, `/api/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
}

/**
 * Accepts the Claude Code credentials file, its inner object, or a plain
 * {accessToken, refreshToken, expiresAt} shape pasted by hand.
 */
export function parseClaudeCredentials(input: string): ClaudeCredentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.trim());
  } catch {
    return null;
  }
  const candidates: unknown[] = [parsed];
  if (parsed && typeof parsed === "object") {
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (value && typeof value === "object") candidates.push(value);
    }
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    const accessToken = record["accessToken"] ?? record["access_token"];
    const refreshToken = record["refreshToken"] ?? record["refresh_token"];
    const expires = record["expiresAt"] ?? record["expires_at"];
    if (typeof accessToken === "string" && accessToken && typeof refreshToken === "string" && refreshToken) {
      return {
        accessToken,
        refreshToken,
        expiresAt: typeof expires === "number" ? expires : Number(expires) || 0,
      };
    }
  }
  return null;
}

/* ------------------------------------------------- sign in with Claude (PKCE) */

const CLAUDE_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const CLAUDE_SCOPE = "org:create_api_key user:profile user:inference";

export type ClaudeAuthRequest = { url: string; verifier: string; state: string };

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Builds the Claude sign-in link for this browser, with a fresh PKCE pair. */
export async function createClaudeAuthRequest(): Promise<ClaudeAuthRequest> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  const url = new URL(CLAUDE_AUTHORIZE_URL);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLAUDE_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CLAUDE_REDIRECT_URI);
  url.searchParams.set("scope", CLAUDE_SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", verifier);
  return { url: url.toString(), verifier, state: verifier };
}

/** Claude shows `code#state`; accept either part order-safely. */
export function parseClaudeAuthCode(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const [code, state] = trimmed.split("#");
  if (!code) return null;
  return { code, state: state ?? "" };
}

/* The sign-in opens Claude in another tab, so the pending request must outlive
   this page being navigated away from or reloaded. */
const PENDING_KEY = "clawdmeter.claude.pending.v1";

export type PendingClaudeAuth = ClaudeAuthRequest & { label: string; at: number };

export function savePendingClaudeAuth(pending: PendingClaudeAuth) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // The current tab still holds the request in memory.
  }
}

export function loadPendingClaudeAuth(): PendingClaudeAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingClaudeAuth>;
    if (!parsed.verifier || !parsed.state || !parsed.url) return null;
    // Claude codes are short-lived; drop anything older than an hour.
    if (typeof parsed.at === "number" && Date.now() - parsed.at > 3600_000) {
      clearPendingClaudeAuth();
      return null;
    }
    return {
      url: parsed.url,
      verifier: parsed.verifier,
      state: parsed.state,
      label: typeof parsed.label === "string" ? parsed.label : "",
      at: typeof parsed.at === "number" ? parsed.at : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearPendingClaudeAuth() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing else to do.
  }
}

export async function enrollWorkerAccountWithCode(
  config: WorkerConfig,
  account: { label: string; code: string; state: string; verifier: string },
) {
  const data = await workerJson<{ account: WorkerAccount }>(config, "/api/accounts/oauth", {
    method: "POST",
    body: { ...account, redirectUri: CLAUDE_REDIRECT_URI, clientId: CLAUDE_CLIENT_ID },
  });
  return data.account;
}

export async function fetchWorkerReading(
  config: WorkerConfig,
  accountId: string,
  signal?: AbortSignal,
) {
  return workerJson<WorkerReading>(config, `/api/usage/${encodeURIComponent(accountId)}`, { signal });
}

const isoDay = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export function recordWorkerPeak(
  userId: string | null,
  accountId: string,
  weekPct: number,
  now: number,
): DayPeaks {
  if (typeof window === "undefined") return {};
  const storageKey = key(userId, `${HISTORY_KEY}.${accountId}`);
  let peaks: DayPeaks = {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    peaks = raw ? (JSON.parse(raw) as DayPeaks) : {};
  } catch {
    peaks = {};
  }
  const today = isoDay(now);
  peaks[today] = Math.max(peaks[today] ?? 0, weekPct);
  const cutoff = isoDay(now - 14 * 24 * 3600_000);
  for (const day of Object.keys(peaks)) if (day < cutoff) delete peaks[day];
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(peaks));
  } catch {
    // History remains available for this session.
  }
  return peaks;
}

function historyFromPeaks(peaks: DayPeaks, now: number) {
  const day = 24 * 3600_000;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  let previous: number | null = null;
  return Array.from({ length: 7 }, (_, index) => {
    const start = midnight.getTime() - (6 - index) * day;
    const iso = isoDay(start);
    const peak = peaks[iso];
    let used = 0;
    if (peak !== undefined) {
      used = previous === null || peak < previous ? peak : peak - previous;
      previous = peak;
    }
    return {
      label: new Date(start).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
      iso,
      used: Math.round(Math.max(0, used)),
    };
  });
}

export function buildWorkerSnapshot(reading: WorkerReading, peaks: DayPeaks, now: number): Snapshot {
  const sessionPct = clamp(reading.fiveHour.utilization);
  const weekPct = clamp(reading.sevenDay.utilization);
  const sessionResetAt = reading.fiveHour.resetsAt ? Date.parse(reading.fiveHour.resetsAt) : null;
  const weekResetAt = reading.sevenDay.resetsAt ? Date.parse(reading.sevenDay.resetsAt) : null;
  const resetIn = (at: number | null, span: number) =>
    at === null || Number.isNaN(at) ? null : Math.max(0, at - now) || Math.max(0, span - (now % span));
  const history = historyFromPeaks(peaks, now);
  const worst = Math.max(sessionPct, weekPct);
  const level: Level = worst >= 95 ? "critical" : worst >= 80 ? "warn" : "ok";
  const mood: Mood = worst < 5 ? "idle" : worst < 50 ? "calm" : worst < 80 ? "busy" : "heavy";
  const sonnet = reading.sevenDaySonnet?.utilization ?? 0;
  const opus = reading.sevenDayOpus?.utilization ?? 0;
  const modelTotal = sonnet + opus;

  return {
    now,
    session: {
      used: Math.round(sessionPct),
      limit: 100,
      pct: sessionPct,
      resetAt: sessionResetAt,
      resetInMs: resetIn(sessionResetAt, SESSION_MS),
    },
    week: {
      used: Math.round(weekPct),
      limit: 100,
      pct: weekPct,
      resetAt: weekResetAt,
      resetInMs: resetIn(weekResetAt, WEEK_MS),
    },
    sonnetPct: clamp(sonnet),
    opusPct: clamp(opus),
    burn30: 0,
    burn5: 0,
    timeToLimitMin: null,
    projectedPct: sessionPct,
    paceRatio: 0,
    limitBeforeReset: false,
    mood,
    level,
    history,
    totalToday: history[6]?.used ?? 0,
  };
}