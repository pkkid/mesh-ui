import { describe, expect, it } from "vitest";

import { colorToHex, contrastRatio, parseColor, parseRgb } from "./themeColor";
import { GRUVBOX_THEMES, groupThemes, parseStoredTheme, parseThemeSettings } from "./themeLibrary";
import { THEME_COLOR_ROLES, getThemeColorsForAppearance, type ThemeDefinition } from "./themePalettes";
import {
  buildThemeCollection,
  collectionVariantLabels,
  pairVsCodeThemes,
  parseThemeText,
  parseVsCodeTheme,
  seriesFromAnsi,
  themesFromExtension,
  trimVsCodeTheme,
} from "./vscodeTheme";

const hex = (value: string) => colorToHex(value);
const white = { r: 255, g: 255, b: 255 };

/** An invented VS Code theme, enough to exercise every rule. */
const sample = (type: "dark" | "light", overrides: Record<string, string> = {}) => ({
  name: `Sample ${type === "dark" ? "Dark" : "Light"}`,
  type,
  colors: {
    "editor.background": type === "dark" ? "#101418" : "#fafaf5",
    "editor.foreground": type === "dark" ? "#d8dee9" : "#2e3440",
    "sideBar.background": type === "dark" ? "#0b0e11" : "#f0f0ea",
    focusBorder: "#5e81ac",
    "button.background": "#5e81ac",
    "panel.border": type === "dark" ? "#2a3038" : "#d8d8d0",
    ...overrides,
  },
});

