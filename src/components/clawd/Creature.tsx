import { useEffect, useRef } from "react";
import type { Level, Mood } from "@/lib/clawd/metrics";
import {
  CLAWD_ANIMS,
  CLAWD_CELL,
  CLAWD_GRID,
  CLAWD_GROUPS,
  CLAWD_ROTATE_MS,
  CLAWD_TICK_MS,
  type ClawdGroup,
} from "@/lib/clawd/anims";
import { cn } from "@/lib/utils";

const groupOf: Record<Mood, ClawdGroup> = {
  idle: "idle",
  calm: "normal",
  busy: "active",
  heavy: "heavy",
};

const bandColor: Record<Level, string> = {
  ok: "#43A047",
  warn: "#FFB300",
  critical: "#E53935",
};

const SIZE = CLAWD_GRID * CLAWD_CELL;

/**
 * Pixel-art Clawd creature — animation clips and engine vendored from the
 * original Clawdmeter Lovelace card. Clip group follows burn rate, frame
 * colour follows pace.
 */
export function Creature({
  mood,
  level,
  size = 96,
  className,
}: {
  mood: Mood;
  level: Level;
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const groupRef = useRef<ClawdGroup>(groupOf[mood]);
  useEffect(() => {
    groupRef.current = groupOf[mood];
  }, [mood]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    let group: ClawdGroup | null = null;
    let slug = "";
    let rot = -1;
    let frame = 0;
    let t0 = performance.now();
    let lastPick = t0;

    const draw = () => {
      const anim = CLAWD_ANIMS[slug];
      if (!anim) return;
      const cells = anim.frames[frame];
      if (!cells) return;
      ctx.clearRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < CLAWD_GRID * CLAWD_GRID; i++) {
        const c = cells.charCodeAt(i) - 48;
        if (c <= 0) continue;
        ctx.fillStyle = anim.palette[c] || "#CE7D6B";
        ctx.fillRect(
          (i % CLAWD_GRID) * CLAWD_CELL,
          Math.floor(i / CLAWD_GRID) * CLAWD_CELL,
          CLAWD_CELL,
          CLAWD_CELL,
        );
      }
    };

    const pick = () => {
      const list = CLAWD_GROUPS[group ?? "idle"];
      if (!list.length) return;
      rot = (rot + 1) % list.length;
      slug = list[rot] ?? "";
      frame = 0;
      t0 = performance.now();
      lastPick = t0;
      draw();
    };

    const tick = () => {
      const now = performance.now();
      const next = groupRef.current;
      if (next !== group || !slug) {
        group = next;
        pick();
        return;
      }
      if (now - lastPick >= CLAWD_ROTATE_MS) {
        pick();
        return;
      }
      const anim = CLAWD_ANIMS[slug];
      const hold = anim?.holds[frame];
      if (hold != null && now - t0 >= hold) {
        frame = (frame + 1) % anim!.frames.length;
        t0 = now;
        draw();
      }
    };

    tick();
    const id = window.setInterval(tick, CLAWD_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const color = bandColor[level];

  return (
    <div
      className={cn(
        "relative shrink-0 rounded-2xl",
        level === "warn" && "pace-glow",
        level === "critical" && "pace-glow pace-glow-fast",
        className,
      )}
      style={{
        width: size,
        height: size,
        border: `3px solid ${color}`,
        // @ts-expect-error custom property for the glow keyframes
        "--pf": color,
      }}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="pixelated block h-full w-full"
      />
    </div>
  );
}
