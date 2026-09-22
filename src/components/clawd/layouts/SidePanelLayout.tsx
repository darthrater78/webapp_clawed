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

/** Chrome side panel: 360px wide, tall, vertical scroll only. */
export function SidePanelLayout({ meter }: { meter: Clawdmeter }) {
  const { snapshot, quotas, localQuotas, source, logUsage, undoLast, resetAll, setQuotas } = meter;
  const live = source === "worker";

  return (
    <div className="scroll-slim relative h-full w-full overflow-y-auto bg-background px-3 py-3">
      <header className="sticky top-0 z-30 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border bg-card/95 px-2 py-2 shadow-md backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <Creature mood={snapshot.mood} level={snapshot.level} size={32} />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold uppercase tracking-[0.2em]">Clawdmeter</h1>
            <AccountLabel meter={meter} className="block text-[0.6rem] text-muted-foreground" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SourceBadge meter={meter} compact />
          <AccountsCompareToggle meter={meter} compact />
          <WorkerSetupButton meter={meter} compact />
        </div>
      </header>

      <div className="mt-3 space-y-3">
        <AlertStrip snapshot={snapshot} />

        <AccountsStrip meter={meter} gaugeSize={72} minCardWidth={150} />

        <section className="rounded-xl border border-border bg-card p-3">
          <Gauge
            pct={snapshot.session.pct}
            label="5-hour session"
            size={160}
            sub={`${snapshot.session.used}/${quotas.session}`}
            resetIn={formatDuration(snapshot.session.resetInMs)}
            resetAt={formatClock(snapshot.session.resetAt)}
            className="mx-auto"
          />
          <Gauge
            pct={snapshot.week.pct}
            label="This week"
            size={160}
            sub={`${snapshot.week.used}/${quotas.weekly}`}
            resetIn={formatDuration(snapshot.week.resetInMs)}
            resetAt={formatClock(snapshot.week.resetAt)}
            className="mx-auto mt-3"
          />
          {live ? null : (
            <div className="mt-3">
              <LogPad onLog={logUsage} onUndo={undoLast} onReset={resetAll} unit={quotas.unit} />
            </div>
          )}
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-3">
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
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-3">
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
        </section>

        <section className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
            {live ? "Observed weekly change" : "Last 7 days"}
          </h2>
          <div className="mt-2">
            <HistoryChart snapshot={snapshot} height={100} />
          </div>
        </section>

        {live ? null : (
          <section className="rounded-xl border border-border bg-card p-3">
            <h2 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
              Limits
            </h2>
            <QuotaEditor
              session={localQuotas.session}
              weekly={localQuotas.weekly}
              onChange={(next) => setQuotas({ ...localQuotas, ...next })}
            />
          </section>
        )}
      </div>
    </div>
  );
}
