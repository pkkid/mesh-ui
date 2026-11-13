/**
 * The Electron host. It builds the engine (src/core) with a backend and the
 * `safeStorage` SecretStore, exposes it to the window over src/main/ipc.ts,
 * and keeps every web contents locked down. With `--cli` it creates no
 * window and hands argv to `runCli` (docs/architecture/cli.md#how-the-cli-runs).
 *
 * Backends:
 * - live: the eero backend against api-user.e2ro.com.
 * - demo: `MESH_UI_DEMO=1` or `--demo`, in-memory fixtures, no secrets.
 * - fake (dev builds only): `MESH_UI_FAKE=1` points the eero backend at the
 *   local fake eero server (`MESH_UI_FAKE_ORIGIN`, or one started here from
 *   test/fake-eero) with a throwaway config dir. Release builds drop this
 *   code, so they have no way to point the client anywhere but eero.
 */

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, nativeTheme, safeStorage, session, shell } from "electron";
import type { Backend } from "../core/backend";
import { createDemoBackend } from "../core/demo";
import { createEeroBackend } from "../core/eero/backend";
import { createEngine, type Engine, fileSettings, memorySettings } from "../core/engine";
import type { SettingsStore } from "../core/spec";
import { EXIT, runCli } from "../cli";
import { registerIpc } from "./ipc";
import { configPaths, resolveConfigDir } from "./paths";
import { createSecretStore, keychainName } from "./secret-store";

/** Matches --titlebar-height in the renderer's index.css. */
const TITLEBAR_HEIGHT = 44;

const argv = process.argv;
const cliIndex = argv.indexOf("--cli");
const isCli = cliIndex !== -1;
const isDemo = process.env.MESH_UI_DEMO === "1" || (!isCli && argv.includes("--demo"));
const isFake = import.meta.env.DEV && process.env.MESH_UI_FAKE === "1";

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

/** Dev only: origin of the fake eero server, starting it when none is given. */
async function fakeOrigin(): Promise<string | undefined> {
  if (!import.meta.env.DEV || !isFake) return undefined;
  if (process.env.MESH_UI_FAKE_ORIGIN) return process.env.MESH_UI_FAKE_ORIGIN;
  // Glob so the build still works before test/fake-eero/server.ts exists.
  const loaders = import.meta.glob<{ startFakeEero?: () => Promise<{ origin: string }> }>("../../test/fake-eero/server.ts");
  const load = Object.values(loaders)[0];
  const start = load && (await load()).startFakeEero;
  if (!start) throw new Error("MESH_UI_FAKE=1 needs test/fake-eero/server.ts to export startFakeEero(), or set MESH_UI_FAKE_ORIGIN.");
  const { origin } = await start();
  console.log(`[mesh-ui] fake eero server at ${origin}, config in ${configDir}`);
  return origin;
}

async function createAppEngine(): Promise<Engine> {
  let backend: Backend;
  let settings: SettingsStore;
  if (isDemo) {
    // Demo never touches the session or the saved settings.
    backend = createDemoBackend();
    settings = memorySettings();
  } else {
    settings = fileSettings(paths.settings);
    const secrets = createSecretStore({ file: paths.session, safeStorage, platform: process.platform });
    const origin = await fakeOrigin();
    backend = createEeroBackend({ secrets, userAgent: (await settings.get()).userAgent, ...(origin ? { origin } : {}) });
  }
  return createEngine({
    backend,
    settings,
    surface: "ui",
    host: {
      version: app.getVersion(),
      electron: process.versions.electron ?? null,
      configDir,
      keychainName: isDemo ? null : keychainName(safeStorage, process.platform),
    },
  });
}

// ---------------------------------------------------------------------------
// Window

function createWindow(): void {
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
      : {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#00000000",
            symbolColor: dark ? "#f5f5f5" : "#18181b",
            height: TITLEBAR_HEIGHT,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => (mainWindow = null));

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
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

function lockDownSession(): void {
  // The app needs no camera, mic, location, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

// ---------------------------------------------------------------------------
// Start

if (isCli) {
  app.dock?.hide();
  void app.whenReady().then(async () => {
    lockDownSession();
    let code: number;
    try {
      code = await runCli(argv.slice(cliIndex + 1));
    } catch {
      code = EXIT.failed;
    }
    app.exit(code);
  });
} else {
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
        if (!mainWindow || process.platform === "darwin") return;
        mainWindow.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
      },
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
