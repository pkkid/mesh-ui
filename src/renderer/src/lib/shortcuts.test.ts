import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { comboText } from "@shared/shortcuts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bindingFor, bindingProblem, defaultBinding, dispatchCombo, isChanged, onShortcut, recordNextCombo, reloadBindings, removeBinding, resetAllBindings, resetBinding, SHORTCUTS, setBinding, withKeys } from "./shortcuts";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

function usePlatform(platform: string) {
  vi.stubGlobal("navigator", { platform });
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  usePlatform("Linux x86_64");
  reloadBindings();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shortcut defaults", () => {
  it("are F1, Ctrl+comma, Alt+arrows, F5 and F12 on Windows and Linux", () => {
    expect(SHORTCUTS.map((a) => bindingFor(a.id))).toEqual(["F1", "F12", "ctrl+Comma", "F5", "alt+ArrowLeft", "alt+ArrowRight"]);
  });

  it("use Cmd on macOS, and Cmd+[ / Cmd+] for Back and Forward (Option+arrow moves by word in fields)", () => {
    usePlatform("MacIntel");
    expect(SHORTCUTS.map((a) => bindingFor(a.id))).toEqual(["F1", "F12", "meta+Comma", "F5", "meta+BracketLeft", "meta+BracketRight"]);
  });

  it("have no conflicts between them on either platform", () => {
    for (const platform of ["Linux x86_64", "Win32", "MacIntel"]) {
      usePlatform(platform);
      for (const a of SHORTCUTS) expect(bindingProblem(a.id, defaultBinding(a.id))).toBeNull();
    }
  });
});

describe("rebinding", () => {
  it("moves the palette to the new keys and off F1, and Reset brings F1 back", () => {
    const opened = vi.fn();
    const off = onShortcut("palette.open", opened);
    try {
      expect(setBinding("palette.open", "ctrl+KeyP")).toBeNull();
      expect(isChanged("palette.open")).toBe(true);
      expect(dispatchCombo("F1")).toBe(false);
      expect(dispatchCombo("ctrl+KeyP")).toBe(true);
      expect(opened).toHaveBeenCalledTimes(1);

      resetBinding("palette.open");
      expect(isChanged("palette.open")).toBe(false);
      expect(dispatchCombo("ctrl+KeyP")).toBe(false);
      expect(dispatchCombo("F1")).toBe(true);
      expect(opened).toHaveBeenCalledTimes(2);
    } finally {
      off();
    }
  });

  it("survives a restart (read back from storage)", () => {
    setBinding("palette.open", "ctrl+KeyK");
    reloadBindings();
    expect(bindingFor("palette.open")).toBe("ctrl+KeyK");
  });

  it("runs Refresh on a key main caught (Ctrl+R) once it is bound there", () => {
    const refreshed = vi.fn();
    const off = onShortcut("data.refresh", refreshed);
    try {
      expect(dispatchCombo("ctrl+KeyR")).toBe(false);
      setBinding("data.refresh", "ctrl+KeyR");
      expect(dispatchCombo("ctrl+KeyR")).toBe(true);
      expect(refreshed).toHaveBeenCalledOnce();
    } finally {
      off();
    }
  });

  it("stores nothing when set back to the default, and Reset all clears every change", () => {
    setBinding("nav.settings", "alt+KeyS");
    setBinding("devtools.toggle", "F10");
    setBinding("nav.settings", "ctrl+Comma");
    expect(isChanged("nav.settings")).toBe(false);
    resetAllBindings();
    expect(SHORTCUTS.some((a) => isChanged(a.id))).toBe(false);
    expect(bindingFor("devtools.toggle")).toBe("F12");
  });

  it("Remove leaves the action with no keys, frees them for another action, and survives a restart", () => {
    const toggled = vi.fn();
    const off = onShortcut("devtools.toggle", toggled);
    try {
      removeBinding("devtools.toggle");
      expect(bindingFor("devtools.toggle")).toBe("");
      expect(isChanged("devtools.toggle")).toBe(true);
      expect(dispatchCombo("F12")).toBe(false);
      expect(dispatchCombo("")).toBe(false);
      expect(toggled).not.toHaveBeenCalled();
      expect(setBinding("palette.open", "F12")).toBeNull();
      reloadBindings();
      expect(bindingFor("devtools.toggle")).toBe("");
      resetBinding("devtools.toggle");
      expect(bindingFor("devtools.toggle")).toBe("F12");
    } finally {
      off();
    }
  });

  it("drops the brackets from tooltips when an action has no keys", () => {
    expect(withKeys("Refresh", "F5")).toBe("Refresh (F5)");
    expect(withKeys("Refresh", "")).toBe("Refresh");
  });

  it("ignores stored junk", () => {
    localStorage.setItem("mesh-ui:shortcuts", JSON.stringify({ "palette.open": "ctrl+", "nav.back": 3, nope: "F2" }));
    reloadBindings();
    expect(bindingFor("palette.open")).toBe("F1");
    expect(bindingFor("nav.back")).toBe("alt+ArrowLeft");
  });
});

