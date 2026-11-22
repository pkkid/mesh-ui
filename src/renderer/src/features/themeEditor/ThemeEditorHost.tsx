/**
 * Mounts the floating theme editor once, in the window shell, while a
 * session is open (themeEditorStore.ts). The panel is loaded on first use.
 * Ported from T3 Code's `ThemeEditorHost.tsx`.
 */
import { lazy, Suspense, useEffect } from "react";

import { findTheme, useAllThemes } from "~/lib/themeLibrary";

import { closeThemeEditor, useThemeEditorSession } from "./themeEditorStore";

const ThemeEditorPanel = lazy(() => import("./ThemeEditorPanel").then((module) => ({ default: module.ThemeEditorPanel })));

export function ThemeEditorHost() {
  const session = useThemeEditorSession();
  useAllThemes(); // re-render when the library changes, so a removed theme is noticed
  const editingTheme = session?.editingThemeId ? (findTheme(session.editingThemeId) ?? null) : null;
  const seedTheme = session?.seedThemeId ? (findTheme(session.seedThemeId) ?? null) : null;
  // The theme being edited was removed (from another card or window): nothing is left to edit.
  const gone = session?.editingThemeId != null && editingTheme === null;
  useEffect(() => {
    if (gone) closeThemeEditor();
  }, [gone]);
  if (!session || gone) return null;
  return (
    <Suspense fallback={null}>
      <ThemeEditorPanel
        key={session.id}
        editingTheme={editingTheme}
        seedTheme={seedTheme}
        seedName={session.seedName}
        initialAppearance={session.initialAppearance}
        onClose={closeThemeEditor}
      />
    </Suspense>
  );
}
