import { describe, expect, it } from "vitest";
import { createTrayMode, linuxTrayAvailable, type RunText, type TrayDeps } from "./tray";

function fakeHost(over: Partial<TrayDeps> = {}) {
  const log: string[] = [];
  let menu: { open(): void; quit(): void } | null = null;
  const deps: TrayDeps = {
    platform: "linux",
    available: async () => true,
    create: (m) => {
      menu = m;
      log.push("create");
      return { destroy: () => void log.push("destroy") };
    },
    open: () => void log.push("open"),
    quit: () => void log.push("quit"),
    notice: () => void log.push("notice"),
    ...over,
  };
  const win = { hide: () => void log.push("hide") };
  return { mode: createTrayMode(deps), log, win, menu: () => menu };
}

describe("tray mode", () => {
  it("off: close and minimize behave as before and no icon is made", async () => {
    const { mode, log, win } = fakeHost();
    expect(mode.close(win)).toBe(false);
    expect(mode.minimize(win)).toBe(false);
    expect(await mode.apply(false)).toBe(false);
    expect(log).toEqual([]);
  });

  it("on: closing hides the window, the tray opens it again, and Quit really exits", async () => {
    const { mode, log, win, menu } = fakeHost();
    expect(await mode.apply(true)).toBe(true);
    expect(await mode.apply(true)).toBe(true);
    expect(log).toEqual(["create"]);

    // Close hides, with the notice only the first time.
    expect(mode.close(win)).toBe(true);
    expect(mode.minimize(win)).toBe(true);
    expect(log).toEqual(["create", "hide", "notice", "hide"]);

    menu()?.open();
    expect(log.at(-1)).toBe("open");

    // Quit from the tray: the close that follows goes through.
    menu()?.quit();
    expect(log.at(-1)).toBe("quit");
    expect(mode.active()).toBe(false);
    expect(mode.close(win)).toBe(false);
  });

  it("a real quit from elsewhere (Cmd+Q, update restart) lets the window close", async () => {
    const { mode, log, win } = fakeHost();
    await mode.apply(true);
    mode.quitting();
    expect(mode.close(win)).toBe(false);
    expect(log).toEqual(["create", "destroy"]);
    // Nothing comes back while quitting.
    expect(await mode.apply(true)).toBe(false);
  });

  it("turning it off removes the icon and closing quits again", async () => {
    const { mode, log, win } = fakeHost();
    await mode.apply(true);
    expect(await mode.apply(false)).toBe(false);
    expect(mode.close(win)).toBe(false);
    expect(log).toEqual(["create", "destroy"]);
  });

  it("never hides to a tray that is not there", async () => {
    const { mode, log, win } = fakeHost({ available: async () => false });
    expect(await mode.apply(true)).toBe(false);
    expect(mode.close(win)).toBe(false);
    const broken = fakeHost({
      create: () => {
        throw new Error("no tray");
      },
    });
    expect(await broken.mode.apply(true)).toBe(false);
    expect(broken.mode.close(broken.win)).toBe(false);
    expect(log).toEqual([]);
  });

  it("an apply that finishes after a later one does nothing", async () => {
    let release: (ok: boolean) => void = () => {};
    const { mode, log } = fakeHost({ available: () => new Promise((r) => (release = r)) });
    const first = mode.apply(true);
    await mode.apply(false);
    release(true);
    expect(await first).toBe(false);
    expect(log).toEqual([]);
  });

  it("keeps the normal minimize to the Dock on macOS", async () => {
    const { mode, log, win } = fakeHost({ platform: "darwin" });
    await mode.apply(true);
    expect(mode.minimize(win)).toBe(false);
    expect(mode.close(win)).toBe(true);
    expect(log).toEqual(["create", "hide", "notice"]);
  });
});

describe("linuxTrayAvailable", () => {
  const runner = (answers: Record<string, string | null>): { run: RunText; calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      run: async (cmd, args) => {
        const name = args.at(-1) ?? "";
        calls.push(`${cmd} ${name}`);
        return answers[`${cmd} ${name}`] ?? null;
      },
    };
  };

  it("finds a StatusNotifier watcher with gdbus", async () => {
    expect(await linuxTrayAvailable(runner({ "gdbus org.kde.StatusNotifierWatcher": "(true,)\n" }).run)).toBe(true);
    const r = runner({ "gdbus org.kde.StatusNotifierWatcher": "(false,)\n", "gdbus org.freedesktop.StatusNotifierWatcher": "(false,)\n" });
    expect(await linuxTrayAvailable(r.run)).toBe(false);
    expect(r.calls).toEqual(["gdbus org.kde.StatusNotifierWatcher", "gdbus org.freedesktop.StatusNotifierWatcher"]);
  });

  it("falls back to dbus-send, and answers false with neither tool", async () => {
    expect(await linuxTrayAvailable(runner({ "dbus-send string:org.kde.StatusNotifierWatcher": "method return\n   boolean true\n" }).run)).toBe(true);
    expect(await linuxTrayAvailable(runner({}).run)).toBe(false);
  });
});
