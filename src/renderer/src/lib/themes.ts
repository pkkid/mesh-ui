/**
 * Applies a theme palette to the document as --theme-* custom properties and
 * keeps the native titlebar overlay in sync. Preferences live in localStorage.
 *
 * As in T3 Code, light and dark are picked separately: `light` is the theme
 * used in light mode and `dark` the one used in dark mode, so a pair can mix
 * two themes or two styles of one collection (Gruvbox Soft by day, Hard at
 * night). Picking a theme by its name sets both.
 */
import { useSyncExternalStore } from "react";

import {
  DEFAULT_THEME,
  findTheme,
  parseThemeSettings,
  subscribeThemeLibrary,
  type AppearanceMode,
  type ThemeSettings,
} from "./themeLibrary";
import {
  SERIES_HUES,
  THEME_COLOR_ROLES,
  getSeriesForAppearance,
  getThemeColorsForAppearance,
  getThemeModes,
  type ThemeAppearance,
  type ThemeDefinition,
} from "./themePalettes";

export type { AppearanceMode, ThemeSettings };

const STORAGE_KEY = "mesh-ui:theme:v1";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function readSettings(): ThemeSettings {
  try {
    return parseThemeSettings(localStorage.getItem(STORAGE_KEY), (id) => findTheme(id) !== undefined);
  } catch {
    return parseThemeSettings(null, () => false);
  }
}

let settings = readSettings();

export function resolveAppearance(mode: AppearanceMode): ThemeAppearance {
  if (mode !== "system") return mode;
  return systemDark.matches ? "dark" : "light";
}

/** The theme picked for an appearance. */
export function themeFor(current: ThemeSettings, appearance: ThemeAppearance): ThemeDefinition {
  return findTheme(current[appearance]) ?? DEFAULT_THEME;
}

const kebab = (role: string) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function applyTheme(): void {
  const wanted = resolveAppearance(settings.mode);
  const theme = themeFor(settings, wanted);
  // A one-appearance theme shows as itself, so the page stays legible.
  const appearance = getThemeModes(theme).includes(wanted) ? wanted : theme.appearance;
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

/** The topbar toggle: flip between the light and dark pick. */
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

/** Uses a theme for every appearance it has; a one-appearance theme sets only its own. */
export function pickThemeEverywhere(theme: ThemeDefinition): void {
  const next: Partial<ThemeSettings> = {};
  for (const mode of getThemeModes(theme)) next[mode] = theme.id;
  setThemeSettings(next);
}

systemDark.addEventListener("change", () => {
  if (settings.mode === "system") applyTheme();
  listeners.forEach((l) => l());
});

// A removed theme falls back to the default.
subscribeThemeLibrary(() => {
  const exists = (id: string) => findTheme(id) !== undefined;
  if (!exists(settings.light) || !exists(settings.dark)) {
    setThemeSettings({
      light: exists(settings.light) ? settings.light : DEFAULT_THEME.id,
      dark: exists(settings.dark) ? settings.dark : DEFAULT_THEME.id,
    });
  }
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
