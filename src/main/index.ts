/**
 * The Electron host. It builds the engine (src/core) with a backend and the
 * `safeStorage` SecretStore, exposes it to the window over src/main/ipc.ts,
 * and keeps every web contents locked down. With `--cli` it creates no
 * window and hands the argv after the flag to `cliMain` with the Electron
 * CLI host, which builds the same engines (docs/architecture/cli.md#how-the-cli-runs).
 *
 * Backends:
 * - live: the eero backend against api-user.e2ro.com.
 * - demo: `MESH_UI_DEMO=1` or `--demo`, in-memory fixtures, no secrets.
 * - fake (dev builds only): `MESH_UI_FAKE=1` points the eero backend at the
 *   local fake eero server (`MESH_UI_FAKE_ORIGIN`, or one started here from
 *   test/fake-eero) with a throwaway config dir. Release builds drop this
 *   code. The CLI's `--fake` needs an unpackaged build and a loopback
 *   `MESH_UI_FAKE_ORIGIN`, and never uses the saved session.
 *
 * `MESH_UI_HEADLESS=1` (scripts/ui-shot.mjs) renders the window offscreen and
 * never shows it, so agents can drive and screenshot the UI without a window
 * on the desktop. It also drops the native window-controls overlay, which
 * crashes Electron under `--ozone-platform=headless`. Inert unless set.
 * Headless runs may also set `MESH_UI_SAVE_DIR`: `window.mesh.saveFile` then
 * writes there under the suggested name instead of showing the save dialog,
 * so `ui:shot` can prove an export writes a file. Ignored with a window.
 * Headless runs never show desktop alerts (`mesh:notify` is not registered).
 */

import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Notification, nativeTheme, safeStorage, session, shell } from "electron";
import { version as appVersion } from "../../package.json";
import type { Backend, SecretStore } from "../core/backend";
import { createDemoBackend, DEMO_SETTINGS } from "../core/demo";
import { createEeroBackend } from "../core/eero/backend";
import { createEngine, type Engine, fileSettings, memorySettings } from "../core/engine";
import type { SettingsStore, Surface } from "../core/spec";
import { type CliHost, cliMain, nodeHost } from "../cli";
import { IPC } from "../shared/types";
import { registerIpc, SAVE_EXTS, type SaveFileHost } from "./ipc";
import type { NotifyHost } from "./notify";
import { configPaths, resolveConfigDir } from "./paths";
import { createSecretStore, keychainName } from "./secret-store";

/** Matches --titlebar-height in the renderer's index.css. */
const TITLEBAR_HEIGHT = 44;
/**
 * The Windows and Linux controls overlay stops 1px short of the titlebar so
 * the header's 1px bottom border (the last row of the 44px strip) is not
 * painted over and runs to the window's right edge.
 */
const OVERLAY_HEIGHT = TITLEBAR_HEIGHT - 1;

const argv = process.argv;
const cliIndex = argv.indexOf("--cli");
const isCli = cliIndex !== -1;
const isDemo = process.env.MESH_UI_DEMO === "1" || (!isCli && argv.includes("--demo"));
const isFake = import.meta.env.DEV && !isCli && process.env.MESH_UI_FAKE === "1";
const isHeadless = !isCli && process.env.MESH_UI_HEADLESS === "1";

let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Paths. Must run before the app is ready.

app.setName("Mesh UI");
const userDataSwitch = app.commandLine.getSwitchValue("user-data-dir");
const configDir =
  isFake && !userDataSwitch && !process.env.MESH_UI_USER_DATA_DIR
    ? mkdtempSync(path.join(os.tmpdir(), "mesh-ui-fake-"))
    : resolveConfigDir({ appData: app.getPath("appData"), userDataSwitch, env: process.env });
const paths = configPaths(configDir);
app.setPath("userData", configDir);
// The CLI shares session.json, settings.json and the safeStorage key, but not
// Chromium's profile files, so it can run next to an open window.
if (isCli) app.setPath("sessionData", paths.cliSessionData);

