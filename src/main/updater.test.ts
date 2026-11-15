import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine } from "../core/engine";
import { createDemoBackend } from "../core/demo";
import type { AppSettings, InstallKind, UpdateStatus } from "../core/model";
import { CHECK_EVERY_MS, createUpdater, FIRST_CHECK_MS, isDeveloperIdSigned, JITTER_MS, macSignedForUpdates, previewUpdate, shortError, type Updater, type UpdaterBackend } from "./updater";

type Listener = (arg?: never) => void;

/** A stand-in for electron-updater's autoUpdater. `next` decides what a check finds. */
class FakeBackend implements UpdaterBackend {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  checks: { allowPrerelease: boolean }[] = [];
  installs: [boolean | undefined, boolean | undefined][] = [];
  next: { found: string | null; downloadError?: Error } | { error: Error } = { found: null };
  private listeners = new Map<string, Listener[]>();

  on(event: string, listener: (arg: never) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener as Listener]);
    return this;
  }
  fire(event: string, arg?: unknown) {
    for (const l of this.listeners.get(event) ?? []) (l as (a: unknown) => void)(arg);
  }
  async checkForUpdates() {
    this.checks.push({ allowPrerelease: this.allowPrerelease });
    this.fire("checking-for-update");
    const next = this.next;
    if ("error" in next) {
      this.fire("error", next.error);
      throw next.error;
    }
    if (!next.found) {
      this.fire("update-not-available", { version: "0.6.0" });
      return null;
    }
    this.fire("update-available", { version: next.found });
    const failure = next.downloadError;
    // Like electron-updater: the download emits `error`, then its promise rejects.
    const downloadPromise = failure
      ? Promise.resolve().then(() => {
          this.fire("error", failure);
          throw failure;
        })
      : null;
    return { downloadPromise };
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.installs.push([isSilent, isForceRunAfter]);
  }
}

let settings: Pick<AppSettings, "autoUpdate" | "updateChannel">;
let fake: FakeBackend;
let events: UpdateStatus[];
let loads: number;
let updater: Updater | null;

function make(install: InstallKind = "mac", extra: Partial<Parameters<typeof createUpdater>[0]> = {}): Updater {
  updater = createUpdater({
    install,
    settings: async () => settings,
    onChange: (s) => events.push(s),
    load: async () => {
      loads += 1;
      return fake;
    },
    random: () => 0.5, // no jitter
    ...extra,
  });
  return updater;
}

