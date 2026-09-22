import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { emit, loadHostIdentity, type HostIdentity } from "@/lib/clawd/host";
import {
  buildWorkerSnapshot,
  type ClaudeCredentials,
  createOwnerKey,
  type DayPeaks,
  enrollWorkerAccount,
  enrollWorkerAccountWithCode,
  fetchWorkerAccounts,
  fetchWorkerReading,
  removeWorkerAccount,
  type WorkerAccount,
  type WorkerConfig,
  type WorkerReading,
  type WorkerStatus,
  loadWorkerConfig,
  recordWorkerPeak,
  saveWorkerConfig,
} from "@/lib/clawd/worker";
import { buildSnapshot, type Quotas, type UsageEvent } from "@/lib/clawd/metrics";
import { loadStore, saveStore, type Store } from "@/lib/clawd/storage";

const WORKER_POLL_MS = 120_000;

export function useClawdmeter() {
  const [host, setHost] = useState<HostIdentity>({ user: null, branding: null, pageUrl: null });
  const [store, setStore] = useState<Store | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [workerConfig, setWorkerConfig] = useState<WorkerConfig | null>(null);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>({ state: "off" });
  const [workerReading, setWorkerReading] = useState<WorkerReading | null>(null);
  const [workerAccounts, setWorkerAccounts] = useState<WorkerAccount[]>([]);
  const [workerPeaks, setWorkerPeaks] = useState<DayPeaks>({});
  /** every enrolled account's latest reading, for the side-by-side view */
  const [workerReadings, setWorkerReadings] = useState<Record<string, WorkerReading>>({});
  const [compareAccounts, setCompareAccounts] = useState(false);

  // The log is available straight away; host identity arrives when (and if)
  // a host is listening, and then re-keys the log to that user.
  useEffect(() => {
    setStore(loadStore(null));
    setWorkerConfig(loadWorkerConfig(null));
    let alive = true;
    void loadHostIdentity().then((identity) => {
      if (!alive) return;
      setHost(identity);
      if (identity.user?.userId) {
        setStore(loadStore(identity.user.userId));
        setWorkerConfig(loadWorkerConfig(identity.user.userId));
      }
      emit("clawdmeter_opened");
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const userId = host.user?.userId ?? null;

  /* ---------------------------------------------------------- usage Worker */

  const configRef = useRef<WorkerConfig | null>(null);
  configRef.current = workerConfig;

  const applyConfig = useCallback(
    (next: WorkerConfig | null) => {
      configRef.current = next;
      setWorkerConfig(next);
      saveWorkerConfig(userId, next);
    },
    [userId],
  );

  const pollWorker = useCallback(
    async (signal?: AbortSignal) => {
      const config = configRef.current;
      if (!config) return;
      setWorkerStatus((previous) => (previous.state === "live" ? previous : { state: "connecting" }));
      try {
        const accounts = await fetchWorkerAccounts(config, signal);
        if (signal?.aborted) return;
        setWorkerAccounts(accounts);
        const accountId = accounts.some((account) => account.id === config.accountId)
          ? config.accountId
          : accounts[0]?.id;
        if (!accountId) {
          // Connected, but this browser has not enrolled a Claude account yet.
          setWorkerReading(null);
          setWorkerReadings({});
          setWorkerStatus({ state: "empty" });
          return;
        }
        // Read every enrolled account so the side-by-side view is always current.
        const settled = await Promise.all(
          accounts.map(async (account) => {
            try {
              return await fetchWorkerReading(config, account.id, signal);
            } catch {
              return null;
            }
          }),
        );
        if (signal?.aborted) return;
        const readings: Record<string, WorkerReading> = {};
        for (const entry of settled) if (entry) readings[entry.accountId] = entry;
        const reading = readings[accountId];
        if (!reading) throw new Error("The usage Worker could not read that account.");
        const at = Date.now();
        setWorkerReadings(readings);
        setWorkerReading(reading);
        for (const entry of Object.values(readings)) {
          const peaks = recordWorkerPeak(userId, entry.accountId, entry.sevenDay.utilization, at);
          if (entry.accountId === reading.accountId) setWorkerPeaks(peaks);
        }
        setWorkerStatus({ state: "live", at, stale: reading.stale });
        if (accountId !== config.accountId) applyConfig({ ...config, accountId });
      } catch (err) {
        if (signal?.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error talking to the usage Worker.";
        setWorkerReading(null);
        setWorkerStatus({ state: "error", message, at: Date.now() });
      }
    },
    [userId, applyConfig],
  );

  useEffect(() => {
    if (!workerConfig) {
      setWorkerStatus({ state: "off" });
      setWorkerReading(null);
      setWorkerReadings({});
      setWorkerAccounts([]);
      return;
    }
    const controller = new AbortController();
    void pollWorker(controller.signal);
    const id = window.setInterval(() => void pollWorker(controller.signal), WORKER_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [workerConfig, pollWorker]);

  const connectWorker = useCallback(
    (config: { baseUrl: string; appKey: string }) => {
      applyConfig({ ...config, ownerKey: createOwnerKey() });
      emit("worker_connected");
    },
    [applyConfig],
  );

  const disconnectWorker = useCallback(() => {
    applyConfig(null);
    emit("worker_disconnected");
  }, [applyConfig]);

  const refreshWorker = useCallback(() => void pollWorker(), [pollWorker]);

  /** Send one Claude account's credentials to the Worker for this browser only. */
  const enrollWorker = useCallback(
    async (account: { label: string } & ClaudeCredentials) => {
      const config = configRef.current;
      if (!config) return { ok: false as const, message: "Connect to the Worker first." };
      try {
        const created = await enrollWorkerAccount(config, account);
        applyConfig({ ...config, accountId: created.id });
        emit("worker_account_enrolled");
        await pollWorker();
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, message: err instanceof Error ? err.message : "The Worker rejected that account." };
      }
    },
    [applyConfig, pollWorker],
  );

  /** Finish "Sign in with Claude": hand the one-time code to the Worker. */
  const enrollWorkerWithCode = useCallback(
    async (account: { label: string; code: string; state: string; verifier: string }) => {
      const config = configRef.current;
      if (!config) return { ok: false as const, message: "Connect to the Worker first." };
      try {
        const created = await enrollWorkerAccountWithCode(config, account);
        applyConfig({ ...config, accountId: created.id });
        emit("worker_account_enrolled");
        await pollWorker();
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, message: err instanceof Error ? err.message : "The Worker rejected that sign-in." };
      }
    },
    [applyConfig, pollWorker],
  );

  /** Forget an account and its stored credentials in the Worker. */
  const removeWorker = useCallback(
    async (accountId: string) => {
      const config = configRef.current;
      if (!config) return;
      try {
        await removeWorkerAccount(config, accountId);
      } catch {
        // The refresh below reflects whatever the Worker still holds.
      }
      if (config.accountId === accountId) {
        const { accountId: _dropped, ...rest } = config;
        applyConfig(rest);
      }
      setWorkerReading(null);
      emit("worker_account_removed");
      await pollWorker();
    },
    [applyConfig, pollWorker],
  );

  /** Switch which Claude account the meters follow. */
  const selectWorkerAccount = useCallback(
    (accountId: string) => {
      const config = configRef.current;
      if (!config) return;
      applyConfig({ ...config, accountId });
      setWorkerReading(null);
      emit("worker_account_switched");
    },
    [applyConfig],
  );

  /* --------------------------------------------------------- local logging */

  const persist = useCallback(
    (next: Store) => {
      setStore(next);
      saveStore(userId, next);
    },
    [userId],
  );

  const logUsage = useCallback(
    (n: number, model: UsageEvent["model"] = "sonnet") => {
      if (!store) return;
      const event: UsageEvent = { t: Date.now(), n, model };
      persist({ ...store, events: [...store.events, event] });
      emit("usage_logged", { amount: n, model });
    },
    [store, persist],
  );

  const undoLast = useCallback(() => {
    if (!store || store.events.length === 0) return;
    persist({ ...store, events: store.events.slice(0, -1) });
    emit("usage_undone");
  }, [store, persist]);

  const resetAll = useCallback(() => {
    if (!store) return;
    persist({ ...store, events: [] });
    emit("usage_cleared");
  }, [store, persist]);

  const setQuotas = useCallback(
    (quotas: Quotas) => {
      if (!store) return;
      persist({ ...store, quotas });
      emit("quotas_changed", { session: quotas.session, weekly: quotas.weekly });
    },
    [store, persist],
  );

  /* -------------------------------------------------------------- snapshot */

  const live = workerReading !== null && workerStatus.state !== "off";

  const snapshot = useMemo(() => {
    if (live && workerReading) return buildWorkerSnapshot(workerReading, workerPeaks, now);
    return store
      ? buildSnapshot(store.events, store.quotas, now)
      : buildSnapshot([], { session: 45, weekly: 480, unit: "prompts" }, now);
  }, [live, workerReading, workerPeaks, store, now]);

  const localQuotas = store?.quotas ?? { session: 45, weekly: 480, unit: "prompts" };

  return {
    ready: store !== null,
    host,
    /** where the numbers come from */
    source: live ? ("worker" as const) : ("local" as const),
    quotas: live ? { session: 100, weekly: 100, unit: "%" } : localQuotas,
    localQuotas,
    snapshot,
    logUsage,
    undoLast,
    resetAll,
    setQuotas,
    worker: {
      config: workerConfig,
      status: workerStatus,
      reading: workerReading,
      readings: workerReadings,
      accounts: workerAccounts,
      compare: compareAccounts,
      setCompare: setCompareAccounts,
      connect: connectWorker,
      disconnect: disconnectWorker,
      refresh: refreshWorker,
      selectAccount: selectWorkerAccount,
      enroll: enrollWorker,
      enrollWithCode: enrollWorkerWithCode,
      remove: removeWorker,
    },
  };
}

export type Clawdmeter = ReturnType<typeof useClawdmeter>;
