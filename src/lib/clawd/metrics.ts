/**
 * Usage maths for Clawdmeter: a rolling 5-hour session window and a rolling
 * 7-day weekly window, plus burn rate, time-to-limit and runway verdict.
 * Everything is pure so it can run in the browser with no server.
 */

export const SESSION_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type UsageEvent = {
  /** epoch ms */
  t: number;
  /** usage units consumed (prompts, messages, credits — user's own unit) */
  n: number;
  model: "sonnet" | "opus";
};

export type Quotas = {
  session: number;
  weekly: number;
  unit: string;
};

export const DEFAULT_QUOTAS: Quotas = { session: 45, weekly: 480, unit: "prompts" };

export type Meter = {
  used: number;
  limit: number;
  pct: number;
  /** epoch ms when the window rolls over, null when nothing is in the window */
  resetAt: number | null;
  resetInMs: number | null;
};

export type Mood = "idle" | "calm" | "busy" | "heavy";
export type Level = "ok" | "warn" | "critical";

export type Snapshot = {
  now: number;
  session: Meter;
  week: Meter;
  sonnetPct: number;
  opusPct: number;
  /** Live mode only: share of the 7-day window by usage surface (Claude Code, Chat, ...).
   *  The Anthropic usage API has no per-model breakdown, only this. */
  sourceBreakdown?: { key: string; label: string; percent: number }[];
  /** %/h over the last 30 minutes */
  burn30: number;
  /** %/h over the last 5 minutes */
  burn5: number;
  /** minutes until the session meter hits 100% at the current pace, null if never */
  timeToLimitMin: number | null;
  /** projected session % at reset time */
  projectedPct: number;
  /** <1 means the session resets before the limit is reached */
  paceRatio: number;
  limitBeforeReset: boolean;
  mood: Mood;
  level: Level;
  /** last 7 calendar days, oldest first */
  history: { label: string; used: number; iso: string }[];
  totalToday: number;
};

export const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

function meter(events: UsageEvent[], now: number, span: number, limit: number): Meter {
  const inWindow = events.filter((e) => now - e.t < span);
  const used = inWindow.reduce((s, e) => s + e.n, 0);
  const first = inWindow.length ? Math.min(...inWindow.map((e) => e.t)) : null;
  const resetAt = first === null ? null : first + span;
  return {
    used,
    limit,
    pct: limit > 0 ? clamp((used / limit) * 100) : 0,
    resetAt,
    resetInMs: resetAt === null ? null : Math.max(0, resetAt - now),
  };
}

function ratePerHour(events: UsageEvent[], now: number, windowMs: number, limit: number) {
  const used = events.filter((e) => now - e.t < windowMs).reduce((s, e) => s + e.n, 0);
  if (limit <= 0) return 0;
  const pct = (used / limit) * 100;
  return (pct / windowMs) * 3600_000;
}

export function buildSnapshot(events: UsageEvent[], quotas: Quotas, now: number): Snapshot {
  const session = meter(events, now, SESSION_MS, quotas.session);
  const week = meter(events, now, WEEK_MS, quotas.weekly);

  const inSession = events.filter((e) => now - e.t < SESSION_MS);
  const sessionTotal = inSession.reduce((s, e) => s + e.n, 0) || 1;
  const sonnet = inSession.filter((e) => e.model === "sonnet").reduce((s, e) => s + e.n, 0);
  const opus = inSession.filter((e) => e.model === "opus").reduce((s, e) => s + e.n, 0);

  const burn30 = ratePerHour(events, now, 30 * 60_000, quotas.session);
  const burn5 = ratePerHour(events, now, 5 * 60_000, quotas.session);
  const burn = burn30 > 0 ? burn30 : burn5;

  const remainingPct = Math.max(0, 100 - session.pct);
  const timeToLimitMin = burn > 0.01 ? Math.round((remainingPct / burn) * 60) : null;
  const hoursToReset = session.resetInMs !== null ? session.resetInMs / 3600_000 : 5;
  const projectedPct = clamp(session.pct + burn * hoursToReset, 0, 999);
  const needed = remainingPct / Math.max(hoursToReset, 0.01);
  const paceRatio = needed > 0 ? burn / needed : burn > 0 ? 2 : 0;
  const limitBeforeReset = timeToLimitMin !== null && timeToLimitMin < hoursToReset * 60;

  const mood: Mood = burn < 1 ? "idle" : burn < 8 ? "calm" : burn < 20 ? "busy" : "heavy";
  const worst = Math.max(session.pct, week.pct);
  const level: Level = worst >= 95 ? "critical" : worst >= 80 ? "warn" : "ok";

  const day = 24 * 60 * 60 * 1000;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const history = Array.from({ length: 7 }, (_, i) => {
    const start = midnight.getTime() - (6 - i) * day;
    const used = events
      .filter((e) => e.t >= start && e.t < start + day)
      .reduce((s, e) => s + e.n, 0);
    const d = new Date(start);
    return {
      label: d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
      iso: d.toISOString().slice(0, 10),
      used,
    };
  });

  return {
    now,
    session,
    week,
    sonnetPct: clamp((sonnet / sessionTotal) * 100),
    opusPct: clamp((opus / sessionTotal) * 100),
    burn30,
    burn5,
    timeToLimitMin,
    projectedPct,
    paceRatio,
    limitBeforeReset,
    mood,
    level,
    history,
    totalToday: history[6]?.used ?? 0,
  };
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** "today 9:45 PM" / "Wed, Sep 24 at 9:45 PM" — the wall-clock moment a window frees up. */
export function formatClock(at: number | null, now = Date.now()): string {
  if (at === null || Number.isNaN(at)) return "—";
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(new Date(now))) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}

export function formatMinutes(min: number | null): string {
  if (min === null) return "never";
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