/** Runs timers and the promise chains they start. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
  settings = { autoUpdate: true, updateChannel: "latest" };
  fake = new FakeBackend();
  events = [];
  loads = 0;
  updater = null;
});

afterEach(() => {
  updater?.stop();
  vi.useRealTimers();
});

describe("updater schedule", () => {
  it("checks 10 s after launch, then every 6 h", async () => {
    make();
    await advance(FIRST_CHECK_MS - 1);
    expect(fake.checks).toHaveLength(0);
    await advance(1);
    expect(fake.checks).toHaveLength(1);
    await advance(CHECK_EVERY_MS - 1);
    expect(fake.checks).toHaveLength(1);
    await advance(1);
    expect(fake.checks).toHaveLength(2);
    await advance(CHECK_EVERY_MS);
    expect(fake.checks).toHaveLength(3);
  });

  it("spreads the 6 h checks by up to 15 minutes of jitter", async () => {
    make("mac", { random: () => 1 });
    await advance(FIRST_CHECK_MS);
    expect(fake.checks).toHaveLength(1);
    await advance(CHECK_EVERY_MS + JITTER_MS - 1);
    expect(fake.checks).toHaveLength(1);
    await advance(1);
    expect(fake.checks).toHaveLength(2);
  });

  it("makes no scheduled checks with autoUpdate off, but Check now still runs", async () => {
    settings = { autoUpdate: false, updateChannel: "latest" };
    const u = make();
    await advance(FIRST_CHECK_MS + 3 * CHECK_EVERY_MS);
    expect(fake.checks).toHaveLength(0);
    expect((await u.status()).state).toBe("off");

    const after = await u.check();
    expect(fake.checks).toHaveLength(1);
    expect(after.checkedAt).not.toBeNull();
  });

  it("picks the schedule back up when autoUpdate is turned on again", async () => {
    settings = { autoUpdate: false, updateChannel: "latest" };
    make();
    await advance(FIRST_CHECK_MS);
    settings = { autoUpdate: true, updateChannel: "latest" };
    await advance(CHECK_EVERY_MS);
    expect(fake.checks).toHaveLength(1);
  });

  it.each(["dev", "deb", "rpm", "portable"] as const)("never checks or loads electron-updater for %s", async (install) => {
    const u = make(install);
    await advance(FIRST_CHECK_MS + 2 * CHECK_EVERY_MS);
    const manual = await u.check();
    expect(fake.checks).toHaveLength(0);
    expect(loads).toBe(0);
    expect(manual).toMatchObject({ state: "unsupported", version: null });
    await expect(u.install()).rejects.toMatchObject({ code: "bad_params" });
  });

  it.each(["mac", "nsis", "appimage"] as const)("checks for %s", async (install) => {
    make(install);
    await advance(FIRST_CHECK_MS);
    expect(fake.checks).toHaveLength(1);
  });

  it("stop() ends the schedule", async () => {
    const u = make();
    u.stop();
    await advance(FIRST_CHECK_MS + CHECK_EVERY_MS);
    expect(fake.checks).toHaveLength(0);
  });
});

describe("updater channel", () => {
  it("turns on pre-releases for the beta channel, read before each check", async () => {
    const u = make();
    await u.check();
    settings = { autoUpdate: true, updateChannel: "beta" };
    await u.check();
    settings = { autoUpdate: true, updateChannel: "latest" };
    await u.check();
    expect(fake.checks.map((c) => c.allowPrerelease)).toEqual([false, true, false]);
    expect((await u.status()).channel).toBe("latest");
  });

  it("downloads in the background and never installs on quit", async () => {
    const u = make();
    await u.check();
    expect(fake.autoDownload).toBe(true);
    expect(fake.autoInstallOnAppQuit).toBe(false);
  });
});

describe("updater states", () => {
  it("goes idle with a check time when up to date", async () => {
    const u = make();
    expect(await u.status()).toEqual({ state: "idle", version: null, channel: "latest", checkedAt: null, progress: null, error: null });
    const s = await u.check();
    expect(s).toMatchObject({ state: "idle", checkedAt: "2026-11-14T12:00:00.000Z" });
  });

  it("downloads, reports progress, and on ready emits update.changed without installing", async () => {
    fake.next = { found: "0.6.1" };
    const u = make();
    const s = await u.check();
    expect(s).toMatchObject({ state: "downloading", version: "0.6.1", progress: 0 });

    fake.fire("download-progress", { percent: 42.7 });
    fake.fire("download-progress", { percent: 42.9 }); // same whole percent: no new event
    fake.fire("update-downloaded", { version: "0.6.1" });
    await advance(0);

    expect(events.map((e) => e.state)).toEqual(["checking", "downloading", "downloading", "ready"]);
    expect(events[2]?.progress).toBe(0.42);
    expect(events.at(-1)).toMatchObject({ state: "ready", version: "0.6.1", progress: null });
    expect(fake.installs).toHaveLength(0);

    // A ready update is never installed by the schedule, and no further check runs.
    await advance(FIRST_CHECK_MS + 3 * CHECK_EVERY_MS);
    expect(fake.installs).toHaveLength(0);
    expect(fake.checks).toHaveLength(1);
  });

  it("installs only through app.update.install", async () => {
    fake.next = { found: "0.6.1" };
    const u = make();
    const engine = createEngine({ backend: createDemoBackend(), host: { version: "0.6.0", electron: null, configDir: null, keychainName: null, install: "mac", actions: { update: u } } });

    const early = await engine.execute("app.update.install", {});
    expect(early).toMatchObject({ ok: false, error: { code: "bad_params" } });

    await u.check();
    fake.fire("update-downloaded", { version: "0.6.1" });
    await advance(0);
    const info = await engine.execute<{ update: UpdateStatus }>("app.info", {});
    expect(info.ok && info.result.update.state).toBe("ready");
    expect(fake.installs).toHaveLength(0);

    const res = await engine.execute("app.update.install", {});
    expect(res.ok).toBe(true);
    expect(fake.installs).toEqual([[true, true]]);
  });

  it("reports an error as state error with one short line, never a throw", async () => {
    fake.next = { error: new Error("net::ERR_INTERNET_DISCONNECTED") };
    const u = make();
    await advance(FIRST_CHECK_MS);
    const s = await u.status();
    expect(s).toMatchObject({ state: "error", error: "Could not reach GitHub." });
    expect(events.at(-1)?.state).toBe("error");

    await expect(u.check()).resolves.toMatchObject({ state: "error" });

    // The next good check clears it.
    fake.next = { found: null };
    await expect(u.check()).resolves.toMatchObject({ state: "idle", error: null });
  });

  it("handles a failed background download as state error, with no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      fake.next = { found: "0.6.1", downloadError: new Error("sha512 checksum mismatch") };
      const u = make();
      await u.check();
      await advance(0);
      expect(await u.status()).toMatchObject({ state: "error", error: "sha512 checksum mismatch" });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("reports a failed load of electron-updater as an error", async () => {
    const u = make("nsis", {
      load: async () => {
        throw new Error("Cannot find module 'electron-updater'");
      },
    });
    await expect(u.check()).resolves.toMatchObject({ state: "error", error: "Cannot find module 'electron-updater'" });
  });

  it("runs one check at a time", async () => {
    const u = make();
    await Promise.all([u.check(), u.check(), u.check()]);
    expect(fake.checks).toHaveLength(1);
  });
});

describe("unsigned macOS build (Squirrel.Mac cannot install it)", () => {
  it("checks on schedule but never downloads: a newer version is available, with no error loop", async () => {
    fake.next = { found: "0.6.1" };
    const u = make("mac", { selfInstall: async () => false });
    await advance(FIRST_CHECK_MS);
    expect(fake.autoDownload).toBe(false);
    expect(await u.status()).toMatchObject({ state: "available", version: "0.6.1", progress: null, error: null });
    expect(events.at(-1)?.state).toBe("available");

    // Later checks keep reporting it (a newer one can replace it) and never fail or install.
    fake.next = { found: "0.6.2" };
    await advance(2 * CHECK_EVERY_MS);
    expect(fake.checks).toHaveLength(3);
    expect(await u.status()).toMatchObject({ state: "available", version: "0.6.2" });
    expect(events.some((e) => e.state === "error" || e.state === "downloading" || e.state === "ready")).toBe(false);

    await expect(u.install()).rejects.toMatchObject({ code: "bad_params" });
    expect(fake.installs).toHaveLength(0);
  });

  it("still goes idle when up to date", async () => {
    const u = make("mac", { selfInstall: async () => false });
    await expect(u.check()).resolves.toMatchObject({ state: "idle" });
  });

  it("counts a failing signature check as unsigned", async () => {
    fake.next = { found: "0.6.1" };
    const u = make("mac", {
      selfInstall: async () => {
        throw new Error("codesign missing");
      },
    });
    await expect(u.check()).resolves.toMatchObject({ state: "available" });
  });

  it("downloads and installs as usual when signed with a Developer ID", async () => {
    fake.next = { found: "0.6.1" };
    const u = make("mac", { selfInstall: async () => true });
    await expect(u.check()).resolves.toMatchObject({ state: "downloading" });
    expect(fake.autoDownload).toBe(true);
    fake.fire("update-downloaded", { version: "0.6.1" });
    await advance(0);
    await u.install();
    expect(fake.installs).toHaveLength(1);
  });

  it("tells a Developer ID signature from an ad-hoc one", () => {
    const devId = "Executable=/Applications/Mesh UI.app/Contents/MacOS/Mesh UI\nIdentifier=io.github.pkkid.meshui\nAuthority=Developer ID Application: Example (ABCDE12345)\nAuthority=Developer ID Certification Authority\nTeamIdentifier=ABCDE12345";
    const adhoc = "Executable=/Applications/Mesh UI.app/Contents/MacOS/Mesh UI\nIdentifier=io.github.pkkid.meshui\nSignature=adhoc\nTeamIdentifier=not set";
    expect(isDeveloperIdSigned(devId)).toBe(true);
    expect(isDeveloperIdSigned(adhoc)).toBe(false);
    expect(isDeveloperIdSigned("code object is not signed at all")).toBe(false);
  });

  it("runs codesign on the app bundle and treats a failure as unsigned", async () => {
    const calls: string[][] = [];
    const run = ((file: string, args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      calls.push([file, ...args]);
      cb(null, "", "Authority=Developer ID Application: Example (ABCDE12345)\n");
    }) as unknown as Parameters<typeof macSignedForUpdates>[1];
    await expect(macSignedForUpdates("/Applications/Mesh UI.app/Contents/MacOS/Mesh UI", run)).resolves.toBe(true);
    expect(calls[0]).toEqual(["/usr/bin/codesign", "-dv", "--verbose=2", "/Applications/Mesh UI.app"]);

    const failing = ((_f: string, _a: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) =>
      cb(new Error("exit 1"), "", "")) as unknown as Parameters<typeof macSignedForUpdates>[1];
    await expect(macSignedForUpdates("/Applications/Mesh UI.app/Contents/MacOS/Mesh UI", failing)).resolves.toBe(false);
  });
});

describe("shortError", () => {
  it("keeps one line of at most 120 characters", () => {
    expect(shortError(new Error(`HttpError: 500\n${"x".repeat(500)}`))).toBe("HttpError: 500");
    expect(shortError(new Error("y".repeat(300)))).toHaveLength(120);
    expect(shortError(new Error("getaddrinfo ENOTFOUND github.com"))).toBe("Could not reach GitHub.");
    expect(shortError(new Error("HttpError: 404 Not Found"))).toBe("No update information found on GitHub.");
    expect(shortError("")).toBe("Update check failed.");
  });
});

describe("previewUpdate (MESH_UI_UPDATE_STATE)", () => {
  it("only works in unpackaged headless runs", () => {
    expect(previewUpdate({ MESH_UI_HEADLESS: "1", MESH_UI_UPDATE_STATE: "ready" }, false)?.status.state).toBe("ready");
    expect(previewUpdate({ MESH_UI_HEADLESS: "1", MESH_UI_UPDATE_STATE: "ready" }, true)).toBeNull();
    expect(previewUpdate({ MESH_UI_UPDATE_STATE: "ready" }, false)).toBeNull();
    expect(previewUpdate({ MESH_UI_HEADLESS: "1", MESH_UI_UPDATE_STATE: "nope" }, false)).toBeNull();
  });

  it("gives an install kind for package-manager states and never checks", async () => {
    const p = previewUpdate({ MESH_UI_HEADLESS: "1", MESH_UI_UPDATE_STATE: "deb" }, false);
    expect(p).toMatchObject({ install: "deb", status: { state: "unsupported" } });
    const u = make("mac", { preview: previewUpdate({ MESH_UI_HEADLESS: "1", MESH_UI_UPDATE_STATE: "downloading" }, false)?.status });
    await advance(FIRST_CHECK_MS);
    expect(fake.checks).toHaveLength(0);
    expect(await u.status()).toMatchObject({ state: "downloading", progress: 0.42, channel: "latest" });
  });
});
