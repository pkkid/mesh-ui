/**
 * The app's rebindable keyboard shortcuts (docs/ux/overview.md#keyboard-shortcuts,
 * Settings > Keyboard shortcuts). Pure view state, like themes: not a
 * command, kept per computer in localStorage as overrides layered over the
 * defaults. Each action has one key combination (src/shared/shortcuts.ts),
 * or none once removed (stored as "").
 *
 * Every rebindable action runs through `useShortcut`, which shares one
 * window keydown listener and also hears the keys main catches before the
 * page (`window.mesh.onCaughtKey`: Ctrl+R / Cmd+R and F5, so they never
 * reload the window). Fixed shortcuts (Ctrl+1 to 7, [ and ], /, Esc, ...)
 * keep their own handlers and are listed in FIXED so a binding can't take
 * them.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import { comboText, eventCombo, formatCombo, isFunctionKey, isModifierCode, parseCombo } from "@shared/shortcuts";

export type ShortcutId = "palette.open" | "nav.settings" | "nav.back" | "nav.forward" | "data.refresh" | "devtools.toggle";

export type ShortcutAction = { id: ShortcutId; label: string; defaults: { mac: string; other: string } };

/** The rebindable actions, in the order Settings lists them. */
export const SHORTCUTS: ReadonlyArray<ShortcutAction> = [
  { id: "palette.open", label: "Open command palette", defaults: { mac: "F1", other: "F1" } },
  { id: "nav.settings", label: "Open Settings", defaults: { mac: "meta+Comma", other: "ctrl+Comma" } },
  // Option+Left moves by a word in macOS text fields, so the Mac default is Cmd+[ as in Safari and Chrome.
  { id: "nav.back", label: "Go back", defaults: { mac: "meta+BracketLeft", other: "alt+ArrowLeft" } },
  { id: "nav.forward", label: "Go forward", defaults: { mac: "meta+BracketRight", other: "alt+ArrowRight" } },
  { id: "data.refresh", label: "Refresh page data", defaults: { mac: "F5", other: "F5" } },
  { id: "devtools.toggle", label: "Toggle DevTools panel", defaults: { mac: "F12", other: "F12" } },
];

/**
 * Shortcuts that stay fixed, and the system keys a binding must not take.
 * `mod` is Cmd on macOS and Ctrl elsewhere.
 */
const FIXED: ReadonlyArray<{ keys: string; label: string; only?: "mac" | "other" }> = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ keys: `mod+Digit${n}`, label: `the page shortcut ${n}` })),
  { keys: "mod+shift+KeyN", label: "Switch network" },
  { keys: "mod+shift+KeyC", label: "Copy as a CLI line" },
  { keys: "mod+shift+KeyR", label: "reloading the window" },
  { keys: "mod+shift+KeyI", label: "Electron's developer tools" },
  { keys: "mod+KeyA", label: "Select all" },
  { keys: "mod+KeyC", label: "Copy" },
  { keys: "mod+KeyV", label: "Paste" },
  { keys: "mod+KeyX", label: "Cut" },
  { keys: "mod+KeyZ", label: "Undo" },
  { keys: "mod+shift+KeyZ", label: "Redo" },
  { keys: "mod+KeyY", label: "Redo", only: "other" },
  { keys: "mod+KeyW", label: "closing the window" },
  { keys: "mod+KeyQ", label: "quitting the app" },
  { keys: "mod+KeyM", label: "minimizing the window", only: "mac" },
  { keys: "mod+KeyH", label: "hiding the app", only: "mac" },
  { keys: "mod+Equal", label: "zoom" },
  { keys: "mod+shift+Equal", label: "zoom" },
  { keys: "mod+Minus", label: "zoom" },
  { keys: "mod+Digit0", label: "zoom" },
  { keys: "alt+F4", label: "closing the window", only: "other" },
  { keys: "F11", label: "full screen", only: "other" },
];

export const isMac = (): boolean => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

const STORAGE_KEY = "mesh-ui:shortcuts";

