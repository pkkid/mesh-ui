/**
 * The auto-updater (docs/platform/build-and-release.md#auto-update):
 * electron-updater with the GitHub provider, behind the small
 * `UpdaterBackend` interface so the schedule and states can be tested with a
 * fake (updater.test.ts).
 *
 * - Runs only for install kinds mac, nsis and appimage. dev, deb, rpm and
 *   portable report `unsupported` and never load electron-updater.
 * - Checks 10 s after it is created (at launch), then every 6 h with up to
 *   15 min of jitter, while `autoUpdate` is on. A manual check (Check now,
 *   `app.update.check`) runs whatever the switch says.
 * - Downloads in the background. When the download is `ready` it emits
 *   `update.changed`; nothing installs or restarts until `install()`
 *   (`app.update.install`) calls `quitAndInstall`. Install on quit is off.
 * - `updateChannel: beta` sets `allowPrerelease` before each check: with the
 *   GitHub provider a beta is a GitHub pre-release with `beta*.yml`.
 * - Errors become state `error` with one short line, never a throw or a dialog.
 * - macOS installs through Squirrel.Mac, which only accepts a new build that
 *   meets the running app's designated requirement. An ad-hoc signed
 *   (unsigned) build's requirement is its own cdhash, so no new build ever
 *   passes. Unless the app is signed with a Developer ID (`selfInstall`),
 *   the updater only checks: a newer version is state `available` and About
 *   links to the GitHub release to download by hand. Nothing is downloaded,
 *   so there is no failing install to repeat.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { CommandError } from "../core/errors";
import type { AppSettings, InstallKind, UpdateState, UpdateStatus } from "../core/model";
import type { HostActions } from "../core/spec";

/** The slice of electron-updater's `AppUpdater` this module uses. */
export interface UpdaterBackend {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available" | "update-not-available" | "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "download-progress", listener: (p: { percent: number }) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  /** With `autoDownload`, the result carries the background download, which rejects (after `error`) when it fails. */
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type UpdaterDeps = {
  install: InstallKind;
  /** App settings (`autoUpdate`, `updateChannel`), read before each check and for each status. */
  settings(): Promise<Pick<AppSettings, "autoUpdate" | "updateChannel">>;
  /** Called with the new status whenever it changes (the host sends `update.changed`). */
  onChange(status: UpdateStatus): void;
  /** Loads electron-updater; only called for install kinds that update. */
  load(): Promise<UpdaterBackend>;
  /**
   * Whether this copy can install an update itself. Default true; macOS
   * passes `macSignedForUpdates`. False: check only, report `available`.
   */
  selfInstall?: () => Promise<boolean>;
  /** A fixed status for headless screenshots (`previewUpdate`); no checks run. */
  preview?: Omit<UpdateStatus, "channel"> | null;
  timers?: Timers;
  now?: () => number;
  /** 0..1, for the jitter. */
  random?: () => number;
};

export type Updater = NonNullable<HostActions["update"]> & {
  /** Stops the schedule (tests, quitting). */
  stop(): void;
};

export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const JITTER_MS = 15 * 60 * 1000;

/** Install kinds that update themselves. */
export const SELF_UPDATING: ReadonlySet<InstallKind> = new Set(["mac", "nsis", "appimage"]);

/** One short line for an updater error; electron-updater messages can carry whole HTTP responses. */
export function shortError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|net::ERR_/.test(raw)) return "Could not reach GitHub.";
  if (/\b404\b/.test(raw)) return "No update information found on GitHub.";
  const line = (raw.split("\n")[0] ?? "").trim() || "Update check failed.";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

type Inner = { state: Exclude<UpdateState, "off" | "unsupported">; version: string | null; checkedAt: string | null; progress: number | null; error: string | null };

