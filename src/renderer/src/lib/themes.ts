/**
 * Applies a theme palette to the document as --theme-* custom properties and
 * keeps the native titlebar overlay in sync. Preferences live in localStorage.
 */
import { useSyncExternalStore } from "react";
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME,
  SERIES_HUES,
  THEME_COLOR_ROLES,
  getSeriesForAppearance,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeDefinition,
} from "./themePalettes";

export type AppearanceMode = ThemeAppearance | "system";
export type ThemeSettings = { themeId: string; mode: AppearanceMode };

const STORAGE_KEY = "mesh-ui:theme:v1";
/** Ids saved by earlier builds. */
const RENAMED_THEMES: Record<string, string> = { default: "classic", "t3-chat": "rose" };
const MODES: ReadonlyArray<AppearanceMode> = ["light", "dark", "system"];

const DEFAULT_SETTINGS: ThemeSettings = { themeId: DEFAULT_THEME.id, mode: "system" };
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

let settings = readSettings();

function readSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<ThemeSettings>;
    const themeId = RENAMED_THEMES[saved.themeId ?? ""] ?? saved.themeId;
    return {
      themeId: BUILT_IN_THEMES.some((t) => t.id === themeId) ? (themeId as string) : DEFAULT_SETTINGS.themeId,
      mode: MODES.includes(saved.mode as AppearanceMode) ? (saved.mode as AppearanceMode) : DEFAULT_SETTINGS.mode,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const themes: ReadonlyArray<ThemeDefinition> = BUILT_IN_THEMES;

export function resolveAppearance(mode: AppearanceMode): ThemeAppearance {
  if (mode !== "system") return mode;
  return systemDark.matches ? "dark" : "light";
}

const kebab = (role: string) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function applyTheme(): void {
  const theme = themes.find((t) => t.id === settings.themeId) ?? DEFAULT_THEME;
  const appearance = resolveAppearance(settings.mode);
  const colors = getThemeColorsForAppearance(theme, appearance);
  const root = document.documentElement;

  root.classList.add("no-transitions");
  root.classList.toggle("dark", appearance === "dark");
  root.dataset.themeId = theme.id;
  for (const role of THEME_COLOR_ROLES) {
    root.style.setProperty(`--theme-${kebab(role)}`, colors[role]);
  }
  const series = getSeriesForAppearance(theme, appearance);
  for (const hue of SERIES_HUES) {
    root.style.setProperty(`--series-${hue}`, series[hue]);
  }
  // Force a style flush before re-enabling transitions.
  void root.offsetHeight;
  root.classList.remove("no-transitions");

  window.mesh?.setTitlebarColors({
    color: toHex(colors.chrome),
    symbolColor: toHex(colors.toolbarForeground),
  });
}

/** Electron's titlebar overlay only understands hex/rgb, so resolve any CSS color. */
function toHex(color: string): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#000000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The topbar toggle: flip between the light and dark variant of the current theme. */
export function toggleAppearance(): void {
  setThemeSettings({ mode: resolveAppearance(settings.mode) === "dark" ? "light" : "dark" });
}

export function setThemeSettings(next: Partial<ThemeSettings>): void {
  settings = { ...settings, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: keep the change for this session only.
  }
  applyTheme();
  listeners.forEach((l) => l());
}

systemDark.addEventListener("change", () => {
  if (settings.mode === "system") applyTheme();
  listeners.forEach((l) => l());
});

export function useThemeSettings(): ThemeSettings {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => settings,
  );
}

/** The appearance in effect now, following the system when the mode is "system". */
export function useResolvedAppearance(): ThemeAppearance {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => resolveAppearance(settings.mode),
  );
}