describe("refused bindings", () => {
  it("refuse keys without Ctrl, Cmd or Alt, except function keys", () => {
    expect(setBinding("nav.back", "KeyB")).toMatch(/Add Ctrl or Alt/);
    expect(setBinding("nav.back", "shift+KeyB")).toMatch(/Add Ctrl or Alt/);
    expect(setBinding("nav.back", "F2")).toBeNull();
    usePlatform("MacIntel");
    expect(setBinding("nav.forward", "KeyB")).toMatch(/Add Cmd, Ctrl or Option/);
    expect(bindingFor("nav.forward")).toBe("meta+BracketRight");
  });

  it("refuse keys another action has, and keep the old binding", () => {
    expect(setBinding("nav.settings", "F1")).toBe("F1 is already used by Open command palette.");
    expect(bindingFor("nav.settings")).toBe("ctrl+Comma");
  });

  it("refuse fixed app shortcuts and system keys, per platform", () => {
    expect(setBinding("palette.open", "ctrl+KeyC")).toBe("Ctrl+C is kept for Copy.");
    expect(setBinding("palette.open", "ctrl+Digit3")).toMatch(/kept for the page shortcut 3/);
    expect(setBinding("palette.open", "ctrl+shift+KeyN")).toMatch(/Switch network/);
    expect(setBinding("palette.open", "alt+F4")).toMatch(/closing the window/);
    // Cmd+C is the Mac copy; Ctrl+C on a Mac is free.
    usePlatform("MacIntel");
    expect(setBinding("palette.open", "meta+KeyC")).toBe("⌘C is kept for Copy.");
    expect(setBinding("palette.open", "ctrl+KeyC")).toBeNull();
  });
});

describe("recording", () => {
  it("takes the next keys instead of running shortcuts, until stopped", () => {
    const opened = vi.fn();
    const off = onShortcut("palette.open", opened);
    const got: Array<string | null> = [];
    const stop = recordNextCombo((c) => got.push(c));
    try {
      expect(dispatchCombo("F1")).toBe(true);
      expect(opened).not.toHaveBeenCalled();
      expect(got).toEqual(["F1"]);
    } finally {
      stop();
    }
    dispatchCombo("F1");
    expect(opened).toHaveBeenCalledOnce();
    off();
  });
});

describe("docs/ux/overview.md#keyboard-shortcuts", () => {
  const doc = readFileSync(resolve(__dirname, "../../../../docs/ux/overview.md"), "utf8");
  const section = doc.slice(doc.indexOf("## Keyboard shortcuts"), doc.indexOf("\n## ", doc.indexOf("## Keyboard shortcuts") + 5));
  const rows = section
    .split("\n")
    .filter((l) => l.startsWith("| `"))
    .map((l) => l.split("|").map((c) => c.trim()));

  it("lists every rebindable action with its Windows and Linux default, marked rebindable", () => {
    for (const a of SHORTCUTS) {
      const row = rows.find((r) => r[2]?.startsWith(a.label));
      expect(row, `${a.label} is missing from the table`).toBeDefined();
      expect(row?.[1]).toBe(`\`${comboText(defaultBinding(a.id), false)}\``);
      expect(row?.[3]).toMatch(/^Rebindable/);
    }
  });

  it("marks nothing else rebindable", () => {
    const labels = SHORTCUTS.map((a) => a.label);
    for (const r of rows.filter((r) => r[3]?.startsWith("Rebindable"))) expect(labels.some((l) => r[2]?.startsWith(l))).toBe(true);
  });
});
