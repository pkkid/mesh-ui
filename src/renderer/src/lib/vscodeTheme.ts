/**
 * Turns VS Code colour themes into Mesh UI themes, the way T3 Code does.
 * Ported from T3 Code (https://github.com/pingdotgg/t3code,
 * apps/web/src/vscodeThemeImport.ts), MIT License, Copyright (c) 2026 T3 Tools Inc.
 *
 * A VS Code theme names colours for editor parts (`editor.background`,
 * `sideBar.background`, ...). The canvas and an accent seed a full palette
 * (`createVividThemeColors`), then each role the theme names directly
 * overrides it, flattened to an opaque colour and checked for contrast.
 * Mesh UI also reads the terminal's ANSI colours for its chart series,
 * which T3 Code does not use.
 */
import { parse, type ParseError } from "jsonc-parser";

import type { ThemeExtension, ThemeFile } from "@shared/types";
import { trimVsCodeTheme, VSCODE_THEME_COLOR_KEYS } from "@shared/vscode-theme";

import {
  colorToHex,
  contrastRatio,
  createVividThemeColors,
  flattenOver,
  formatOklch,
  isDarkSurface,
  oklchToRgb,
  parseColor,
  parseRgb,
  readableColorOn,
  rgbToHex,
  rgbToOklch,
  type Rgb,
  type Rgba,
} from "./themeColor";
import {
  SERIES_HUES,
  THEME_COLOR_ROLES,
  getThemeModes,
  type SeriesPalette,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from "./themePalettes";

const MAX_LABEL = 48;

export { trimVsCodeTheme, VSCODE_THEME_COLOR_KEYS };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `gruvbox-dark-hard` to `Gruvbox Dark Hard`; names with spaces stay as they are. */
export function humanizeThemeName(raw: string): string {
  const trimmed = raw.trim();
  if (/\s/.test(trimmed) || !/[-_.]/.test(trimmed)) return trimmed;
  return trimmed
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function themeIdFromName(name: string): string {
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return id || "theme";
}

export function isVsCodeThemeFile(value: unknown): boolean {
  if (!isRecord(value) || value.version === THEME_FILE_VERSION) return false;
  const hasWorkbenchColors = isRecord(value.colors) && Object.keys(value.colors).some((key) => key.includes("."));
  return hasWorkbenchColors || Array.isArray(value.tokenColors);
}

function resolveAppearance(value: Record<string, unknown>, canvas: Rgb): ThemeAppearance {
  const type = typeof value.type === "string" ? value.type.toLowerCase() : null;
  if (type === "light" || type === "hc-light") return "light";
  if (type === "dark" || type === "hc-black") return "dark";
  return isDarkSurface(canvas) ? "dark" : "light";
}

const ANSI: Record<Exclude<(typeof SERIES_HUES)[number], "orange" | "gray">, string> = {
  blue: "Blue",
  purple: "Magenta",
  aqua: "Cyan",
  red: "Red",
  green: "Green",
  yellow: "Yellow",
};

/**
 * Chart hues from the terminal's ANSI colours. Of each normal and bright
 * pair, the one that stands out more on the canvas wins, raised to 3:1 if it
 * is still too faint. Orange (which ANSI lacks) sits halfway between red and
 * yellow in OKLCH; gray is bright black. Null when the theme has no ANSI set.
 */
export function seriesFromAnsi(colors: Record<string, unknown>, canvas: Rgb): SeriesPalette | null {
  const canvasHex = rgbToHex(canvas);
  const pick = (name: string): string | null => {
    const candidates = [`terminal.ansi${name}`, `terminal.ansiBright${name}`]
      .map((key) => parseColor(colors[key]))
      .filter((color): color is Rgba => color !== null)
      .map((color) => flattenOver(color, canvas));
    if (candidates.length === 0) return null;
    const best = candidates.reduce((a, b) => (contrastRatio(b, canvas) > contrastRatio(a, canvas) ? b : a));
    return readableColorOn(rgbToHex(best), canvasHex, 3);
  };
  const palette: Partial<Record<(typeof SERIES_HUES)[number], string>> = {};
  for (const [hue, name] of Object.entries(ANSI)) {
    const color = pick(name);
    if (!color) return null;
    palette[hue as keyof typeof ANSI] = color;
  }
  const red = rgbToOklch(parseRgb(palette.red!, canvas));
  const yellow = rgbToOklch(parseRgb(palette.yellow!, canvas));
  const hueGap = ((yellow.h - red.h + 540) % 360) - 180;
  const orange = { L: (red.L + yellow.L) / 2, C: (red.C + yellow.C) / 2, h: red.h + hueGap / 2 };
  palette.orange = readableColorOn(rgbToHex(oklchToRgb(orange)), canvasHex, 3);
  const gray = parseColor(colors["terminal.ansiBrightBlack"]);
  palette.gray = gray
    ? readableColorOn(rgbToHex(flattenOver(gray, canvas)), canvasHex, 3)
    : formatOklch({ ...rgbToOklch(canvas), L: isDarkSurface(canvas) ? 0.62 : 0.55, C: 0.01 });
  return palette as SeriesPalette;
}

function resolveLabel(value: Record<string, unknown>, fallback?: string): string {
  for (const candidate of [fallback, value.displayName, value.name]) {
    if (typeof candidate !== "string") continue;
    const humanized = humanizeThemeName(candidate);
    if (humanized.length > 0) return humanized.slice(0, MAX_LABEL);
  }
  return "VS Code theme";
}

/**
 * One VS Code theme file as a single-appearance theme. `label` overrides the
 * file's own name (an extension's contribution label is often better).
 */
export function parseVsCodeTheme(value: unknown, options: { label?: string } = {}): ThemeDefinition {
  if (!isRecord(value)) throw new Error("Theme files must contain a JSON object.");
  const colors = isRecord(value.colors) ? value.colors : {};

  const pick = (...keys: ReadonlyArray<string>): Rgba | null => {
    for (const key of keys) {
      const parsed = parseColor(colors[key]);
      if (parsed) return parsed;
    }
    return null;
  };
  const solidOver = (base: Rgb, ...keys: ReadonlyArray<string>): string | null => {
    const parsed = pick(...keys);
    return parsed ? rgbToHex(flattenOver(parsed, base)) : null;
  };
  const rgb = (hex: string): Rgb => parseRgb(hex, { r: 0, g: 0, b: 0 });
  const standsApart = (first: string, second: string) => contrastRatio(rgb(first), rgb(second)) >= 1.1;

  const canvasColor = pick("editor.background", "editorPane.background");
  if (!canvasColor) {
    throw new Error('That VS Code theme has no "editor.background" color, so there is nothing to build a palette from.');
  }
  const canvas: Rgb = { r: canvasColor.r, g: canvasColor.g, b: canvasColor.b };
  const canvasHex = rgbToHex(canvas);
  const appearance = resolveAppearance(value, canvas);
  const raisedCandidate = solidOver(canvas, "editorWidget.background", "dropdown.background");

  // The accent is the first of these that shows on the canvas and on raised surfaces.
  let accentColor: Rgba | null = null;
  let accentHex: string | null = null;
  for (const key of [
    "focusBorder",
    "button.background",
    "textLink.foreground",
    "activityBarBadge.background",
    "progressBar.background",
    "badge.background",
  ]) {
    const candidate = parseColor(colors[key]);
    if (!candidate) continue;
    const candidateHex = rgbToHex(flattenOver(candidate, canvas));
    if (!standsApart(candidateHex, canvasHex)) continue;
    if (raisedCandidate !== null && !standsApart(candidateHex, raisedCandidate)) continue;
    accentColor = candidate;
    accentHex = candidateHex;
    break;
  }
  if (!accentColor || !accentHex) {
    const standardAccent = appearance === "dark" ? "#8b9cff" : "#1b4ed8";
    accentHex =
      [standardAccent, "#ffffff", "#000000"].find(
        (candidate) =>
          standsApart(candidate, canvasHex) && (raisedCandidate === null || standsApart(candidate, raisedCandidate)),
      ) ?? standardAccent;
    accentColor = { ...rgb(accentHex), a: 1 };
  }

  const mutedAccentHex = rgbToHex(flattenOver({ ...accentColor, a: 0.2 }, canvas));
  const derived = createVividThemeColors(appearance, canvasHex, mutedAccentHex);
  const derivedHex = (role: ThemeColorRole) => colorToHex(derived[role]) ?? "#808080";

  const sidebarHex = solidOver(canvas, "sideBar.background", "activityBar.background") ?? derivedHex("sidebar");
  const sidebar = rgb(sidebarHex);
  const terminalHex = solidOver(canvas, "terminal.background", "panel.background") ?? derivedHex("terminalBackground");
  const terminal = rgb(terminalHex);

  /** The first named colour readable at 4.5:1 on `surface`, else the derived one, else black or white. */
  const readableOn = (surface: string, fallback: string, ...keys: ReadonlyArray<string>): string => {
    const surfaceRgb = rgb(surface);
    const isReadable = (candidate: string) => contrastRatio(parseRgb(candidate, surfaceRgb), surfaceRgb) >= 4.5;
    const specified = solidOver(surfaceRgb, ...keys);
    if (specified && isReadable(specified)) return specified;
    if (isReadable(fallback)) return fallback;
    return isDarkSurface(surfaceRgb) ? "#ffffff" : "#000000";
  };
  // Status colours also fill destructive buttons with white text, so a dim one
  // is lightened along its hue rather than replaced by black or white.
  const readableStatus = (fallback: string, ...keys: ReadonlyArray<string>): string => {
    const specified = solidOver(canvas, ...keys);
    const base = specified && standsApart(specified, canvasHex) ? specified : (colorToHex(fallback) ?? fallback);
    return readableColorOn(base, canvasHex, 4.5);
  };

  const surfaceRaisedHex = raisedCandidate ?? derivedHex("surfaceRaised");
  const buttonHex = solidOver(canvas, "button.background");
  const actionHex =
    buttonHex && standsApart(buttonHex, canvasHex) && standsApart(buttonHex, surfaceRaisedHex) ? buttonHex : accentHex;
  const inputCandidates = [
    derivedHex("input"),
    derivedHex("surfaceRaised"),
    appearance === "dark" ? "#3f3f46" : "#d4d4d8",
    "#000000",
    "#ffffff",
    "#808080",
  ];
  let inputHex =
    inputCandidates.find((candidate) => standsApart(candidate, canvasHex) && standsApart(candidate, actionHex)) ??
    "#808080";
  for (const key of ["input.background", "input.border"]) {
    const candidate = solidOver(canvas, key);
    if (candidate && standsApart(candidate, canvasHex) && standsApart(candidate, actionHex)) {
      inputHex = candidate;
      break;
    }
  }
  const searchMatchBackground =
    solidOver(canvas, "editor.findMatchHighlightBackground") ?? derivedHex("searchMatchBackground");
  const searchMatchActiveBackground =
    solidOver(canvas, "editor.findMatchBackground") ?? derivedHex("searchMatchActiveBackground");

  const overrides: Partial<Record<ThemeColorRole, string>> = {
    canvas: canvasHex,
    text: readableOn(canvasHex, derived.text, "editor.foreground", "foreground"),
    textMuted: readableOn(canvasHex, derived.textMuted, "descriptionForeground", "disabledForeground"),
    surface: solidOver(canvas, "editorWidget.background") ?? derived.surface,
    surfaceRaised: surfaceRaisedHex,
    surfaceOverlay:
      solidOver(canvas, "menu.background", "quickInput.background", "dropdown.background") ?? derived.surfaceOverlay,
    border: solidOver(canvas, "panel.border", "editorGroup.border", "contrastBorder") ?? derived.border,
    input: inputHex,
    placeholder: readableOn(surfaceRaisedHex, derived.placeholder, "input.placeholderForeground"),
    error: readableStatus(derived.error, "editorError.foreground", "errorForeground"),
    warning: readableStatus(derived.warning, "editorWarning.foreground"),
    accentSurface: solidOver(canvas, "list.activeSelectionBackground", "list.hoverBackground") ?? derived.accentSurface,
    codeBackground: solidOver(canvas, "textCodeBlock.background") ?? derived.codeBackground,
    searchMatchBackground,
    searchMatchForeground: readableOn(
      searchMatchBackground,
      derived.searchMatchForeground,
      "editor.findMatchHighlightForeground",
      "editor.foreground",
      "foreground",
    ),
    searchMatchActiveBackground,
    searchMatchActiveForeground: readableOn(
      searchMatchActiveBackground,
      derived.searchMatchActiveForeground,
      "editor.findMatchForeground",
      "editor.foreground",
      "foreground",
    ),
    sidebar: sidebarHex,
    sidebarForeground: readableOn(sidebarHex, derived.sidebarForeground, "sideBar.foreground"),
    sidebarBorder: solidOver(sidebar, "sideBar.border") ?? derived.sidebarBorder,
    sidebarRowHover: solidOver(sidebar, "list.hoverBackground") ?? derived.sidebarRowHover,
    sidebarRowActive:
      solidOver(sidebar, "list.inactiveSelectionBackground", "list.hoverBackground") ?? derived.sidebarRowActive,
    sidebarRowSelected: solidOver(sidebar, "list.activeSelectionBackground") ?? derived.sidebarRowSelected,
    terminalBackground: terminalHex,
    terminalForeground: readableOn(terminalHex, derived.terminalForeground, "terminal.foreground"),
    terminalCursor: solidOver(terminal, "terminalCursor.foreground", "editorCursor.foreground") ?? derived.terminalCursor,
    terminalSelection:
      solidOver(terminal, "terminal.selectionBackground", "editor.selectionBackground") ?? derived.terminalSelection,
    terminalScrollbar: solidOver(terminal, "scrollbarSlider.background") ?? derived.terminalScrollbar,
    accent: accentHex,
    focus: accentHex,
    messageAction: actionHex,
    messageActionForeground: readableOn(actionHex, derived.messageActionForeground, "button.foreground"),
    accentForeground: readableOn(accentHex, derived.accentForeground, "button.foreground"),
  };

  const label = resolveLabel(value, options.label);
  const series = seriesFromAnsi(colors, canvas);
  return {
    id: themeIdFromName(label),
    label,
    appearance,
    colors: { ...derived, ...overrides },
    ...(series ? { series: { [appearance]: series } } : {}),
  };
}

/**
 * Joins "X Light" and "X Dark" into one theme "X" with both appearances,
 * as T3 Code does. Anything that does not pair stays as it is, in order.
 */
export function pairVsCodeThemes(themes: ReadonlyArray<ThemeDefinition>): ReadonlyArray<ThemeDefinition> {
  const stripAppearance = (label: string) =>
    label
      .replace(/\b(?:light|dark)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  type Group = { light: ThemeDefinition[]; dark: ThemeDefinition[]; order: number };
  const groups = new Map<string, Group>();
  const out: Array<{ theme: ThemeDefinition; order: number }> = [];
  themes.forEach((theme, order) => {
    const key = stripAppearance(theme.label);
    if (getThemeModes(theme).length !== 1 || key === theme.label || !/[a-z0-9]/i.test(key)) {
      out.push({ theme, order });
      return;
    }
    const group = groups.get(key) ?? { light: [], dark: [], order };
    group[theme.appearance].push(theme);
    groups.set(key, group);
  });

  for (const [key, group] of groups) {
    const [light] = group.light;
    const [dark] = group.dark;
    if (group.light.length === 1 && group.dark.length === 1 && light && dark) {
      out.push({
        order: group.order,
        theme: {
          id: themeIdFromName(key),
          label: key,
          appearance: "light",
          colors: light.colors,
          variants: { dark: dark.colors },
          ...(light.series?.light || dark.series?.dark
            ? { series: { ...(light.series ?? {}), ...(dark.series ?? {}) } }
            : {}),
        },
      });
      continue;
    }
    for (const theme of [...group.light, ...group.dark]) out.push({ theme, order: group.order });
  }
  return out.sort((a, b) => a.order - b.order).map((entry) => entry.theme);
}

/**
 * The short names of a collection's themes: the words they all start with
 * are dropped ("Gruvbox Hard", "Gruvbox Soft" to "Hard", "Soft").
 */
export function collectionVariantLabels(themes: ReadonlyArray<ThemeDefinition>): ReadonlyArray<string> {
  if (themes.length === 0) return [];
  const words = themes.map((theme) => theme.label.trim().split(/\s+/));
  const first = words[0]!;
  const shared = first.findIndex((word, index) =>
    words.some((labelWords) => labelWords[index]?.toLowerCase() !== word.toLowerCase()),
  );
  const prefix = shared === -1 ? first.length - 1 : shared;
  return themes.map((theme, index) => words[index]?.slice(Math.max(0, prefix)).join(" ").trim() || theme.label);
}

/**
 * Themes that came from one source (an extension, a set of files): paired
 * into light and dark, and grouped as a collection when more than one remains.
 */
export function buildThemeCollection(
  themes: ReadonlyArray<ThemeDefinition>,
  collection: { id: string; label: string },
): ReadonlyArray<ThemeDefinition> {
  const paired = pairVsCodeThemes(themes);
  if (paired.length < 2) return paired;
  return paired.map((theme) => ({ ...theme, collection }));
}

/** Mesh UI and T3 Code theme files: `{ version: 1, name, appearance, colors, variants? }`. */
export const THEME_FILE_VERSION = 1;

function parseColorOverrides(value: unknown): Partial<ThemeColors> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<ThemeColorRole, string>> = {};
  for (const role of THEME_COLOR_ROLES) {
    const color = value[role];
    if (typeof color === "string" && parseColor(color)) out[role] = color.trim();
  }
  return out;
}

/** A Mesh UI or T3 Code theme file. Missing roles are derived from the canvas and accent. */
export function parseThemeFile(value: unknown): ThemeDefinition {
  if (!isRecord(value)) throw new Error("Theme files must contain a JSON object.");
  if (value.version !== THEME_FILE_VERSION) throw new Error("This theme file uses an unsupported version.");
  const { name, appearance } = value;
  if (typeof name !== "string" || !name.trim() || name.length > MAX_LABEL) {
    throw new Error("Theme files need a name (48 characters or fewer).");
  }
  if (appearance !== "light" && appearance !== "dark") {
    throw new Error('Theme files need an appearance of "light" or "dark".');
  }
  const build = (mode: ThemeAppearance, raw: unknown): ThemeColors => {
    const overrides = parseColorOverrides(raw);
    const canvas = overrides.canvas ?? (mode === "dark" ? "#18181b" : "#fafafa");
    const accent = overrides.accent ?? (mode === "dark" ? "#8b9cff" : "#1b4ed8");
    return { ...createVividThemeColors(mode, canvas, accent), ...overrides };
  };
  const other: ThemeAppearance = appearance === "light" ? "dark" : "light";
  const variant = isRecord(value.variants) ? value.variants[other] : undefined;
  const label = name.trim();
  return {
    id: themeIdFromName(label),
    label,
    appearance,
    colors: build(appearance, value.colors),
    ...(isRecord(variant) ? { variants: { [other]: build(other, variant) } } : {}),
  };
}

/** Parses pasted or dropped text: a VS Code theme or a Mesh UI / T3 Code theme file. */
export function parseThemeText(source: string, fileName?: string): ThemeDefinition {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0 || value === undefined) throw new Error("That theme file is not valid JSON.");
  if (isVsCodeThemeFile(value)) {
    const label = isRecord(value) && typeof value.name === "string" ? undefined : fileName?.replace(/\.[^.]+$/, "");
    return parseVsCodeTheme(value, label ? { label } : {});
  }
  return parseThemeFile(value);
}

/**
 * An extension's themes as Mesh UI themes: paired into light and dark, one
 * collection per extension, ids prefixed with the extension so two
 * extensions never replace each other's themes (and reinstalling updates).
 */
export function themesFromExtension(extension: ThemeExtension, files: ReadonlyArray<ThemeFile>): ReadonlyArray<ThemeDefinition> {
  const parsed = files.flatMap((file) => {
    try {
      const theme = file.appearance && !file.theme.type ? { ...file.theme, type: file.appearance } : file.theme;
      return [parseVsCodeTheme(theme, { label: file.label })];
    } catch {
      return []; // A theme with no editor background cannot become a palette.
    }
  });
  if (parsed.length === 0) throw new Error(`${extension.name} has no themes Mesh UI can use.`);
  const prefix = themeIdFromName(extension.id);
  return buildThemeCollection(parsed, { id: `open-vsx:${extension.id.toLowerCase()}`, label: extension.name.slice(0, 48) }).map(
    (theme) => ({ ...theme, id: themeIdFromName(`${prefix}-${theme.id}`) }),
  );
}