export function createUpdater(deps: UpdaterDeps): Updater {
  const timers: Timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const supported = SELF_UPDATING.has(deps.install) && !deps.preview;

  let inner: Inner = { state: "idle", version: null, checkedAt: null, progress: null, error: null };
  let backend: Promise<UpdaterBackend | null> | null = null;
  let timer: unknown = null;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let downloads = true;

  /** The status for `at` (the state now, or the one an event was raised for). */
  const status = async (at: Inner = inner): Promise<UpdateStatus> => {
    const { autoUpdate, updateChannel: channel } = await deps.settings();
    if (deps.preview) return { ...deps.preview, channel };
    if (!supported) return { state: "unsupported", version: null, channel, checkedAt: null, progress: null, error: null };
    const state = at.state === "idle" && !autoUpdate ? "off" : at.state;
    return { ...at, state, channel };
  };

  const set = (patch: Partial<Inner>) => {
    inner = { ...inner, ...patch };
    void status(inner).then(deps.onChange, () => {});
  };

  const fail = (err: unknown) => set({ state: "error", progress: null, error: shortError(err), checkedAt: new Date(now()).toISOString() });

  const getBackend = (): Promise<UpdaterBackend | null> => {
    backend ??= (async () => {
      downloads = deps.selfInstall ? await deps.selfInstall().catch(() => false) : true;
      return deps.load();
    })().then(
      (u) => {
        u.autoDownload = downloads;
        u.autoInstallOnAppQuit = false;
        u.on("checking-for-update", () => set({ state: "checking", error: null }));
        u.on("update-available", (info) =>
          set(
            downloads
              ? { state: "downloading", version: info.version, progress: 0, error: null }
              : { state: "available", version: info.version, progress: null, error: null, checkedAt: new Date(now()).toISOString() },
          ),
        );
        u.on("update-not-available", () => set({ state: "idle", version: null, progress: null, error: null, checkedAt: new Date(now()).toISOString() }));
        u.on("download-progress", (p) => {
          const progress = Math.max(0, Math.min(1, Math.floor(p.percent) / 100));
          // Whole percents only, so a fast download does not flood the window with events.
          if (inner.state === "downloading" && progress !== inner.progress) set({ progress });
        });
        u.on("update-downloaded", (info) => set({ state: "ready", version: info.version, progress: null, error: null, checkedAt: new Date(now()).toISOString() }));
        u.on("error", fail);
        return u;
      },
      (err: unknown) => {
        fail(err);
        backend = null;
        return null;
      },
    );
    return backend;
  };

  /** One check, unless one is running or an update is already downloaded. */
  const runCheck = (): Promise<void> => {
    if (!supported || inner.state === "ready") return Promise.resolve();
    inFlight ??= (async () => {
      try {
        const u = await getBackend();
        if (!u) return;
        const { updateChannel } = await deps.settings();
        u.allowPrerelease = updateChannel === "beta";
        const result = await u.checkForUpdates();
        // The download goes on in the background; its failure already arrived as `error`.
        result?.downloadPromise?.catch(() => {});
      } catch (err) {
        fail(err);
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = timers.setTimeout(() => void tick(), ms);
  };

  const tick = async () => {
    try {
      const { autoUpdate } = await deps.settings();
      if (autoUpdate) await runCheck();
    } catch (err) {
      fail(err);
    }
    schedule(CHECK_EVERY_MS + Math.round((random() * 2 - 1) * JITTER_MS));
  };

  if (supported) schedule(FIRST_CHECK_MS);

  return {
    status: () => status(),
    async check() {
      // Starts the check and answers once electron-updater has said what it found
      // (or failed); the download carries on in the background.
      await runCheck();
      return status();
    },
    async install() {
      const u = supported && downloads && inner.state === "ready" ? await getBackend() : null;
      if (!u) throw new CommandError("bad_params", "No update is ready to install.");
      u.quitAndInstall(true, true);
    },
    stop() {
      stopped = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

/** electron-updater's shared updater (GitHub provider from resources/app-update.yml). */
export async function loadElectronUpdater(): Promise<UpdaterBackend> {
  const mod = (await import("electron-updater")) as unknown as { autoUpdater?: UpdaterBackend; default?: { autoUpdater: UpdaterBackend } };
  const u = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!u) throw new Error("electron-updater did not load.");
  return u;
}

/** True when `codesign -dv` output shows a Developer ID signature (not ad-hoc). */
export function isDeveloperIdSigned(codesignOutput: string): boolean {
  return /^Authority=Developer ID Application:/m.test(codesignOutput) && !/^Signature=adhoc$/m.test(codesignOutput);
}

/**
 * Whether the running macOS app is signed with a Developer ID, so
 * Squirrel.Mac will accept the next build. Reads `codesign -dv` of the app
 * bundle; any failure counts as unsigned (check only, download by hand).
 */
export function macSignedForUpdates(exePath: string, run: typeof execFile = execFile): Promise<boolean> {
  // macOS only, so POSIX paths: .../Mesh UI.app/Contents/MacOS/Mesh UI -> .../Mesh UI.app
  const bundle = path.posix.dirname(path.posix.dirname(path.posix.dirname(exePath)));
  return new Promise((resolve) => {
    // codesign writes its details to stderr.
    run("/usr/bin/codesign", ["-dv", "--verbose=2", bundle], (err, stdout, stderr) => resolve(!err && isDeveloperIdSigned(`${stdout}\n${stderr}`)));
  });
}

const PREVIEW: Record<string, { install?: InstallKind; status: Omit<UpdateStatus, "channel"> }> = {
  idle: { status: { state: "idle", version: null, checkedAt: "1970-01-01T00:00:00.000Z", progress: null, error: null } },
  off: { status: { state: "off", version: null, checkedAt: "1970-01-01T00:00:00.000Z", progress: null, error: null } },
  available: { status: { state: "available", version: "0.6.1", checkedAt: "1970-01-01T00:00:00.000Z", progress: null, error: null } },
  checking: { status: { state: "checking", version: null, checkedAt: null, progress: null, error: null } },
  downloading: { status: { state: "downloading", version: "0.6.1", checkedAt: "1970-01-01T00:00:00.000Z", progress: 0.42, error: null } },
  ready: { status: { state: "ready", version: "0.6.1", checkedAt: "1970-01-01T00:00:00.000Z", progress: null, error: null } },
  error: { status: { state: "error", version: null, checkedAt: "1970-01-01T00:00:00.000Z", progress: null, error: "Could not reach GitHub." } },
  deb: { install: "deb", status: { state: "unsupported", version: null, checkedAt: null, progress: null, error: null } },
  rpm: { install: "rpm", status: { state: "unsupported", version: null, checkedAt: null, progress: null, error: null } },
  portable: { install: "portable", status: { state: "unsupported", version: null, checkedAt: null, progress: null, error: null } },
};

/**
 * `MESH_UI_UPDATE_STATE` for headless screenshots (`pnpm ui:shot`): an update
 * state (`idle`, `off`, `checking`, `available`, `downloading`, `ready`, `error`) or an
 * install kind that cannot update (`deb`, `rpm`, `portable`). Only for
 * unpackaged headless runs; null otherwise, so a release build ignores it.
 */
export function previewUpdate(env: Readonly<Record<string, string | undefined>>, packaged: boolean, now: () => number = Date.now): { install?: InstallKind; status: Omit<UpdateStatus, "channel"> } | null {
  if (packaged || env.MESH_UI_HEADLESS !== "1") return null;
  const preview = env.MESH_UI_UPDATE_STATE ? PREVIEW[env.MESH_UI_UPDATE_STATE] : undefined;
  if (!preview) return null;
  // Checked 20 minutes before now, so the screenshot reads "checked 20 min ago".
  const checkedAt = preview.status.checkedAt ? new Date(now() - 20 * 60 * 1000).toISOString() : null;
  return { ...preview, status: { ...preview.status, checkedAt } };
}
