/**
 * Whether the floating theme editor is open, and what it edits. Ported from
 * T3 Code's `themeEditorStore.ts` (a zustand store there, a small external
 * store here). Pure view state, not a command.
 */
import { useSyncExternalStore } from "react";

import type { ThemeAppearance } from "~/lib/themePalettes";

export type ThemeEditorSession = {
  /** Bumped on each open, so a new session remounts the panel. */
  id: number;
  /** A saved theme being edited, or null when creating one. */
  editingThemeId: string | null;
  /** The theme a new one starts from (Duplicate). */
  seedThemeId: string | null;
  /** The new theme's starting name ("Grove copy"). */
  seedName: string | null;
  initialAppearance: ThemeAppearance;
};

let session: ThemeEditorSession | null = null;
let nextId = 0;
const listeners = new Set<() => void>();

function set(next: ThemeEditorSession | null) {
  session = next;
  listeners.forEach((l) => l());
}

export function openThemeEditor(input: Omit<ThemeEditorSession, "id">): void {
  set({ ...input, id: ++nextId });
}

export function closeThemeEditor(): void {
  set(null);
}

export function useThemeEditorSession(): ThemeEditorSession | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => session,
  );
}
