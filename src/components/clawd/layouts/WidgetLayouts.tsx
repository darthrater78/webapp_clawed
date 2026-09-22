import { useState } from "react";
import { ChevronLeft, Clock, Flame, Maximize2 } from "lucide-react";

import { AccountsCompareToggle, AccountsStrip } from "@/components/clawd/AccountsStrip";
import { Bar, Gauge } from "@/components/clawd/Gauge";
import { Creature } from "@/components/clawd/Creature";
import {
  AccountLabel,
  SourceBadge,
  WorkerPanel,
  WorkerSetupButton,
} from "@/components/clawd/WorkerPanel";
import { AlertStrip, HistoryChart, LogPad, RunwayVerdict, Stat } from "@/components/clawd/Pieces";
import type { Clawdmeter } from "@/hooks/useClawdmeter";
import { expandToTab } from "@/lib/clawd/host";
import { formatClock, formatDuration, formatMinutes } from "@/lib/clawd/metrics";
import { cn } from "@/lib/utils";

/** The widget root IS the card — exactly rounded 24px and clipped, no wrappers. */
const CARD =
  "clawd-bg relative h-full w-full text-card-foreground border border-border flex flex-col";
const ROOT_STYLE = { borderRadius: 24, overflow: "hidden" } as const;

function ExpandButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={expandToTab}
      aria-label="Open full page"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-muted-foreground transition-colors hover:bg-accent",
        className,
      )}
    >
      <Maximize2 className="size-3" />
    </button>
  );
}

/* ------------------------------- 344 x 165 ------------------------------- */

