/**
 * Every theme the picker offers: the palettes in themePalettes.ts and themes
 * the user added (VS Code themes from files or Open VSX, such as Gruvbox),
 * which live in localStorage on this computer only. Pure view state, not a
 * command.
 */
import { useSyncExternalStore } from "react";

import { parseColor } from "./themeColor";
import {
  CLASSIC_THEME,
  PALETTE_THEMES,
  SERIES_HUES,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "./themePalettes";

export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = PALETTE_THEMES;
/** Classic, T3 Code's own default. */
export const DEFAULT_THEME: ThemeDefinition = CLASSIC_THEME;

export type AppearanceMode = ThemeAppearance | "system";
export type ThemeSettings = { light: string; dark: string; mode: AppearanceMode };

/** Ids saved by earlier builds. */
const RENAMED_THEMES: Record<string, string> = { default: "classic", "t3-chat": "rose" };
const MODES: ReadonlyArray<AppearanceMode> = ["light", "dark", "system"];

const DEFAULT_SETTINGS: ThemeSettings = { light: DEFAULT_THEME.id, dark: DEFAULT_THEME.id, mode: "system" };

/**
 * Reads saved settings, including the `{ themeId, mode }` shape of earlier
 * builds. An id that no longer resolves (a removed theme) falls back to the default.
 */
export function parseThemeSettings(raw: string | null, exists: (id: string) => boolean): ThemeSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(raw) as Partial<ThemeSettings> & { themeId?: string };
    const resolve = (id: unknown) => {
      const renamed = typeof id === "string" ? (RENAMED_THEMES[id] ?? id) : "";
      return exists(renamed) ? renamed : DEFAULT_THEME.id;
    };
    return {
      light: resolve(saved.light ?? saved.themeId),
      dark: resolve(saved.dark ?? saved.themeId),
      mode: MODES.includes(saved.mode as AppearanceMode) ? (saved.mode as AppearanceMode) : DEFAULT_SETTINGS.mode,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const BUILT_IN_IDS = new Set(BUILT_IN_THEMES.map((theme) => theme.id));
const CUSTOM_KEY = "mesh-ui:themes:v1";
const MAX_CUSTOM_THEMES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isColors(value: unknown): value is ThemeColors {
  return isRecord(value) && THEME_COLOR_ROLES.every((role) => parseColor(value[role]) !== null);
}

function isSeries(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([mode, palette]) =>
      (mode === "light" || mode === "dark") &&
      isRecord(palette) &&
      SERIES_HUES.every((hue) => parseColor(palette[hue]) !== null),
  );
}

/** A stored theme, checked role by role: storage is user-writable, so nothing is trusted. */
export function parseStoredTheme(value: unknown): ThemeDefinition | null {
  if (!isRecord(value)) return null;
  const { id, label, appearance, colors, variants, collection, series } = value;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || BUILT_IN_IDS.has(id)) return null;
  if (typeof label !== "string" || !label.trim() || label.length > 48) return null;
  if (appearance !== "light" && appearance !== "dark") return null;
  if (!isColors(colors) || !isSeries(series)) return null;
  const other: ThemeAppearance = appearance === "light" ? "dark" : "light";
  const variant = isRecord(variants) ? variants[other] : undefined;
  if (variant !== undefined && !isColors(variant)) return null;
  const validCollection =
    isRecord(collection) &&
    typeof collection.id === "string" &&
    collection.id.length <= 128 &&
    typeof collection.label === "string" &&
    collection.label.length <= 64;
  return {
    id,
    label: label.trim(),
    appearance,
    colors,
    ...(variant ? { variants: { [other]: variant } } : {}),
    ...(validCollection ? { collection: { id: collection.id as string, label: collection.label as string } } : {}),
    ...(series ? { series: series as ThemeDefinition["series"] } : {}),
  };
}

const listeners = new Set<() => void>();
let customThemes: ReadonlyArray<ThemeDefinition> = readCustomThemes();
let allThemes: ReadonlyArray<ThemeDefinition> = [...BUILT_IN_THEMES, ...customThemes];

function readCustomThemes(): ReadonlyArray<ThemeDefinition> {
  try {
    const raw = globalThis.localStorage?.getItem(CUSTOM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => parseStoredTheme(entry) ?? []).slice(0, MAX_CUSTOM_THEMES);
  } catch {
    return [];
  }
}

function writeCustomThemes(next: ReadonlyArray<ThemeDefinition>): void {
  customThemes = next;
  allThemes = [...BUILT_IN_THEMES, ...customThemes];
  try {
    globalThis.localStorage?.setItem(CUSTOM_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable or full: keep the themes for this session only.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeThemeLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getAllThemes = (): ReadonlyArray<ThemeDefinition> => allThemes;
export const getCustomThemes = (): ReadonlyArray<ThemeDefinition> => customThemes;
export const isBuiltInTheme = (id: string): boolean => BUILT_IN_IDS.has(id);
export const findTheme = (id: string): ThemeDefinition | undefined => allThemes.find((theme) => theme.id === id);

export function useAllThemes(): ReadonlyArray<ThemeDefinition> {
  return useSyncExternalStore(subscribeThemeLibrary, getAllThemes);
}

/**
 * Adds themes, replacing any saved theme with the same id. A theme whose id
 * belongs to a built-in gets a suffix instead. Returns the themes as stored.
 */
export function installThemes(themes: ReadonlyArray<ThemeDefinition>): ReadonlyArray<ThemeDefinition> {
  const installed = themes.map((theme) => {
    let id = theme.id;
    for (let n = 2; BUILT_IN_IDS.has(id); n += 1) id = `${theme.id}-${n}`;
    return { ...theme, id };
  });
  const ids = new Set(installed.map((theme) => theme.id));
  writeCustomThemes([...customThemes.filter((theme) => !ids.has(theme.id)), ...installed].slice(-MAX_CUSTOM_THEMES));
  return installed;
}

export function removeThemes(ids: ReadonlyArray<string>): void {
  const remove = new Set(ids);
  writeCustomThemes(customThemes.filter((theme) => !remove.has(theme.id)));
}

/**
 * Themes grouped as the picker shows them: one entry per collection (its
 * themes in order) or per lone theme, built-ins first.
 */
export function groupThemes(themes: ReadonlyArray<ThemeDefinition>): ReadonlyArray<ReadonlyArray<ThemeDefinition>> {
  const groups = new Map<string, ThemeDefinition[]>();
  for (const theme of themes) {
    const key = theme.collection ? `collection:${theme.collection.id}` : `theme:${theme.id}`;
    const group = groups.get(key);
    if (group) group.push(theme);
    else groups.set(key, [theme]);
  }
  return [...groups.values()];
}
