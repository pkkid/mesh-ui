/**
 * Key combinations for keyboard shortcuts, shared by main (which catches a
 * few keys before the page) and the renderer's shortcut registry
 * (src/renderer/src/lib/shortcuts.ts). A combination is stored as text:
 * modifiers in a fixed order, then the physical key's `code`, joined by `+`
 * ("ctrl+shift+KeyK", "alt+ArrowLeft", "F1"). `code` names the key, not the
 * character it types, so Shift and Option never change what is matched.
 */

export type KeyCombo = { ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; code: string };

/** The parts of a DOM KeyboardEvent a combination reads. */
export type KeyEventLike = { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "MetaLeft", "MetaRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "OSLeft", "OSRight", "CapsLock", "Fn", "FnLock"]);

/** Whether a key is only a modifier (pressing Ctrl alone records nothing). */
export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

export function comboFromEvent(e: KeyEventLike): KeyCombo {
  return { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, code: e.code };
}

export function formatCombo(c: KeyCombo): string {
  return [c.ctrl && "ctrl", c.meta && "meta", c.alt && "alt", c.shift && "shift", c.code].filter(Boolean).join("+");
}

/** The combination stored as text, or null when it is not one. */
export function parseCombo(text: string): KeyCombo | null {
  const parts = text.split("+");
  const code = parts.pop();
  if (!code || isModifierCode(code) || !/^[A-Za-z][A-Za-z0-9]*$/.test(code)) return null;
  const mods = new Set(parts);
  for (const m of mods) if (m !== "ctrl" && m !== "meta" && m !== "alt" && m !== "shift") return null;
  return { ctrl: mods.has("ctrl"), meta: mods.has("meta"), alt: mods.has("alt"), shift: mods.has("shift"), code };
}

/** A key event's combination as text, the form bindings are stored and compared in. */
export function eventCombo(e: KeyEventLike): string {
  return formatCombo(comboFromEvent(e));
}

/** Function keys (F1 to F24) may be bound without a modifier. */
export function isFunctionKey(code: string): boolean {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(code);
}

/** The key on its own, as printed on the key cap ("K", ",", "←", "F5"). */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${NUMPAD[code.slice(6)] ?? code.slice(6)}`;
  return NAMED[code] ?? code;
}

const NUMPAD: Record<string, string> = { Add: "+", Subtract: "-", Multiply: "*", Divide: "/", Decimal: ".", Enter: "Enter", Equal: "=" };

const NAMED: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Space: "Space",
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Tab: "Tab",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  IntlBackslash: "\\",
};

/**
 * The key caps of a combination, in each platform's order: macOS shows
 * symbols (⌃ ⌥ ⇧ ⌘ K), Windows and Linux words (Ctrl Alt Shift K).
 */
export function comboKeys(text: string, mac: boolean): string[] {
  const c = parseCombo(text);
  if (!c) return [];
  const key = keyLabel(c.code);
  if (mac) return [c.ctrl && "⌃", c.alt && "⌥", c.shift && "⇧", c.meta && "⌘", key].filter((k): k is string => Boolean(k));
  return [c.ctrl && "Ctrl", c.meta && (WIN ? "Win" : "Super"), c.alt && "Alt", c.shift && "Shift", key].filter((k): k is string => Boolean(k));
}

const WIN = typeof navigator !== "undefined" && (navigator.platform ?? "").startsWith("Win");

/** A combination as one line of text for tooltips and messages: "Ctrl+K" or "⌘K". */
export function comboText(text: string, mac: boolean): string {
  return comboKeys(text, mac).join(mac ? "" : "+");
}