// ---------------------------------------------------------------------------
// Engine

const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

/** Dev only: origin of the fake eero server, starting it when none is given. */
async function fakeOrigin(): Promise<string | undefined> {
  if (!import.meta.env.DEV || !isFake) return undefined;
  const given = process.env.MESH_UI_FAKE_ORIGIN;
  if (given) {
    if (!LOCAL_ORIGIN.test(given)) throw new Error("MESH_UI_FAKE_ORIGIN must be a loopback http origin, e.g. http://127.0.0.1:4010.");
    return given;
  }
  // A glob, not an import, so release builds never resolve or bundle it.
  const loaders = import.meta.glob<typeof import("../../test/fake-eero/server")>("../../test/fake-eero/server.ts");
  const load = Object.values(loaders)[0];
  if (!load) throw new Error("MESH_UI_FAKE=1 needs test/fake-eero/server.ts, or set MESH_UI_FAKE_ORIGIN.");
  const origin = await (await load()).createFakeEero().listen();
  console.log(`[mesh-ui] fake eero server at ${origin}, config in ${configDir}`);
  return origin;
}

type EngineMode = { mode: "demo" } | { mode: "live" } | { mode: "fake"; origin: string; secrets: SecretStore };

/** The engine for any surface. Only live mode reads or writes the saved session. */
async function buildEngine(m: EngineMode, surface: Surface, dir: string, settings: SettingsStore): Promise<Engine> {
  let backend: Backend;
  if (m.mode === "demo") {
    backend = createDemoBackend();
  } else {
    const secrets = m.mode === "fake" ? m.secrets : createSecretStore({ file: configPaths(dir).session, safeStorage, platform: process.platform });
    const userAgent = (await settings.get()).userAgent;
    backend = createEeroBackend({ secrets, userAgent, ...(m.mode === "fake" ? { origin: m.origin } : {}) });
  }
  return createEngine({
    backend,
    settings,
    surface,
    host: {
      version: appVersion,
      electron: process.versions.electron ?? null,
      configDir: dir,
      keychainName: m.mode === "live" ? keychainName(safeStorage, process.platform) : null,
    },
  });
}

async function createAppEngine(): Promise<Engine> {
  // Demo never touches the session or the saved settings.
  if (isDemo) return buildEngine({ mode: "demo" }, "ui", configDir, memorySettings(DEMO_SETTINGS));
  const settings = fileSettings(paths.settings);
  const origin = await fakeOrigin();
  if (origin) {
    // The fake config dir is a throwaway one, so its session file is too.
    const secrets = createSecretStore({ file: paths.session, safeStorage, platform: process.platform });
    return buildEngine({ mode: "fake", origin, secrets }, "ui", configDir, settings);
  }
  return buildEngine({ mode: "live" }, "ui", configDir, settings);
}

/** In-memory session for `--fake` without a throwaway config dir. */
function memorySecrets(): SecretStore {
  let token: string | null = null;
  return {
    load: async () => token,
    save: async (t) => {
      token = t;
      return "memory";
    },
    clear: async () => {
      token = null;
    },
    storage: async () => "memory",
  };
}

/** The Electron CLI host: nodeHost's terminal handling plus the live backend and this app's paths. */
function electronCliHost(): CliHost {
  const base = nodeHost({ dev: !app.isPackaged });
  return {
    ...base,
    async createEngine({ mode, surface, userDataDir }) {
      const dir = userDataDir ? path.resolve(userDataDir) : configDir;
      const given = Boolean(userDataDir || userDataSwitch);
      if (mode === "demo") return buildEngine({ mode: "demo" }, surface, dir, given ? fileSettings(configPaths(dir).settings, DEMO_SETTINGS) : memorySettings(DEMO_SETTINGS));
      if (mode === "fake") {
        // runCli only allows --fake when host.dev, that is, an unpackaged build.
        const origin = process.env.MESH_UI_FAKE_ORIGIN ?? "";
        if (!LOCAL_ORIGIN.test(origin)) {
          throw new Error("--fake needs MESH_UI_FAKE_ORIGIN set to the local fake eero server, e.g. http://127.0.0.1:4010.");
        }
        // Never the real session: a file only in a config dir given for this run.
        const secrets = given ? createSecretStore({ file: configPaths(dir).session, safeStorage, platform: process.platform }) : memorySecrets();
        return buildEngine({ mode: "fake", origin, secrets }, surface, dir, given ? fileSettings(configPaths(dir).settings) : memorySettings());
      }
      return buildEngine({ mode: "live" }, surface, dir, fileSettings(configPaths(dir).settings));
    },
  };
}