function readOverrides(): Partial<Record<ShortcutId, string>> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<ShortcutId, string>> = {};
    for (const a of SHORTCUTS) {
      const v = (parsed as Record<string, unknown>)[a.id];
      if (typeof v === "string" && (v === "" || parseCombo(v))) out[a.id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

let overrides = readOverrides();
const listeners = new Set<() => void>();

function writeOverrides(next: Partial<Record<ShortcutId, string>>): void {
  overrides = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the binding holds for this session only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const actionById = (id: ShortcutId): ShortcutAction => SHORTCUTS.find((a) => a.id === id) as ShortcutAction;

export function defaultBinding(id: ShortcutId): string {
  const d = actionById(id).defaults;
  return isMac() ? d.mac : d.other;
}

/** The action's current key combination ("F1", "ctrl+Comma"), or "" when removed. */
export function bindingFor(id: ShortcutId): string {
  return overrides[id] ?? defaultBinding(id);
}

export function isChanged(id: ShortcutId): boolean {
  return overrides[id] !== undefined && overrides[id] !== defaultBinding(id);
}

/** Expands `mod` to this platform's command key. */
function resolveFixed(keys: string): string {
  const c = parseCombo(keys.replace(/^mod\+/, isMac() ? "meta+" : "ctrl+"));
  return c ? formatCombo(c) : keys;
}

/**
 * Why a combination can't be bound to this action, or null when it can.
 * A global shortcut needs Ctrl, Cmd or Alt (Option), or a function key, so
 * plain typing never fires it; it can't be one the app keeps fixed or the
 * system uses, or one another action already has.
 */
export function bindingProblem(id: ShortcutId, combo: string): string | null {
  const c = parseCombo(combo);
  if (!c) return "That key can't be used.";
  const mac = isMac();
  if (!c.ctrl && !c.meta && !c.alt && !isFunctionKey(c.code)) {
    return mac ? "Add Cmd, Ctrl or Option, so typing in a field isn't taken over. F-keys work alone." : "Add Ctrl or Alt, so typing in a field isn't taken over. F-keys work alone.";
  }
  const text = comboText(combo, mac);
  for (const f of FIXED) {
    if (f.only === (mac ? "other" : "mac")) continue;
    if (resolveFixed(f.keys) === combo) return `${text} is kept for ${f.label}.`;
  }
  for (const a of SHORTCUTS) {
    if (a.id !== id && combo !== "" && bindingFor(a.id) === combo) return `${text} is already used by ${a.label}.`;
  }
  return null;
}

/** Saves a new combination; returns the problem instead when it can't be bound. */
export function setBinding(id: ShortcutId, combo: string): string | null {
  const problem = bindingProblem(id, combo);
  if (problem) return problem;
  const next = { ...overrides };
  if (combo === defaultBinding(id)) delete next[id];
  else next[id] = combo;
  writeOverrides(next);
  return null;
}

/** Leaves the action with no keys (Settings, Remove); Reset to default brings them back. */
export function removeBinding(id: ShortcutId): void {
  writeOverrides({ ...overrides, [id]: "" });
}

export function resetBinding(id: ShortcutId): void {
  if (overrides[id] === undefined) return;
  const next = { ...overrides };
  delete next[id];
  writeOverrides(next);
}

export function resetAllBindings(): void {
  writeOverrides({});
}

/** Re-reads the overrides from storage (tests, and a restart). */
export function reloadBindings(): void {
  overrides = readOverrides();
  listeners.forEach((l) => l());
}

/** The action's current combination, re-rendering when it changes. */
export function useBinding(id: ShortcutId): string {
  return useSyncExternalStore(subscribe, () => bindingFor(id));
}

/** Whether any action has keys other than its default (Settings shows Reset all). */
export function useAnyChanged(): boolean {
  return useSyncExternalStore(subscribe, () => SHORTCUTS.some((a) => isChanged(a.id)));
}

/** The action's current combination as tooltip text ("F1", "Ctrl+,", "⌘["), "" when it has none. */
export function useShortcutText(id: ShortcutId): string {
  return comboText(useBinding(id), isMac());
}

/** A tooltip with the action's keys in brackets when it has any: "Refresh (F5)", or just "Refresh". */
export function withKeys(label: string, keys: string): string {
  return keys ? `${label} (${keys})` : label;
}

// ---------------------------------------------------------------------------
// Dispatch

type Handler = () => void;
const handlers = new Map<ShortcutId, Set<Handler>>();
/** While Settings records a new combination, every key goes to it and no shortcut runs. */
let recorder: ((combo: string | null) => void) | null = null;
let attached = false;

/** Runs the action bound to this combination, if any. True when one ran. */
export function dispatchCombo(combo: string): boolean {
  if (recorder) {
    recorder(combo);
    return true;
  }
  if (!combo) return false;
  for (const a of SHORTCUTS) {
    if (bindingFor(a.id) !== combo) continue;
    const set = handlers.get(a.id);
    if (!set || set.size === 0) return false;
    for (const h of set) h();
    return true;
  }
  return false;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.isComposing || isModifierCode(e.code)) return;
  if (recorder) {
    // Plain Tab moves focus on as usual; leaving the field cancels recording.
    if (e.code === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Plain Esc cancels recording; it can never be a binding.
    recorder(e.code === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey ? null : eventCombo(e));
    return;
  }
  if (dispatchCombo(eventCombo(e))) e.preventDefault();
}

/** Installs the one key listener, once; it lives as long as the window. */
function attach(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  // Capture, so recording sees keys before the page's own handlers (Ctrl+1, Esc in a dialog).
  window.addEventListener("keydown", onKeyDown, true);
  const mesh = (window as { mesh?: { onCaughtKey?: (l: (combo: string) => void) => () => void } }).mesh;
  if (typeof mesh?.onCaughtKey === "function") mesh.onCaughtKey((combo) => void dispatchCombo(combo));
}

/** Adds a handler for the action's keys; returns its removal. `useShortcut` is the hook form. */
export function onShortcut(id: ShortcutId, handler: Handler): () => void {
  let set = handlers.get(id);
  if (!set) handlers.set(id, (set = new Set()));
  set.add(handler);
  return () => void set.delete(handler);
}

/** Runs `handler` when the action's keys are pressed (its current binding). */
export function useShortcut(id: ShortcutId, handler: Handler, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    attach();
    return onShortcut(id, () => ref.current());
  }, [id, enabled]);
}

/**
 * Sends the next key combination to `onKeys` instead of running shortcuts,
 * null when plain Esc cancels. Returns a stop function.
 */
export function recordNextCombo(onKeys: (combo: string | null) => void): () => void {
  attach();
  recorder = onKeys;
  return () => {
    if (recorder === onKeys) recorder = null;
  };
}
