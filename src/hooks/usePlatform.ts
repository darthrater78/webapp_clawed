import { useEffect, useState } from "react";

export type Platform =
  | "widget-landscape"
  | "widget-portrait"
  | "widget-expanded"
  | "widget-xl"
  | "sidepanel"
  | "fullpage";

export function detectPlatform(w: number, h: number): Platform {
  // Widget profiles are short containers on a dashboard grid.
  if (h <= 220) return "widget-landscape";
  if (h <= 620) {
    if (w <= 460) return "widget-portrait";
    if (w <= 860) return "widget-expanded";
    return "widget-xl";
  }
  // Tall + narrow = browser side panel (min 360 x 900).
  if (w <= 520) return "sidepanel";
  return "fullpage";
}

export const isWidget = (p: Platform) => p.startsWith("widget-");

export function usePlatform(): { platform: Platform; width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const read = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return {
    platform: detectPlatform(size.width || 1280, size.height || 900),
    width: size.width,
    height: size.height,
  };
}
