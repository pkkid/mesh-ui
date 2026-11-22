/**
 * What the theme editor shows: its color families in groups, the chart
 * hues, and the label for any color variable (shared by the panel and the
 * inspector's hover label). Trimmed from T3 Code's ThemeEditorPanel.tsx.
 */
import { SERIES_HUES, themeVariable, type SeriesHue, type ThemeColorRole } from "~/lib/themePalettes";

export type Family = { id: string; label: string; role: ThemeColorRole; roles: ReadonlyArray<ThemeColorRole> };

/**
 * The colors the advanced mode shows, grouped by area. Each family is one
 * field: its first role is the one edited, the rest follow it
 * (`updateThemeColorFamily`). Roles Mesh UI does not paint (T3 Code's
 * terminal, search matches, message bubbles) are left out and keep their values.
 */
export const ROLE_GROUPS: ReadonlyArray<{ id: string; title: string; families: ReadonlyArray<Family> }> = [
  {
    id: "foundation",
    title: "Foundation",
    families: [
      { id: "background", label: "Background", role: "canvas", roles: ["canvas", "chrome", "toolbar"] },
      { id: "surface", label: "Card", role: "surface", roles: ["surface"] },
      { id: "raised", label: "Raised surface", role: "surfaceRaised", roles: ["surfaceRaised"] },
      { id: "overlay", label: "Popover", role: "surfaceOverlay", roles: ["surfaceOverlay"] },
      { id: "text", label: "Text", role: "text", roles: ["text", "toolbarForeground", "toolbarControlForeground"] },
      {
        id: "muted-text",
        label: "Muted text",
        role: "mutedForeground",
        roles: ["textMuted", "mutedForeground", "placeholder", "secondaryLabel", "iconMuted", "sidebarMutedForeground"],
      },
      { id: "border", label: "Border", role: "border", roles: ["border", "toolbarBorder", "sidebarBorder"] },
      { id: "input", label: "Input border", role: "input", roles: ["input"] },
    ],
  },
  {
    id: "brand",
    title: "Brand and controls",
    families: [
      { id: "subtle", label: "Subtle surface", role: "secondary", roles: ["secondary", "secondaryForeground", "muted", "toolbarControl"] },
      { id: "highlight", label: "Hover and selection", role: "accentSurface", roles: ["accentSurface", "accentSurfaceForeground", "toolbarControlHover"] },
      { id: "accent", label: "Accent and focus", role: "accent", roles: ["accent", "accentForeground", "focus", "update", "updateForeground", "updateSurface", "terminalCursor"] },
      { id: "action", label: "Primary button", role: "messageAction", roles: ["messageAction", "messageActionForeground", "messageActionHover"] },
      { id: "code", label: "Code", role: "codeBackground", roles: ["codeBackground", "codeForeground"] },
    ],
  },
  {
    id: "sidebar",
    title: "Sidebar",
    families: [
      { id: "sidebar", label: "Sidebar", role: "sidebar", roles: ["sidebar", "sidebarForeground"] },
      { id: "sidebar-controls", label: "Sidebar controls", role: "sidebarControlSurface", roles: ["sidebarControlSurface"] },
      { id: "sidebar-selection", label: "Sidebar selection", role: "sidebarRowSelected", roles: ["sidebarRowHover", "sidebarRowActive", "sidebarRowSelected"] },
    ],
  },
  {
    id: "status",
    title: "Status",
    families: [
      { id: "error", label: "Error", role: "error", roles: ["error", "errorForeground", "errorSurface"] },
      { id: "warning", label: "Warning", role: "warning", roles: ["warning", "warningForeground", "warningSurface"] },
    ],
  },
];

export const SERIES_LABELS: Record<SeriesHue, string> = {
  blue: "Blue",
  purple: "Purple",
  aqua: "Aqua",
  orange: "Orange",
  red: "Red",
  green: "Green (online)",
  yellow: "Yellow",
  gray: "Gray",
};

export const SIMPLE_ROLES: ReadonlyArray<ThemeColorRole> = ["canvas", "accent"];
export const FAMILIES = ROLE_GROUPS.flatMap((g) => g.families);
export const FAMILY_BY_VARIABLE = new Map(FAMILIES.flatMap((f) => f.roles.map((role) => [themeVariable(role), f] as const)));
export const seriesVariable = (hue: SeriesHue) => `--series-${hue}`;
export const HUE_BY_VARIABLE = new Map(SERIES_HUES.map((hue) => [seriesVariable(hue), hue] as const));

/** The label shown for a variable: its family's, a chart hue's, or the role's own. */
export function variableLabel(variable: string): string {
  const family = FAMILY_BY_VARIABLE.get(variable);
  if (family) return family.label;
  const hue = HUE_BY_VARIABLE.get(variable);
  if (hue) return `Chart ${SERIES_LABELS[hue].toLowerCase()}`;
  return variable.replace(/^--theme-/, "").replace(/-/g, " ");
}

