import { Columns3 } from "lucide-react";

import { Bar, Gauge } from "@/components/clawd/Gauge";
import type { Clawdmeter } from "@/hooks/useClawdmeter";
import { clamp, formatClock, formatDuration } from "@/lib/clawd/metrics";
import { cn } from "@/lib/utils";

/** Toggles the everything-at-once view. Shown whenever live accounts are connected. */
export function AccountsCompareToggle({ meter, compact }: { meter: Clawdmeter; compact?: boolean }) {
  const { accounts, compare, setCompare } = meter.worker;
  if (meter.source !== "worker" || accounts.length === 0) return null;

  return (
    <button
      type="button"
      aria-pressed={compare}
      title="Show every connected account at once"
      onClick={() => setCompare(!compare)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border font-semibold transition-colors",
        compare ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground hover:bg-accent",
        compact ? "px-2 py-1 text-[0.6rem]" : "px-2.5 py-1.5 text-xs",
      )}
    >
      <Columns3 className="size-3" /> All accounts
    </button>
  );
}

function resetBits(iso: string | null): { resetIn: string; resetAt: string } {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(at)) return { resetIn: "—", resetAt: "—" };
  return { resetIn: formatDuration(Math.max(0, at - Date.now())), resetAt: formatClock(at) };
}

/**
 * Every enrolled account shown at once, with the full detail of each: both meters,
 * their reset times, and the model split. Columns fold automatically to the width
 * of whatever container it sits in, so it works in a widget card or a side panel.
 */
export function AccountsStrip({
  meter,
  gaugeSize = 96,
  minCardWidth = 260,
}: {
  meter: Clawdmeter;
  gaugeSize?: number;
  minCardWidth?: number;
}) {
  const { accounts, readings, compare, config, selectAccount } = meter.worker;
  if (meter.source !== "worker" || !compare || accounts.length === 0) return null;

  return (
    <div className="space-y-2">
      {accounts.length < 2 ? (
        <p className="text-[0.65rem] text-muted-foreground">
          Only one account is connected. Add another in the settings panel to see them side by side.
        </p>
      ) : null}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${minCardWidth}px, 1fr))` }}
      >
        {accounts.map((account) => {
          const reading = readings[account.id];
          const session = clamp(reading?.fiveHour.utilization ?? 0);
          const week = clamp(reading?.sevenDay.utilization ?? 0);
          const sonnet = clamp(reading?.sevenDaySonnet?.utilization ?? 0);
          const opus = clamp(reading?.sevenDayOpus?.utilization ?? 0);
          const selected = config?.accountId === account.id;
          const five = resetBits(reading?.fiveHour.resetsAt ?? null);
          const seven = resetBits(reading?.sevenDay.resetsAt ?? null);
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => selectAccount(account.id)}
              className={cn(
                "flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/40",
                selected ? "border-primary" : "border-border",
              )}
            >
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate text-xs font-bold uppercase tracking-widest">
                  {account.label}
                </span>
                <span className="numerals shrink-0 text-[0.55rem] uppercase tracking-widest text-muted-foreground">
                  {reading ? (reading.needsReauth ? "re-enrol" : reading.stale ? "stale" : "live") : "…"}
                </span>
              </div>

              <div className="flex flex-wrap items-start justify-center gap-3">
                <Gauge
                  pct={session}
                  label="5-hour"
                  size={gaugeSize}
                  thickness={8}
                  resetIn={five.resetIn}
                  resetAt={five.resetAt}
                />
                <Gauge
                  pct={week}
                  label="Week"
                  size={gaugeSize}
                  thickness={8}
                  resetIn={seven.resetIn}
                  resetAt={seven.resetAt}
                />
              </div>

              <div className="space-y-1.5">
                <Bar pct={sonnet} label="Sonnet weekly" tone="sonnet" compact />
                <Bar pct={opus} label="Opus weekly" tone="opus" compact />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