// ---------------------------------------------------------------------------
// Window

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 760,
    minHeight: 480,
    title: "Mesh UI",
    show: false,
    backgroundColor: dark ? "#000000" : "#fcfcfc",
    ...(isMac
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 15 } }
      : isHeadless
        ? { titleBarStyle: "hidden" }
        : {
            titleBarStyle: "hidden",
            titleBarOverlay: {
              color: "#00000000",
              symbolColor: dark ? "#f5f5f5" : "#18181b",
              height: OVERLAY_HEIGHT,
            },
          }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      ...(isHeadless ? { offscreen: true } : {}),
    },
  });

  if (!isHeadless) mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => (mainWindow = null));

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}

/** True for URLs that belong to the app itself (dev server or built files). */
function isAppUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return url.startsWith(devUrl);
  return url.startsWith(pathToFileURL(path.join(__dirname, "../renderer/")).href);
}

// The renderer can reach the token-holding main process over IPC, so it must
// only ever run our own code: no navigating away, no popups, no webviews.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // Open external links in the user's browser, never inside the app.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
});

/** The native save dialog for `window.mesh.saveFile`; the path never leaves main. */
const saveFileHost: SaveFileHost = {
  async choosePath(name, ext) {
    const scratch = process.env.MESH_UI_SAVE_DIR;
    if (isHeadless && scratch) return path.join(scratch, name);
    const options = {
      defaultPath: path.join(app.getPath("downloads"), name),
      filters: [{ name: SAVE_EXTS[ext], extensions: [ext] }],
    };
    const r = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    return r.canceled || !r.filePath ? null : r.filePath;
  },
  write: (file, text) => writeFile(file, text, "utf8"),
};

/** Shown alerts, held so their click handlers are not garbage collected. */
const shownAlerts = new Set<Notification>();

/** Desktop alerts with Electron `Notification` (src/main/notify.ts checks them first). */
const notifyHost: NotifyHost = {
  show(alert, onClick) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: alert.title, body: alert.body });
    const forget = () => shownAlerts.delete(n);
    n.on("click", () => {
      forget();
      onClick();
    });
    n.on("close", forget);
    shownAlerts.add(n);
    n.show();
  },
  open(target) {
    if (!mainWindow) {
      const win = createWindow();
      win.webContents.once("did-finish-load", () => win.webContents.send(IPC.notifyClick, target));
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send(IPC.notifyClick, target);
  },
};

function lockDownSession(): void {
  // The app needs no camera, mic, location, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

// ---------------------------------------------------------------------------
// Start

if (isCli) {
  app.dock?.hide();
  void app.whenReady().then(() => {
    lockDownSession();
    return cliMain(argv.slice(cliIndex + 1), electronCliHost());
  });
} else {
  if (isHeadless) app.dock?.hide();
  void app.whenReady().then(async () => {
    lockDownSession();
    const engine = await createAppEngine();
    registerIpc(ipcMain, {
      engine,
      isAppUrl,
      broadcast: (channel, event) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, event);
      },
      setTitlebarColors: (colors) => {
        if (!mainWindow || process.platform === "darwin" || isHeadless) return;
        mainWindow.setTitleBarOverlay({ ...colors, height: OVERLAY_HEIGHT });
      },
      saveFile: saveFileHost,
      ...(isHeadless ? {} : { notify: notifyHost }),
    });
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