export function WidgetLandscape({ meter }: { meter: Clawdmeter }) {
  const { snapshot, quotas } = meter;
  const live = meter.source === "worker";
  const [tab, setTab] = useState<"now" | "week" | "pace">("now");
  const tabs = [
    { id: "now", label: "5h" },
    { id: "week", label: "Week" },
    { id: "pace", label: "Pace" },
  ] as const;

  return (
    <div data-widget-root style={ROOT_STYLE} className={cn(CARD, "gap-1 px-2.5 py-2")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Creature mood={snapshot.mood} level={snapshot.level} size={22} />
          <span className="truncate text-[0.65rem] font-bold uppercase tracking-widest">
            Clawdmeter
          </span>
          <SourceBadge meter={meter} compact />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[0.6rem] font-semibold transition-colors",
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-muted-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
          <AccountsCompareToggle meter={meter} compact />
          <WorkerSetupButton meter={meter} compact />
        </div>
      </div>

      {meter.worker.compare ? (
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto pr-0.5">
          <AccountsStrip meter={meter} gaugeSize={44} minCardWidth={150} />
        </div>
      ) : null}

      {!meter.worker.compare && tab === "now" ? (
        <div className="flex min-h-0 flex-1 items-center gap-2.5">
          <Gauge pct={snapshot.session.pct} label="5h" size={64} thickness={7} />
          <div className="min-w-0 flex-1 space-y-1">
            <Bar
              pct={snapshot.session.pct}
              label="Session"
              right={`${snapshot.session.used}/${quotas.session}`}
              compact
            />
            <Bar
              pct={snapshot.week.pct}
              label="Week"
              right={`${snapshot.week.used}/${quotas.weekly}`}
              compact
            />
            <div className="numerals flex items-center gap-2 text-[0.6rem] text-muted-foreground">
              <Clock className="size-3 shrink-0" />
              {formatDuration(snapshot.session.resetInMs)}
              <Flame className="size-3 shrink-0" />
              {live ? "—" : `${snapshot.burn30.toFixed(1)}%/h`}
            </div>
          </div>
        </div>
      ) : null}

      {!meter.worker.compare && tab === "week" ? (
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-1">
          <HistoryChart snapshot={snapshot} height={54} />
        </div>
      ) : null}

      {!meter.worker.compare && tab === "pace" ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-1">
          <RunwayVerdict snapshot={snapshot} compact unavailable={live} />
          <div className="grid grid-cols-3 gap-1">
            <Stat label="Burn" value={live ? "—" : `${snapshot.burn30.toFixed(1)}%/h`} compact />
            <Stat
              label="To limit"
              value={live ? "—" : formatMinutes(snapshot.timeToLimitMin)}
              tone={snapshot.limitBeforeReset ? "crit" : "ok"}
              compact
            />
            <Stat
              label="Proj."
              value={live ? "—" : `${Math.round(snapshot.projectedPct)}%`}
              compact
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------- 388 x 510 ------------------------------- */

export function WidgetPortrait({ meter }: { meter: Clawdmeter }) {
  const { snapshot, quotas, logUsage, undoLast } = meter;
  const live = meter.source === "worker";
  const [page, setPage] = useState<"home" | "week" | "pace" | "setup">("home");

  if (page !== "home") {
    return (
      <div data-widget-root style={ROOT_STYLE} className={cn(CARD, "gap-2 p-3")}>
        <button
          type="button"
          onClick={() => setPage("home")}
          className="flex w-fit items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[0.65rem] font-semibold text-muted-foreground hover:bg-accent"
        >
          <ChevronLeft className="size-3" /> Back
        </button>
        {page === "setup" ? (
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
            <WorkerPanel meter={meter} />
          </div>
        ) : page === "week" ? (
          <>
            <h2 className="text-sm font-bold">{live ? "Observed weekly change" : "Last 7 days"}</h2>
            <HistoryChart snapshot={snapshot} height={140} />
            <Bar
              pct={snapshot.week.pct}
              label="Weekly quota"
              right={`${snapshot.week.used}/${quotas.weekly}`}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Today" value={`${snapshot.totalToday}`} />
              <Stat label="Week resets" value={formatDuration(snapshot.week.resetInMs)} />
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-bold">Pace &amp; projection</h2>
            <RunwayVerdict snapshot={snapshot} unavailable={live} />
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Burn 30m" value={live ? "—" : `${snapshot.burn30.toFixed(1)}%/h`} />
              <Stat label="Burn 5m" value={live ? "—" : `${snapshot.burn5.toFixed(1)}%/h`} />
              <Stat
                label="Time to limit"
                value={live ? "—" : formatMinutes(snapshot.timeToLimitMin)}
                tone={snapshot.limitBeforeReset ? "crit" : "ok"}
              />
              <Stat
                label="Projected at reset"
                value={live ? "—" : `${Math.round(snapshot.projectedPct)}%`}
              />
            </div>
            <Bar
              pct={snapshot.sonnetPct}
              label={live ? "Sonnet weekly" : "Sonnet share"}
              tone="sonnet"
            />
            <Bar pct={snapshot.opusPct} label={live ? "Opus weekly" : "Opus share"} tone="opus" />
          </>
        )}
      </div>
    );
  }

  return (
    <div data-widget-root style={ROOT_STYLE} className={cn(CARD, "gap-2 p-3")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Creature mood={snapshot.mood} level={snapshot.level} size={34} />
          <div className="min-w-0">
            <div className="truncate text-xs font-bold uppercase tracking-widest">Clawdmeter</div>
            <div className="flex min-w-0 items-center gap-1.5">
              <AccountLabel meter={meter} className="text-[0.6rem] text-muted-foreground" />
              <SourceBadge meter={meter} compact />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <AccountsCompareToggle meter={meter} compact />
          <WorkerSetupButton meter={meter} compact />
          <ExpandButton />
        </div>
      </div>

      {meter.worker.compare ? (
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto pr-0.5">
          <AccountsStrip meter={meter} gaugeSize={66} minCardWidth={150} />
        </div>
      ) : (
        <>
          <AlertStrip snapshot={snapshot} compact />

          <div className="flex items-start justify-center gap-3 py-1">
            <Gauge
              pct={snapshot.session.pct}
              label="5-hour"
              size={110}
              thickness={9}
              resetIn={formatDuration(snapshot.session.resetInMs)}
              resetAt={formatClock(snapshot.session.resetAt)}
            />
            <Gauge
              pct={snapshot.week.pct}
              label="Week"
              size={110}
              thickness={9}
              resetIn={formatDuration(snapshot.week.resetInMs)}
              resetAt={formatClock(snapshot.week.resetAt)}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="Burn 30m" value={live ? "—" : `${snapshot.burn30.toFixed(1)}%/h`} />
            <Stat
              label="To limit"
              value={live ? "—" : formatMinutes(snapshot.timeToLimitMin)}
              tone={snapshot.limitBeforeReset ? "crit" : "ok"}
            />
          </div>

          <HistoryChart snapshot={snapshot} height={110} />

          <div className="mt-auto space-y-1.5">
            {live ? null : <LogPad onLog={logUsage} onUndo={undoLast} unit={quotas.unit} compact />}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setPage("week")}
                className="flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-[0.65rem] font-semibold hover:bg-accent"
              >
                Weekly detail
              </button>
              <button
                type="button"
                onClick={() => setPage("pace")}
                className="flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-[0.65rem] font-semibold hover:bg-accent"
              >
                Pace detail
              </button>
              <button
                type="button"
                onClick={() => setPage("setup")}
                className="flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-[0.65rem] font-semibold hover:bg-accent"
              >
                Usage Worker
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------- 720 x 510 ------------------------------- */

export function WidgetExpanded({ meter }: { meter: Clawdmeter }) {
  const { snapshot, quotas, logUsage, undoLast, resetAll } = meter;
  const live = meter.source === "worker";

  return (
    <div data-widget-root style={ROOT_STYLE} className={cn(CARD, "flex-row")}>
      <aside className="flex w-[38%] min-w-0 flex-col gap-2 border-r border-border bg-surface p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Creature mood={snapshot.mood} level={snapshot.level} size={40} />
            <div className="min-w-0">
              <div className="truncate text-xs font-bold uppercase tracking-widest">Clawdmeter</div>
              <div className="flex min-w-0 items-center gap-1">
                <AccountLabel meter={meter} className="text-[0.6rem] text-muted-foreground" />
                <SourceBadge meter={meter} compact />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AccountsCompareToggle meter={meter} compact />
            <WorkerSetupButton meter={meter} compact />
          </div>
        </div>
        <div className="flex items-start justify-center gap-3">
          <Gauge
            pct={snapshot.session.pct}
            label="5-hour"
            size={112}
            thickness={9}
            resetIn={formatDuration(snapshot.session.resetInMs)}
            resetAt={formatClock(snapshot.session.resetAt)}
          />
          <Gauge
            pct={snapshot.week.pct}
            label="Week"
            size={112}
            thickness={9}
            resetIn={formatDuration(snapshot.week.resetInMs)}
            resetAt={formatClock(snapshot.week.resetAt)}
          />
        </div>
        <AlertStrip snapshot={snapshot} compact />
        <div className="mt-auto">
          {live ? null : (
            <LogPad
              onLog={logUsage}
              onUndo={undoLast}
              onReset={resetAll}
              unit={quotas.unit}
              compact
            />
          )}
        </div>
      </aside>

      <section className="grid min-w-0 flex-1 grid-rows-[auto_auto_1fr] gap-2 p-3">
        <div className="grid grid-cols-4 gap-1.5">
          <Stat label="Week" value={`${Math.round(snapshot.week.pct)}%`} />
          <Stat label="Burn 30m" value={live ? "—" : `${snapshot.burn30.toFixed(1)}%/h`} />
          <Stat
            label="To limit"
            value={live ? "—" : formatMinutes(snapshot.timeToLimitMin)}
            tone={snapshot.limitBeforeReset ? "crit" : "ok"}
          />
          <Stat label="Projected" value={live ? "—" : `${Math.round(snapshot.projectedPct)}%`} />
        </div>
        <div className="space-y-1.5 rounded-xl bg-surface p-2.5">
          <Bar
            pct={snapshot.week.pct}
            label="Weekly quota"
            right={`${snapshot.week.used}/${quotas.weekly}`}
          />
          <Bar
            pct={snapshot.sonnetPct}
            label={live ? "Sonnet weekly" : "Sonnet share"}
            tone="sonnet"
          />
          <Bar pct={snapshot.opusPct} label={live ? "Opus weekly" : "Opus share"} tone="opus" />
          <RunwayVerdict snapshot={snapshot} compact unavailable={live} />
        </div>
        {meter.worker.compare ? (
          <div className="scroll-slim min-h-0 overflow-y-auto">
            <AccountsStrip meter={meter} gaugeSize={58} minCardWidth={170} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-col rounded-xl bg-surface p-2.5">
            <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
              {live ? "Observed weekly change" : "Last 7 days"}
            </span>
            <div className="mt-1 min-h-0 flex-1">
              <HistoryChart snapshot={snapshot} height={110} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------ 1100 x 510 ------------------------------ */

export function WidgetXL({ meter }: { meter: Clawdmeter }) {
  const { snapshot, quotas, logUsage, undoLast, resetAll, setQuotas } = meter;
  const live = meter.source === "worker";

  return (
    <div data-widget-root style={ROOT_STYLE} className={cn(CARD, "gap-2 p-3")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Creature mood={snapshot.mood} level={snapshot.level} size={34} />
          <span className="truncate text-sm font-bold uppercase tracking-[0.2em]">Clawdmeter</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <AccountLabel
            meter={meter}
            className="max-w-[10rem] text-[0.65rem] text-muted-foreground"
          />
          <SourceBadge meter={meter} compact />
          <AccountsCompareToggle meter={meter} compact />
          <WorkerSetupButton meter={meter} compact />
          {live ? null : (
            <LogPad
              onLog={logUsage}
              onUndo={undoLast}
              onReset={resetAll}
              unit={quotas.unit}
              compact
            />
          )}
          <ExpandButton />
        </div>
      </div>

      {meter.worker.compare ? (
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto pr-0.5">
          <AccountsStrip meter={meter} gaugeSize={104} minCardWidth={240} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-4 gap-2">
          <div className="flex min-w-0 flex-col items-center justify-center gap-2 rounded-xl bg-surface p-3">
            <Gauge
              pct={snapshot.session.pct}
              label="5-hour"
              size={150}
              sub={`${snapshot.session.used}/${quotas.session}`}
              resetIn={formatDuration(snapshot.session.resetInMs)}
              resetAt={formatClock(snapshot.session.resetAt)}
            />
            <AlertStrip snapshot={snapshot} compact />
          </div>
          <div className="flex min-w-0 flex-col items-center justify-center gap-2 rounded-xl bg-surface p-3">
            <Gauge
              pct={snapshot.week.pct}
              label="Week"
              size={150}
              sub={`${snapshot.week.used}/${quotas.weekly}`}
              resetIn={formatDuration(snapshot.week.resetInMs)}
              resetAt={formatClock(snapshot.week.resetAt)}
            />
            <RunwayVerdict snapshot={snapshot} compact unavailable={live} />
          </div>
          <div className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface p-3">
            <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Pace
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Burn 30m" value={live ? "—" : `${snapshot.burn30.toFixed(1)}%/h`} />
              <Stat label="Burn 5m" value={live ? "—" : `${snapshot.burn5.toFixed(1)}%/h`} />
              <Stat
                label="To limit"
                value={live ? "—" : formatMinutes(snapshot.timeToLimitMin)}
                tone={snapshot.limitBeforeReset ? "crit" : "ok"}
              />
              <Stat
                label="Projected"
                value={live ? "—" : `${Math.round(snapshot.projectedPct)}%`}
              />
            </div>
            <Bar
              pct={snapshot.sonnetPct}
              label={live ? "Sonnet weekly" : "Sonnet"}
              tone="sonnet"
              compact
            />
            <Bar pct={snapshot.opusPct} label={live ? "Opus weekly" : "Opus"} tone="opus" compact />
            <div className="mt-auto">
              <Stat label="Pace ratio" value={live ? "—" : `${snapshot.paceRatio.toFixed(2)}x`} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface p-3">
            <span className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
              {live ? "Observed weekly change" : "Last 7 days"}
            </span>
            <HistoryChart snapshot={snapshot} height={120} />
            <div className="mt-auto space-y-1.5">
              <Stat label="Today" value={`${snapshot.totalToday} ${quotas.unit}`} />
              {live ? null : (
                <button
                  type="button"
                  onClick={() =>
                    setQuotas({ ...meter.localQuotas, session: meter.localQuotas.session + 5 })
                  }
                  className="w-full rounded-lg bg-surface-2 px-2 py-1 text-[0.6rem] font-semibold text-muted-foreground hover:bg-accent"
                >
                  Session limit +5
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