describe("parseColor", () => {
  it("reads hex, rgb, oklch and color()", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#45858880")?.a).toBeCloseTo(0.5, 2);
    expect(parseColor("rgb(60 56 54 / 4%)")).toMatchObject({ r: 60, g: 56, b: 54, a: 0.04 });
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toMatchObject({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(hex("oklch(1 0 0)")).toBe("#ffffff");
    expect(hex("color(srgb 1 0 0)")).toBe("#ff0000");
    expect(parseColor("red")).toBeNull();
    expect(parseColor(42)).toBeNull();
  });
});

describe("parseVsCodeTheme", () => {
  it("maps editor colours onto roles", () => {
    const theme = parseVsCodeTheme(sample("dark"));
    expect(theme.label).toBe("Sample Dark");
    expect(theme.appearance).toBe("dark");
    expect(theme.colors.canvas).toBe("#101418");
    expect(theme.colors.text).toBe("#d8dee9");
    expect(theme.colors.sidebar).toBe("#0b0e11");
    expect(theme.colors.accent).toBe("#5e81ac");
    expect(theme.colors.messageAction).toBe("#5e81ac");
    expect(theme.colors.border).toBe("#2a3038");
    for (const role of THEME_COLOR_ROLES) expect(parseColor(theme.colors[role]), role).not.toBeNull();
  });

  it("replaces text that would not be readable", () => {
    const theme = parseVsCodeTheme(sample("dark", { "editor.foreground": "#1a1e22" }));
    const text = parseRgb(theme.colors.text, white);
    expect(contrastRatio(text, parseRgb(theme.colors.canvas, white))).toBeGreaterThanOrEqual(4.5);
  });

  it("flattens translucent colours onto their surface", () => {
    const theme = parseVsCodeTheme(sample("dark", { "list.activeSelectionBackground": "#ffffff80" }));
    expect(theme.colors.accentSurface).toBe("#888a8c");
  });

  it("works out the appearance from the canvas when the type is missing", () => {
    const { type: _type, ...rest } = sample("light");
    expect(parseVsCodeTheme(rest).appearance).toBe("light");
  });

  it("needs an editor background", () => {
    expect(() => parseVsCodeTheme({ colors: { "editor.foreground": "#fff" } })).toThrow(/editor.background/);
  });

  it("takes chart series from the ANSI colours", () => {
    expect(GRUVBOX_THEMES[0]?.series?.dark).toMatchObject({
      blue: "#83a598",
      purple: "#d3869b",
      aqua: "#8ec07c",
      red: "#fb4934",
      green: "#b8bb26",
      yellow: "#fabd2f",
      gray: "#928374",
    });
    expect(GRUVBOX_THEMES[0]?.series?.light).toMatchObject({ blue: "#076678", purple: "#8f3f71", aqua: "#427b58" });
    expect(seriesFromAnsi({}, white)).toBeNull();
  });
});

describe("pairing and collections", () => {
  const dark = parseVsCodeTheme(sample("dark"));
  const light = parseVsCodeTheme(sample("light"));

  it("pairs X Light and X Dark into one theme", () => {
    const [paired, ...rest] = pairVsCodeThemes([dark, light]);
    expect(rest).toHaveLength(0);
    expect(paired).toMatchObject({ id: "sample", label: "Sample", appearance: "light" });
    expect(paired?.variants?.dark?.canvas).toBe("#101418");
    expect(paired?.series).toBeUndefined();
  });

  it("leaves unpaired themes alone", () => {
    expect(pairVsCodeThemes([dark]).map((t) => t.id)).toEqual(["sample-dark"]);
  });

  it("builds Gruvbox as three styles of one collection", () => {
    expect(GRUVBOX_THEMES.map((t) => t.id)).toEqual(["gruvbox-hard", "gruvbox-medium", "gruvbox-soft"]);
    expect(GRUVBOX_THEMES.every((t) => t.collection?.id === "gruvbox")).toBe(true);
    expect(collectionVariantLabels(GRUVBOX_THEMES)).toEqual(["Hard", "Medium", "Soft"]);
    const hard = GRUVBOX_THEMES[0]!;
    expect(hex(getThemeColorsForAppearance(hard, "dark").canvas)).toBe("#1d2021");
    expect(hex(getThemeColorsForAppearance(hard, "light").canvas)).toBe("#f9f5d7");
  });

  it("does not group a single theme", () => {
    expect(buildThemeCollection([dark, light], { id: "x", label: "X" })[0]?.collection).toBeUndefined();
  });

  it("groups by collection for the picker", () => {
    expect(groupThemes([...GRUVBOX_THEMES, dark]).map((g) => g.length)).toEqual([3, 1]);
  });
});

describe("parseThemeText", () => {
  it("reads VS Code JSON with comments and trailing commas", () => {
    const text = `// a comment\n{ "type": "dark", "colors": { "editor.background": "#202020", }, }`;
    expect(parseThemeText(text, "my-theme.json").label).toBe("My Theme");
  });

  it("reads T3 Code theme files, deriving missing roles", () => {
    const theme = parseThemeText(
      JSON.stringify({ version: 1, name: "Mine", appearance: "dark", colors: { canvas: "#111111" }, variants: { light: {} } }),
    );
    expect(theme.colors.canvas).toBe("#111111");
    expect(theme.variants?.light).toBeDefined();
  });

  it("rejects text that is not a theme", () => {
    expect(() => parseThemeText("nope")).toThrow(/not valid JSON/);
    expect(() => parseThemeText("{}")).toThrow(/version/);
  });

  it("trims a theme to the keys the import reads", () => {
    const trimmed = trimVsCodeTheme({ name: "x", type: "dark", colors: { "editor.background": "#000", "x.y": "#fff" }, tokenColors: [] });
    expect(trimmed).toEqual({ name: "x", type: "dark", colors: { "editor.background": "#000" } });
  });
});

describe("stored themes and settings", () => {
  const theme: ThemeDefinition = { ...parseVsCodeTheme(sample("dark")), id: "sample-dark" };

  it("round-trips a stored theme and rejects tampered ones", () => {
    expect(parseStoredTheme(JSON.parse(JSON.stringify(theme)))).toEqual(theme);
    expect(parseStoredTheme({ ...theme, id: "gruvbox-hard" })).toBeNull();
    expect(parseStoredTheme({ ...theme, colors: { ...theme.colors, canvas: "url(x)" } })).toBeNull();
  });

  it("migrates the single theme id of earlier builds", () => {
    const exists = (id: string) => ["rose", "gruvbox-hard", "ocean"].includes(id);
    expect(parseThemeSettings(JSON.stringify({ themeId: "t3-chat", mode: "dark" }), exists)).toEqual({
      light: "rose",
      dark: "rose",
      mode: "dark",
    });
    expect(parseThemeSettings(JSON.stringify({ light: "ocean", dark: "gone", mode: "bad" }), exists)).toEqual({
      light: "ocean",
      dark: "gruvbox-hard",
      mode: "system",
    });
    expect(parseThemeSettings("{", exists).light).toBe("gruvbox-hard");
  });
});

describe("themesFromExtension", () => {
  const extension = {
    id: "sample.sample-theme",
    name: "Sample Theme",
    publisher: "sample",
    description: "",
    version: "1.0.0",
    license: "MIT",
    downloadCount: 1,
    themeCount: 3,
  };
  const file = (label: string, appearance: "light" | "dark" | null, theme: Record<string, unknown>) => ({ label, appearance, theme });

  it("pairs, prefixes ids with the extension and skips unusable themes", () => {
    const { name: _n, type: _t, ...dark } = sample("dark");
    const themes = themesFromExtension(extension, [
      file("Sample Dark", "dark", dark),
      file("Sample Light", "light", sample("light")),
      file("Broken", "dark", { colors: {} }),
    ]);
    expect(themes.map((t) => [t.id, t.label, t.appearance])).toEqual([["sample-sample-theme-sample", "Sample", "light"]]);
    expect(themes[0]?.variants?.dark).toBeDefined();
  });

  it("groups several styles as one collection", () => {
    const themes = themesFromExtension(extension, [file("Sample Dark", "dark", sample("dark")), file("Other Dark", "dark", sample("dark"))]);
    expect(themes.map((t) => t.collection)).toEqual([
      { id: "open-vsx:sample.sample-theme", label: "Sample Theme" },
      { id: "open-vsx:sample.sample-theme", label: "Sample Theme" },
    ]);
  });

  it("fails when nothing is usable", () => {
    expect(() => themesFromExtension(extension, [file("Broken", "dark", {})])).toThrow(/no themes/);
  });
});
