import { AccountsCompareToggle, AccountsStrip } from "@/components/clawd/AccountsStrip";
import { Bar, Gauge } from "@/components/clawd/Gauge";
import { Creature } from "@/components/clawd/Creature";
import { AccountLabel, SourceBadge, WorkerSetupButton } from "@/components/clawd/WorkerPanel";
import {
  AlertStrip,
  HistoryChart,
  LogPad,
  QuotaEditor,
  RunwayVerdict,
  Stat,
} from "@/components/clawd/Pieces";
import type { Clawdmeter } from "@/hooks/useClawdmeter";
import { formatClock, formatDuration, formatMinutes } from "@/lib/clawd/metrics";

export function FullPageLayout({ meter }: { meter: Clawdmeter }) {
  const { snapshot, quotas, localQuotas, source, logUsage, undoLast, resetAll, setQuotas } = meter;
  const live = source === "worker";

  return (
    <main className="clawd-bg min-h-full w-full px-4 py-6 sm:px-6 sm:py-10">
      <div className="clawd-bg-glow" aria-hidden />
      <div className="relative mx-auto w-full max-w-6xl">
        <header className="sticky top-0 z-30 -mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur sm:mx-0 sm:flex sm:justify-between sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Creature mood={snapshot.mood} level={snapshot.level} size={48} />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black uppercase tracking-[0.25em] sm:text-2xl">
                Clawdmeter
              </h1>
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                <AccountLabel meter={meter} className="max-w-[14rem]" />
                <span className="hidden truncate sm:inline">
                  · 5-hour &amp; weekly Claude budget
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <SourceBadge meter={meter} />
            <AccountsCompareToggle meter={meter} />
            <WorkerSetupButton meter={meter} />
            {live ? null : (
              <LogPad onLog={logUsage} onUndo={undoLast} onReset={resetAll} unit={quotas.unit} />
            )}
          </div>
        </header>

        <div className="mt-5">
          <AlertStrip snapshot={snapshot} />
        </div>

        {meter.worker.compare ? (
          <div className="mt-4">
            <AccountsStrip meter={meter} gaugeSize={120} minCardWidth={300} />
          </div>
        ) : null}

        <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5">
            <Gauge
              pct={snapshot.session.pct}
              label="5-hour session"
              size={200}
              thickness={14}
              sub={`${snapshot.session.used}/${quotas.session} ${quotas.unit}`}
              resetIn={formatDuration(snapshot.session.resetInMs)}
              resetAt={formatClock(snapshot.session.resetAt)}
            />
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Rolling 5-hour window
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5">
            <Gauge
              pct={snapshot.week.pct}
              label="This week"
              size={200}
              thickness={14}
              sub={`${snapshot.week.used}/${quotas.weekly} ${quotas.unit}`}
              resetIn={formatDuration(snapshot.week.resetInMs)}
              resetAt={formatClock(snapshot.week.resetAt)}
            />
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Weekly window</p>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
            <RunwayVerdict snapshot={snapshot} unavailable={live} />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Burn rate 30m" value={live ? "—" : `${snapshot.burn30.toFixed(1)}%/h`} />
              <Stat label="Burn rate 5m" value={live ? "—" : `${snapshot.burn5.toFixed(1)}%/h`} />
              <Stat
                label="Time to limit"
                value={live ? "—" : formatMinutes(snapshot.timeToLimitMin)}
                tone={snapshot.limitBeforeReset ? "crit" : "ok"}
              />
              <Stat
                label="Projected at reset"
                value={live ? "—" : `${Math.round(snapshot.projectedPct)}%`}
              />
              <Stat label="Pace ratio" value={live ? "—" : `${snapshot.paceRatio.toFixed(2)}x`} />
              <Stat label="Today" value={`${snapshot.totalToday} ${quotas.unit}`} />
            </div>
            <div className="mt-auto space-y-2">
              <Bar
                pct={snapshot.sonnetPct}
                label={live ? "Sonnet weekly" : "Sonnet share"}
                tone="sonnet"
              />
              <Bar pct={snapshot.opusPct} label={live ? "Opus weekly" : "Opus share"} tone="opus" />
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {live ? "Observed weekly change" : "Last 7 days"}
            </h2>
            <div className="mt-3">
              <HistoryChart snapshot={snapshot} height={180} />
            </div>
          </div>
          <div className="space-y-4">
            {live ? null : (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Your limits
                </h2>
                <QuotaEditor
                  session={localQuotas.session}
                  weekly={localQuotas.weekly}
                  onChange={(next) => setQuotas({ ...localQuotas, ...next })}
                />
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  The 5-hour meter is a rolling window: it resets five hours after your first logged
                  use. The weekly meter rolls over seven days after the oldest use still counted.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
