import { DEFAULT_QUOTAS, type Quotas, type UsageEvent, WEEK_MS } from "./metrics";

const KEY = "clawdmeter.v1";

export type Store = { events: UsageEvent[]; quotas: Quotas };

const empty = (): Store => ({ events: [], quotas: { ...DEFAULT_QUOTAS } });

function keyFor(userId: string | null) {
  return userId ? `${KEY}.${userId}` : KEY;
}

export function loadStore(userId: string | null): Store {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Store>;
    const cutoff = Date.now() - WEEK_MS * 2;
    return {
      events: (parsed.events ?? []).filter((e) => typeof e?.t === "number" && e.t > cutoff),
      quotas: { ...DEFAULT_QUOTAS, ...(parsed.quotas ?? {}) },
    };
  } catch {
    return empty();
  }
}

export function saveStore(userId: string | null, store: Store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(store));
  } catch {
    /* storage full or blocked — keep running in memory */
  }
}
