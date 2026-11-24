/**
 * Download and upload colors (Settings, Application settings): blue and
 * purple (the default), or green and red (green download, red upload). Like
 * the theme, it is view state saved on this computer (localStorage). It sets
 * `data-traffic-colors` on the root, and index.css maps `--series-download`
 * and `--series-upload` to the active theme's hues, so every chart, legend
 * and rate follows without a re-render (`seriesColors.download`, `.upload`).
 */
import { useSyncExternalStore } from "react";

import type { SeriesHue } from "./themePalettes";

export type TrafficColors = "blue-purple" | "green-red";

/** Each choice with the theme hues it uses (as index.css maps them), for the menu's color dots. */
export const TRAFFIC_COLOR_OPTIONS = [
  { value: "blue-purple", label: "Blue and purple", download: "blue", upload: "purple" },
  { value: "green-red", label: "Green and red", download: "green", upload: "red" },
] as const satisfies ReadonlyArray<{ value: TrafficColors; label: string; download: SeriesHue; upload: SeriesHue }>;

const STORAGE_KEY = "mesh-ui:traffic-colors:v1";
const isTrafficColors = (v: unknown): v is TrafficColors => v === "blue-purple" || v === "green-red";

function read(): TrafficColors {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isTrafficColors(v) ? v : "blue-purple";
  } catch {
    return "blue-purple";
  }
}

let current: TrafficColors = read();
const listeners = new Set<() => void>();

/** Sets the root attribute for the current choice; called once at startup. */
export function applyTrafficColors(): void {
  document.documentElement.dataset.trafficColors = current;
}

export function setTrafficColors(next: TrafficColors): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage unavailable: keep the change for this session only.
  }
  applyTrafficColors();
  for (const l of listeners) l();
}

export function useTrafficColors(): TrafficColors {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
