import { describe, expect, it } from "vitest";

import { colorToHex, contrastRatio, hexToHsv, hsvToHex, parseRgb, updateThemeColorFamily } from "~/lib/themeColor";
import { findTheme, freeThemeId, getCustomThemes, installThemes, removeThemes, updateTheme } from "~/lib/themeLibrary";
import { CLASSIC_THEME, GROVE_THEME, MID_TONE_SERIES, THEME_COLOR_ROLES, themeVariable, type ThemeDefinition } from "~/lib/themePalettes";
import { parseThemeTexts, serializeThemeFile, themeFileName, themesFromFiles } from "~/lib/vscodeTheme";

import { ROLE_GROUPS, variableLabel } from "./themeEditorRoles";
import { THEME_VARIABLES, variableFromUtilityClass } from "./themeInspector";

const custom = (id: string, label: string, extra: Partial<ThemeDefinition> = {}): ThemeDefinition => ({
  ...GROVE_THEME,
  id,
  label,
  ...extra,
});

describe("theme files: export and import back", () => {
  it("round-trips one theme with both palettes and its chart colors", () => {
    const theme = custom("my-grove", "My Grove", { series: { dark: { ...MID_TONE_SERIES.dark, blue: "#123456" } } });
    const text = serializeThemeFile(theme);
    expect(JSON.parse(text)).toMatchObject({ version: 1, id: "my-grove", name: "My Grove", appearance: theme.appearance });
    const [back] = themesFromFiles([{ name: "my-grove.json", text }]);
    expect(back).toEqual(theme);
  });

  it("round-trips a collection as one file of several themes", () => {
    const collection = { id: "import:pair", label: "Pair" };
    const themes = [custom("pair-a", "Pair A", { collection }), custom("pair-b", "Pair B", { collection })];
    const text = serializeThemeFile(themes);
    expect(themeFileName(themes)).toBe("pair.json");
    expect(parseThemeTexts(text)).toHaveLength(2);
    expect(themesFromFiles([{ name: "pair.json", text }])).toEqual(themes);
  });

  it("exports built-ins too, which import as an added copy", () => {
    const [back] = themesFromFiles([{ name: "classic.json", text: serializeThemeFile(CLASSIC_THEME) }]);
    expect(back?.colors).toEqual(CLASSIC_THEME.colors);
    const [installed] = installThemes([back!]);
    expect(installed?.id).toBe("classic-2");
    removeThemes([installed!.id]);
  });

  it("rejects an empty collection file", () => {
    expect(() => parseThemeTexts("[]")).toThrow(/no themes/);
  });
});

describe("theme library: edit and duplicate", () => {
  it("updates a saved theme in place and refuses built-ins", () => {
    installThemes([custom("one", "One"), custom("two", "Two")]);
    expect(updateTheme(custom("one", "One renamed"))).toBe(true);
    expect(getCustomThemes().map((t) => t.label)).toEqual(["One renamed", "Two"]);
    expect(updateTheme(CLASSIC_THEME)).toBe(false);
    removeThemes(["one", "two"]);
  });

  it("finds a free id for a copy", () => {
    expect(freeThemeId("grove")).toBe("grove-2");
    expect(freeThemeId("aurora")).toBe("aurora");
    installThemes([custom("aurora", "Aurora")]);
    expect(freeThemeId("aurora")).toBe("aurora-2");
    removeThemes(["aurora"]);
    expect(findTheme("aurora")).toBeUndefined();
  });
});

describe("color families", () => {
  const colors = CLASSIC_THEME.colors;

  it("moves the window chrome with the background", () => {
    const next = updateThemeColorFamily("light", colors, "canvas", "#fafaf0");
    expect([next.canvas, next.chrome, next.toolbar].map((c) => colorToHex(c))).toEqual(["#fafaf0", "#fafaf0", "#fafaf0"]);
  });

  it("derives readable text for a surface and a status color", () => {
    const sidebar = updateThemeColorFamily("light", colors, "sidebar", "#1d2021");
    expect(contrastRatio(parseRgb(sidebar.sidebarForeground, { r: 0, g: 0, b: 0 }), parseRgb(sidebar.sidebar, { r: 0, g: 0, b: 0 }))).toBeGreaterThan(4.5);
    const error = updateThemeColorFamily("light", colors, "error", "#cc241d");
    expect(error.errorSurface).not.toBe(colors.errorSurface);
    expect(error.errorForeground).not.toBe(colors.errorForeground);
  });

  it("covers every role in at most one family", () => {
    const roles = ROLE_GROUPS.flatMap((g) => g.families.flatMap((f) => f.roles));
    expect(new Set(roles).size).toBe(roles.length);
    for (const role of roles) expect(THEME_COLOR_ROLES).toContain(role);
  });

  it("converts the picker's HSV and hex both ways", () => {
    for (const hex of ["#000000", "#ffffff", "#cc241d", "#458588"]) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
});

describe("inspector", () => {
  it("maps Mesh UI's color classes to the variable they read", () => {
    expect(variableFromUtilityClass("bg-card/40", "background")).toBe(themeVariable("surface"));
    expect(variableFromUtilityClass("text-muted-foreground", "foreground")).toBe("--theme-muted-foreground");
    expect(variableFromUtilityClass("bg-primary", "background")).toBe("--theme-message-action");
    expect(variableFromUtilityClass("text-success", "foreground")).toBe("--series-green");
    expect(variableFromUtilityClass("hover:bg-accent", "background")).toBeNull();
    expect(variableFromUtilityClass("text-xs", "foreground")).toBeNull();
  });

  it("probes every theme role and every chart hue", () => {
    expect(THEME_VARIABLES).toContain("--theme-canvas");
    expect(THEME_VARIABLES).toContain("--series-gray");
    expect(variableLabel("--theme-chrome")).toBe("Background");
    expect(variableLabel("--series-blue")).toBe("Chart blue");
  });
});
