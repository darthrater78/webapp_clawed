import type { Level } from "@/lib/clawd/metrics";
import { cn } from "@/lib/utils";

function levelOf(pct: number): Level {
  return pct >= 95 ? "critical" : pct >= 80 ? "warn" : "ok";
}

const stroke: Record<Level, string> = {
  ok: "stroke-ok",
  warn: "stroke-warn",
  critical: "stroke-crit",
};

const text: Record<Level, string> = {
  ok: "text-ok",
  warn: "text-warn",
  critical: "text-crit",
};

export function Gauge({
  pct,
  label,
  sub,
  resetIn,
  resetAt,
  size = 104,
  thickness = 9,
  className,
}: {
  pct: number;
  label: string;
  sub?: string;
  /** Countdown text shown under the ring, e.g. "2h 14m left". */
  resetIn?: string;
  /** Wall-clock reset moment shown under the ring, e.g. "today 9:45 PM". */
  resetAt?: string;
  size?: number;
  thickness?: number;
  className?: string;
}) {
  const level = levelOf(pct);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, pct) / 100) * c;

  const showReset = Boolean((resetIn && resetIn !== "—") || (resetAt && resetAt !== "—"));

  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={thickness}
            className="stroke-surface-2"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap={pct > 0 ? "round" : "butt"}
            strokeDasharray={`${dash} ${c}`}
            className={cn(stroke[level], "transition-[stroke-dasharray] duration-500")}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <span
            className={cn("numerals font-bold leading-none", text[level])}
            style={{ fontSize: size * 0.26 }}
          >
            {Math.round(pct)}%
          </span>
          <span className="mt-0.5 text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          {sub ? <span className="numerals text-[0.6rem] text-muted-foreground">{sub}</span> : null}
        </div>
      </div>
      {showReset ? (
        <div className="max-w-full text-center leading-tight">
          {resetIn && resetIn !== "—" ? (
            <p className="numerals text-[0.62rem] font-semibold text-foreground">{resetIn} left</p>
          ) : null}
          {resetAt && resetAt !== "—" ? (
            <p className="numerals text-[0.58rem] text-muted-foreground">resets {resetAt}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Bar({
  pct,
  label,
  right,
  tone = "auto",
  compact,
}: {
  pct: number;
  label: string;
  right?: string;
  tone?: "auto" | "sonnet" | "opus";
  compact?: boolean;
}) {
  const level = levelOf(pct);
  const fill =
    tone === "sonnet"
      ? "bg-sonnet"
      : tone === "opus"
        ? "bg-opus"
        : level === "critical"
          ? "bg-crit"
          : level === "warn"
            ? "bg-warn"
            : "bg-ok";

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "truncate font-semibold uppercase tracking-wider text-muted-foreground",
            compact ? "text-[0.58rem]" : "text-[0.65rem]",
          )}
        >
          {label}
        </span>
        <span
          className={cn("numerals shrink-0 font-semibold", compact ? "text-[0.6rem]" : "text-xs")}
        >
          {right ?? `${Math.round(pct)}%`}
        </span>
      </div>
      <div
        className={cn("mt-1 overflow-hidden rounded-full bg-surface-2", compact ? "h-1.5" : "h-2")}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", fill)}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
