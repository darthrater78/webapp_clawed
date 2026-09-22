import {
  CheckCircle2,
  CloudCog,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Unplug,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { Clawdmeter } from "@/hooks/useClawdmeter";
import {
  clearPendingClaudeAuth,
  createClaudeAuthRequest,
  loadPendingClaudeAuth,
  normalizeWorkerUrl,
  parseClaudeAuthCode,
  type PendingClaudeAuth,
  savePendingClaudeAuth,
} from "@/lib/clawd/worker";
import { cn } from "@/lib/utils";

export function WorkerSetupButton({ meter, compact }: { meter: Clawdmeter; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Usage Worker setup"
        title="Usage Worker setup"
        className={cn(
          "grid shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-muted-foreground transition-colors hover:bg-accent",
          compact ? "size-6" : "size-8",
        )}
      >
        <Settings2 className={compact ? "size-3" : "size-4"} />
      </button>
      {open ? (
        <div className="absolute inset-0 z-20 flex flex-col gap-2 bg-card/98 p-3 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex w-fit items-center gap-1 self-end rounded-md bg-surface-2 px-2 py-1 text-[0.65rem] font-semibold text-muted-foreground hover:bg-accent"
          >
            <X className="size-3" /> Close
          </button>
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto pr-0.5">
            <WorkerPanel meter={meter} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function AccountLabel({ meter, className }: { meter: Clawdmeter; className?: string }) {
  const { reading, accounts, selectAccount } = meter.worker;
  if (accounts.length > 1 && reading) {
    return (
      <select
        aria-label="Claude account"
        value={reading.accountId}
        onChange={(event) => selectAccount(event.target.value)}
        className={cn(
          "min-w-0 max-w-full truncate rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[0.65rem] font-semibold outline-none focus:border-primary",
          className,
        )}
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <span className={cn("truncate", className)}>
      {reading?.label ?? accounts[0]?.label ?? "Claude usage"}
    </span>
  );
}

export function SourceBadge({ meter, compact }: { meter: Clawdmeter; compact?: boolean }) {
  const { status } = meter.worker;
  const live = status.state === "live";
  const error = status.state === "error";
  const stale = live && status.stale;
  const label =
    status.state === "locked"
      ? "Locked"
      : stale
        ? status.needsReauth
          ? "Re-enrol"
          : "Stale"
        : live
          ? "Live"
          : error
            ? "Error"
            : status.state === "connecting"
              ? "…"
              : status.state === "empty"
                ? "Enrol"
                : "Local";
  return (
    <span
      title={
        status.state === "locked"
          ? "Enter the app key to resume live usage"
          : error
            ? status.message
            : stale
              ? `Showing the last successful Worker reading${status.reason ? ` — ${status.reason}` : ""}`
              : live
                ? "Usage Worker connected"
                : status.state === "empty"
                  ? "Connected — add your Claude account"
                  : "Counting locally"
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-widest",
        compact ? "text-[0.5rem]" : "text-[0.55rem]",
        live && !stale
          ? "bg-ok/15 text-ok"
          : error
            ? "bg-crit/15 text-crit"
            : "bg-surface-2 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          live && !stale ? "bg-ok" : error ? "bg-crit" : "bg-muted-foreground",
        )}
      />
      {label}
    </span>
  );
}

const input =
  "clawd-field w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground caret-primary outline-none placeholder:text-muted-foreground/60 focus:border-primary";
const button =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-accent disabled:opacity-50";

function EnrollForm({ meter, onDone }: { meter: Clawdmeter; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [auth, setAuth] = useState<PendingClaudeAuth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A sign-in started earlier survives closing or reloading this page.
  useEffect(() => {
    const pending = loadPendingClaudeAuth();
    if (!pending) return;
    setAuth(pending);
    if (pending.label) setLabel((current) => current || pending.label);
  }, []);

  const startSignIn = async () => {
    setError(null);
    const request = await createClaudeAuthRequest();
    const pending: PendingClaudeAuth = { ...request, label: label.trim(), at: Date.now() };
    setAuth(pending);
    savePendingClaudeAuth(pending);
    window.open(request.url, "_blank", "noopener,noreferrer");
  };

  const finish = async (result: { ok: true } | { ok: false; message: string }) => {
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setLabel("");
    setCode("");
    setAuth(null);
    clearPendingClaudeAuth();
    onDone();
  };

  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
          Account name
        </span>
        <input
          className={input}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="My Claude Max"
        />
      </label>

      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const parsed = parseClaudeAuthCode(code);
          if (!label.trim()) return setError("Give this account a name.");
          if (!auth) return setError("Open the Claude sign-in link first.");
          if (!parsed) return setError("Paste the code Claude showed you after approving.");
          setBusy(true);
          setError(null);
          await finish(
            await meter.worker.enrollWithCode({
              label: label.trim(),
              code: parsed.code,
              state: parsed.state || auth.state,
              verifier: auth.verifier,
            }),
          );
        }}
      >
        <button
          type="button"
          className={cn(button, "w-full text-primary")}
          onClick={() => void startSignIn()}
        >
          <ExternalLink className="size-3" />{" "}
          {auth ? "Reopen Claude sign-in" : "Open Claude sign-in"}
        </button>
        <label className="block space-y-1">
          <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
            Code from Claude
          </span>
          <input
            className={cn(input, "font-mono text-[0.65rem]")}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            spellCheck={false}
            placeholder="paste the code Claude shows you"
          />
        </label>
        <p className="text-[0.65rem] leading-relaxed text-muted-foreground">
          The link opens Claude&apos;s own approval page. Approve access, copy the code it shows,
          and paste it here. Your Worker swaps it for tokens, keeps them encrypted, and this browser
          never stores them.
        </p>
        {error ? <p className="text-[0.65rem] font-semibold text-crit">{error}</p> : null}
        <button type="submit" className={cn(button, "w-full text-primary")} disabled={busy}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Finish
          adding account
        </button>
      </form>
    </div>
  );
}

/** Shows this app's own web address, which the Worker must allow. */
function AppOriginField() {
  const [copied, setCopied] = useState<"idle" | "done" | "manual">("idle");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  if (!origin) return null;

  const copy = (element: HTMLInputElement | null) => {
    if (!element) return;
    element.focus();
    element.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    if (ok) {
      setCopied("done");
      return;
    }
    navigator.clipboard
      ?.writeText(origin)
      .then(() => setCopied("done"))
      .catch(() => setCopied("manual"));
  };

  let field: HTMLInputElement | null = null;
  return (
    <div className="space-y-1 rounded-lg border border-border bg-surface px-2.5 py-2">
      <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
        This app&apos;s address
      </span>
      <div className="flex gap-1.5">
        <input
          ref={(element) => {
            field = element;
          }}
          className={cn(input, "font-mono text-[0.65rem]")}
          value={origin}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className={cn(button, "shrink-0")} onClick={() => copy(field)}>
          Copy
        </button>
      </div>
      <p className="text-[0.65rem] leading-relaxed text-muted-foreground">
        {copied === "done"
          ? "Copied."
          : copied === "manual"
            ? "Copying was blocked — select the text above and copy it yourself."
            : "Whoever deploys the Worker must set ALLOWED_ORIGIN to exactly this."}
      </p>
    </div>
  );
}

export function WorkerPanel({ meter }: { meter: Clawdmeter }) {
  const {
    config,
    status,
    reading,
    accounts,
    connect,
    unlock,
    disconnect,
    refresh,
    selectAccount,
    remove,
  } = meter.worker;
  const [url, setUrl] = useState(config?.baseUrl ?? "");
  const [appKey, setAppKey] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const connected = config !== null;
  const locked = connected && !config.appKey;
  const showEnroll = adding || accounts.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <CloudCog className="size-3.5 shrink-0" />
          <span className="truncate">Usage Worker</span>
        </h3>
        <SourceBadge meter={meter} />
      </div>

      {locked ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (appKey.trim()) unlock(appKey.trim());
          }}
        >
          <div className="rounded-lg bg-surface px-2.5 py-2 text-xs">
            <div className="truncate font-semibold">{config.baseUrl}</div>
            <div className="mt-1 text-muted-foreground">Locked. Enter the app key to continue.</div>
          </div>
          <label className="block space-y-1">
            <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Shared app key
            </span>
            <input
              className={input}
              value={appKey}
              onChange={(event) => setAppKey(event.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          <button type="submit" className={cn(button, "w-full text-primary")}>
            <CloudCog className="size-3" /> Unlock
          </button>
          <p className="text-[0.65rem] leading-relaxed text-muted-foreground">
            Why again? This browser doesn&apos;t have the app key saved yet (or its encrypted copy
            couldn&apos;t be read back). Unlocking once here saves it, encrypted, so you won&apos;t
            need to re-enter it on this device again. Your enrolled accounts stay on the Worker and
            come back as soon as you unlock.
          </p>
          <button
            type="button"
            className={cn(button, "w-full text-muted-foreground")}
            onClick={() => {
              disconnect();
              setAppKey("");
            }}
          >
            <Unplug className="size-3" /> Forget this Worker
          </button>
        </form>
      ) : connected ? (
        <div className="space-y-2">
          <div className="rounded-lg bg-surface px-2.5 py-2 text-xs">
            <div className="truncate font-semibold">{config.baseUrl}</div>
            <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
              {status.state === "live" ? (
                <>
                  <CheckCircle2 className="size-3 shrink-0 text-ok" />
                  <span className="numerals truncate" title={status.reason}>
                    {status.stale ? "cached" : "updated"} {new Date(status.at).toLocaleTimeString()}
                    {status.stale && status.reason ? ` — ${status.reason}` : ""}
                  </span>
                </>
              ) : status.state === "error" ? (
                <>
                  <XCircle className="size-3 shrink-0 text-crit" />
                  <span className="text-crit">{status.message}</span>
                </>
              ) : status.state === "empty" ? (
                <span>Connected. Add your Claude account below.</span>
              ) : (
                <>
                  <Loader2 className="size-3 shrink-0 animate-spin" />
                  <span>Connecting…</span>
                </>
              )}
            </div>
          </div>

          {accounts.length > 0 ? (
            <div className="space-y-1">
              <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
                Your accounts
              </span>
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs",
                    account.id === (reading?.accountId ?? config.accountId) ? "border-primary" : "",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-semibold"
                    onClick={() => selectAccount(account.id)}
                  >
                    {account.label}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${account.label}`}
                    title="Remove this account from the Worker"
                    className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-crit"
                    onClick={() => void remove(account.id)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {showEnroll ? (
            <EnrollForm meter={meter} onDone={() => setAdding(false)} />
          ) : (
            <button type="button" className={cn(button, "w-full")} onClick={() => setAdding(true)}>
              <Plus className="size-3" /> Add another account
            </button>
          )}

          <div className="flex gap-2">
            <button type="button" className={button} onClick={refresh}>
              <RefreshCw className="size-3" /> Refresh now
            </button>
            <button
              type="button"
              className={cn(button, "text-muted-foreground")}
              onClick={() => {
                disconnect();
                setAppKey("");
              }}
            >
              <Unplug className="size-3" /> Disconnect
            </button>
          </div>
          <p className="text-[0.65rem] leading-relaxed text-muted-foreground">
            Polling every two minutes. Only this browser can see the accounts it enrolled.
          </p>
          <AppOriginField />
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const baseUrl = normalizeWorkerUrl(url);
            if (!baseUrl || !appKey.trim())
              return setUrlError(baseUrl ? null : "Enter the Worker's https:// address.");
            setUrlError(null);
            connect({ baseUrl, appKey: appKey.trim() });
          }}
        >
          <label className="block space-y-1">
            <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Worker address
            </span>
            <input
              className={input}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://clawdmeter.example.workers.dev"
              autoComplete="url"
              spellCheck={false}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Shared app key
            </span>
            <input
              className={input}
              value={appKey}
              onChange={(event) => setAppKey(event.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {urlError ? <p className="text-[0.65rem] font-semibold text-crit">{urlError}</p> : null}
          <button type="submit" className={cn(button, "w-full text-primary")}>
            <CloudCog className="size-3" /> Connect
          </button>
          <p className="text-[0.65rem] leading-relaxed text-muted-foreground">
            Use the app key from whoever deployed the Worker. It is saved encrypted in this browser,
            under a key that never leaves it, so you shouldn&apos;t need to enter it again on this
            device. Next you will add your own Claude account.
          </p>
          <AppOriginField />
        </form>
      )}
    </div>
  );
}
