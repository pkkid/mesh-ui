/**
 * The VS Code theme colours Mesh UI reads, shared by the renderer's import
 * (src/renderer/src/lib/vscodeTheme.ts) and main's Open VSX download
 * (src/main/open-vsx.ts), which trims themes to these keys before they
 * cross IPC.
 */

/** The VS Code colour keys the import reads. Anything else in a theme file is ignored. */
export const VSCODE_THEME_COLOR_KEYS: ReadonlySet<string> = new Set([
  "activityBar.background",
  "activityBarBadge.background",
  "badge.background",
  "button.background",
  "button.foreground",
  "contrastBorder",
  "descriptionForeground",
  "disabledForeground",
  "dropdown.background",
  "editor.background",
  "editor.foreground",
  "editor.findMatchBackground",
  "editor.findMatchForeground",
  "editor.findMatchHighlightBackground",
  "editor.findMatchHighlightForeground",
  "editor.selectionBackground",
  "editorCursor.foreground",
  "editorError.foreground",
  "editorGroup.border",
  "editorPane.background",
  "editorWarning.foreground",
  "editorWidget.background",
  "errorForeground",
  "focusBorder",
  "foreground",
  "input.background",
  "input.border",
  "input.placeholderForeground",
  "list.activeSelectionBackground",
  "list.hoverBackground",
  "list.inactiveSelectionBackground",
  "menu.background",
  "panel.background",
  "panel.border",
  "progressBar.background",
  "quickInput.background",
  "scrollbarSlider.background",
  "sideBar.background",
  "sideBar.border",
  "sideBar.foreground",
  "terminal.background",
  "terminal.foreground",
  "terminal.selectionBackground",
  "terminalCursor.foreground",
  "textCodeBlock.background",
  "textLink.foreground",
  ...["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"].flatMap((name) => [
    `terminal.ansi${name}`,
    `terminal.ansiBright${name}`,
  ]),
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keeps only the colours the import reads, so stored and transferred themes stay small. */
export function trimVsCodeTheme(value: Record<string, unknown>): Record<string, unknown> {
  const colors = isRecord(value.colors) ? value.colors : {};
  const kept = Object.fromEntries(
    Object.entries(colors).filter(
      ([key, color]) => VSCODE_THEME_COLOR_KEYS.has(key) && typeof color === "string" && color.length <= 128,
    ),
  );
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.type === "string" ? { type: value.type } : {}),
    colors: kept,
  };
}
