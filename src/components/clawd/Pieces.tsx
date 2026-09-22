import { AlertTriangle, Minus, Plus, RotateCcw, Sparkles, Undo2 } from "lucide-react";

import type { Snapshot } from "@/lib/clawd/metrics";
import { formatMinutes } from "@/lib/clawd/metrics";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  tone = "default",
  compact,
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn" | "crit";
  compact?: boolean;
}) {
  const toneClass =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "crit" ? "text-crit" : "text-foreground";
  return (
    <div className={cn("min-w-0 rounded-lg bg-surface px-2 py-1.5", compact && "px-1.5 py-1")}>
      <div className="truncate text-[0.55rem] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={cn("numerals truncate font-bold", toneClass, compact ? "text-xs" : "text-sm")}>{value}</div>
    </div>
  );
}

export function HistoryChart({
  snapshot,
  height = 64,
  showLabels = true,
}: {
  snapshot: Snapshot;
  height?: number;
  showLabels?: boolean;
}) {
  const max = Math.max(1, ...snapshot.history.map((d) => d.used));
  const dailyTarget = snapshot.week.limit / 7;

  return (
    <div className="w-full">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {snapshot.history.map((d, i) => {
          const h = (d.used / max) * 100;
          const hot = d.used > dailyTarget;
          return (
            <div key={d.iso} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div
                title={`${d.iso}: ${d.used}`}
                className={cn(
                  "w-full rounded-sm transition-[height] duration-500",
                  hot ? "bg-warn" : "bg-sonnet",
                  i === 6 && "ring-1 ring-primary",
                )}
                style={{ height: `${Math.max(d.used > 0 ? 6 : 2, h)}%` }}
              />
            </div>
          );
        })}
      </div>
      {showLabels ? (
        <div className="mt-1 flex gap-1.5">
          {snapshot.history.map((d) => (
            <span
              key={d.iso}
              className="min-w-0 flex-1 text-center text-[0.55rem] uppercase text-muted-foreground"
            >
              {d.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AlertStrip({ snapshot, compact }: { snapshot: Snapshot; compact?: boolean }) {
  const worst = Math.max(snapshot.session.pct, snapshot.week.pct);
  if (worst < 80 && !snapshot.limitBeforeReset) return null;

  const critical = worst >= 95;
  const which = snapshot.session.pct >= snapshot.week.pct ? "session" : "weekly";
  const message = critical
    ? `${which} limit almost gone — ${Math.round(worst)}%`
    : snapshot.limitBeforeReset
      ? `On pace to hit the limit in ${formatMinutes(snapshot.timeToLimitMin)}`
      : `${which} usage at ${Math.round(worst)}%`;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2 py-1",
        critical ? "bg-crit/15 text-crit" : "bg-warn/15 text-warn",
        compact ? "text-[0.6rem]" : "text-xs",
      )}
      role="status"
    >
      <AlertTriangle className={cn("shrink-0", compact ? "size-3" : "size-3.5")} />
      <span className="truncate font-semibold">{message}</span>
    </div>
  );
}

export function RunwayVerdict({ snapshot, compact, unavailable }: { snapshot: Snapshot; compact?: boolean; unavailable?: boolean }) {
  const safe = !snapshot.limitBeforeReset;
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold",
        safe ? "bg-ok/12 text-ok" : "bg-crit/15 text-crit",
        compact ? "text-[0.6rem]" : "text-xs",
      )}
    >
      <Sparkles className={cn("shrink-0", compact ? "size-3" : "size-3.5")} />
      <span className="truncate">
        {unavailable
          ? "Pace needs browser-observed samples"
          : safe
          ? `Runway clear · pace ${snapshot.paceRatio.toFixed(2)}x`
          : `Limit before reset · pace ${snapshot.paceRatio.toFixed(2)}x`}
      </span>
    </div>
  );
}

export function LogPad({
  onLog,
  onUndo,
  onReset,
  unit,
  compact,
}: {
  onLog: (n: number, model: "sonnet" | "opus") => void;
  onUndo: () => void;
  onReset?: () => void;
  unit: string;
  compact?: boolean;
}) {
  const btn =
    "inline-flex items-center justify-center gap-1 rounded-lg border border-border bg-surface-2 font-semibold transition-colors hover:bg-accent";
  const pad = compact ? "px-2 py-1 text-[0.6rem]" : "px-2.5 py-1.5 text-xs";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={cn(btn, pad, "text-sonnet")} onClick={() => onLog(1, "sonnet")}>
        <Plus className="size-3" /> Sonnet
      </button>
      <button type="button" className={cn(btn, pad, "text-opus")} onClick={() => onLog(1, "opus")}>
        <Plus className="size-3" /> Opus
      </button>
      <button type="button" className={cn(btn, pad, "text-muted-foreground")} onClick={onUndo}>
        <Undo2 className="size-3" /> Undo
      </button>
      {onReset ? (
        <button type="button" className={cn(btn, pad, "text-muted-foreground")} onClick={onReset}>
          <RotateCcw className="size-3" /> Clear
        </button>
      ) : null}
      <span className="numerals text-[0.55rem] uppercase tracking-widest text-muted-foreground">{unit}</span>
    </div>
  );
}

export function QuotaEditor({
  session,
  weekly,
  onChange,
}: {
  session: number;
  weekly: number;
  onChange: (next: { session: number; weekly: number }) => void;
}) {
  const row = (label: string, value: number, key: "session" | "weekly", step: number) => (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
      <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          className="grid size-6 place-items-center rounded-md border border-border bg-surface-2 hover:bg-accent"
          onClick={() =>
            onChange({
              session: key === "session" ? Math.max(1, session - step) : session,
              weekly: key === "weekly" ? Math.max(1, weekly - step) : weekly,
            })
          }
        >
          <Minus className="size-3" />
        </button>
        <span className="numerals w-10 text-center text-sm font-bold">{value}</span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          className="grid size-6 place-items-center rounded-md border border-border bg-surface-2 hover:bg-accent"
          onClick={() =>
            onChange({
              session: key === "session" ? session + step : session,
              weekly: key === "weekly" ? weekly + step : weekly,
            })
          }
        >
          <Plus className="size-3" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {row("5-hour session limit", session, "session", 5)}
      {row("Weekly limit", weekly, "weekly", 20)}
    </div>
  );
}
