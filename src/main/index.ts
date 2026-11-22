/**
 * The Electron host. It builds the engine (src/core) with a backend and the
 * `safeStorage` SecretStore, exposes it to the window over src/main/ipc.ts,
 * and keeps every web contents locked down. With `--cli` it creates no
 * window and hands the argv after the flag to `cliMain` with the Electron
 * CLI host, which builds the same engines (docs/architecture/cli.md#how-the-cli-runs).
 * A CLI host never shows a dialog: error boxes and uncaught errors print to
 * stderr and exit non-zero (`guardCliHost`).
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
 * Headless runs never show desktop alerts (`mesh:notify` is not registered)
 * and never create a tray icon.
 *
 * Keep running in the tray (`runInTray`, src/main/tray.ts): with it on,
 * closing the window hides it to the system tray and a second launch shows
 * the running copy (single-instance lock, held only while the setting is on).
 */

import { execFile, spawn as spawnProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, nativeImage, nativeTheme, powerMonitor, safeStorage, screen, session, shell, Tray } from "electron";
import { version as appVersion } from "../../package.json";
import type { Backend, SecretStore } from "../core/backend";
import { createDemoBackend, DEMO_SETTINGS } from "../core/demo";
import { createEeroBackend } from "../core/eero/backend";
import { fileRequestLog, requestLogPath } from "../core/eero/requestLog";
import { setInspector } from "../core/eero/inspect";
import { createEngine, type Engine, fileSettings, memorySettings } from "../core/engine";
import type { AppSettings } from "../core/model";
import type { HostActions, SettingsStore, Surface } from "../core/spec";
import { type CliHost, cliMain, nodeHost } from "../cli";
import { IPC } from "../shared/types";
import { caughtKey, registerIpc, SAVE_EXTS, type SaveFileHost } from "./ipc";
import { createOpenVsx } from "./open-vsx";
import type { NotifyHost } from "./notify";
import { cliExitDelay, guardCliHost } from "./cli-host";
import { isAmazonSignInContents } from "./amazon-native-signin";
import { createHostActions } from "./host-actions";
import { detectInstallKind } from "./install-kind";
import { configPaths, resolveConfigDir } from "./paths";
import { createSecretStore, keychainName } from "./secret-store";
import { previewUpdate } from "./updater";
import { createTrayMode, linuxTrayAvailable, type RunText } from "./tray";
import { fitWindowState, readWindowState, trackWindowState, writeWindowState } from "./window-state";
import trayColorIcon from "../../build/icons/32x32.png?asset";
import trayTemplateIcon from "../../build/tray/mesh-ui-trayTemplate.png?asset";
import trayTemplateIcon2x from "../../build/tray/mesh-ui-trayTemplate@2x.png?asset";
import { isAmazonAllowedNavigation } from "../core/eero/amazonNative";

/** Matches --titlebar-height in the renderer's index.css. */
const TITLEBAR_HEIGHT = 44;
/** The Windows and Linux controls overlay covers the whole titlebar strip. */
const OVERLAY_HEIGHT = TITLEBAR_HEIGHT;
/**
 * The overlay behind the native window controls is transparent, as in T3
 * Code, so the page's own titlebar (and its grain) shows through and the
 * buttons sit on exactly the same surface. `#00000000` does not work
 * correctly on Linux, hence the 1/255 alpha (T3's DesktopWindow.ts).
 */
const OVERLAY_COLOR = "#01000000";

const argv = process.argv;
const cliIndex = argv.indexOf("--cli");
const isCli = cliIndex !== -1;
/** When the app became ready in a CLI run (cliExitDelay). */
let cliReadyAt: number | null = null;
/**
 * Ends a CLI run. On Windows it first lets Chromium's startup settle after
 * `ready` (cliExitDelay in src/main/cli-host.ts), or the exit can crash with
 * 0xC0000005 and lose the exit code. After ready it uses app.exit, which
 * shuts Chromium down in order.
 */
const cliExit = (code: number): void => {
  if (!app.isReady()) {
    process.exit(code);
    return;
  }
  const delay = cliExitDelay(process.platform, cliReadyAt, Date.now());
  if (delay > 0) setTimeout(() => app.exit(code), delay);
  else app.exit(code);
};
// The CLI is always headless: errors go to stderr, never a native dialog.
if (isCli) guardCliHost({ dialog, process, stderr: (text) => process.stderr.write(text), exit: cliExit });
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

/** `MESH_UI_UPDATE_STATE` in unpackaged headless runs: a fixed update state for ui:shot (src/main/updater.ts). */
const updatePreview = isHeadless ? previewUpdate(process.env, app.isPackaged) : null;

/** How this copy was installed (src/main/install-kind.ts). Read once. */
const installKind = updatePreview?.install ?? detectInstallKind({
  packaged: app.isPackaged,
  platform: process.platform,
  env: process.env,
  resourcesPath: process.resourcesPath,
  exePath: process.execPath,
  readText: (file) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
  list: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
});

/**
 * Set once this instance has handed the window over to a new one (demo
 * switch under the dev server): closing its windows must not quit it.
 */
let handedOff = false;

/**
 * The demo switch under `pnpm dev` (src/main/demo-switch.ts): a relaunch would
 * end electron-vite and its dev server, so start the new instance as a child
 * instead, close this one's windows, and exit with the child.
 */
function devHandOff(args: string[]): void {
  handedOff = true;
  const child = spawnProcess(process.execPath, args, { stdio: "inherit", env: process.env });
  child.on("exit", (code) => app.exit(code ?? 0));
  child.on("error", () => app.exit(1));
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
}

/** The window's host actions (updater, CLI install, demo relaunch, request log, Amazon sign-in). The CLI host gets none. */
function windowActions(settings: SettingsStore, dir: string): HostActions {
  const actions = createHostActions({
    install: installKind,
    exePath: process.execPath,
    env: process.env,
    settings: () => settings.get(),
    onUpdate: (status) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.event, { type: "update.changed", status });
    },
    updatePreview: updatePreview?.status ?? null,
    demoSwitch: { app, argv: process.argv, env: process.env, handOff: devHandOff },
    requestLog: { path: requestLogPath(dir), shell },
    appVersion,
    platform: process.platform,
    // Demo never opens Amazon; the command still goes through the host action.
    ...(isDemo ? { amazonInstantToken: "demo" } : {}),
    amazonParent: () => mainWindow,
  });
  // An update restart closes every window before before-quit fires: tell tray mode first, or the close is turned into a hide.
  const update = actions.update;
  if (update) actions.update = { ...update, install: () => (trayMode.quitting(), update.install()) };
  return { ...actions, tray: trayAction };
}

/** The engine for any surface. Only live mode reads or writes the saved session. */
async function buildEngine(m: EngineMode, surface: Surface, dir: string, settings: SettingsStore): Promise<Engine> {
  let backend: Backend;
  if (m.mode === "demo") {
    backend = createDemoBackend();
  } else {
    const secrets = m.mode === "fake" ? m.secrets : createSecretStore({ file: configPaths(dir).session, safeStorage, platform: process.platform });
    const userAgent = (await settings.get()).userAgent;
    // Every eero request is logged (redacted) for bug reports; see src/core/eero/requestLog.ts.
    const onLog = fileRequestLog(requestLogPath(dir), surface);
    backend = createEeroBackend({ secrets, userAgent, onLog, ...(m.mode === "fake" ? { origin: m.origin } : {}) });
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
      install: installKind,
      ...(surface === "ui" ? { actions: windowActions(settings, dir) } : {}),
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
// Tray (src/main/tray.ts)

/** Runs a command for its stdout (the Linux tray check); null when it is missing or fails. */
const runText: RunText = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 2000, encoding: "utf8" }, (err, stdout) => resolve(err ? null : stdout)));

/** The tray icon: a template image in the macOS menu bar, the color app icon on Windows and Linux panels. */
function trayImage(): Electron.NativeImage {
  if (process.platform !== "darwin") return nativeImage.createFromBuffer(readFileSync(trayColorIcon));
  const image = nativeImage.createFromBuffer(readFileSync(trayTemplateIcon), { scaleFactor: 1 });
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(trayTemplateIcon2x) });
  image.setTemplateImage(true);
  return image;
}

/** Shows, restores and focuses the window, creating it when there is none. */
function showWindow(): BrowserWindow {
  const win = mainWindow ?? createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

const trayMode = createTrayMode({
  platform: process.platform,
  available: async () => process.platform !== "linux" || linuxTrayAvailable(runText),
  create(menu) {
    const tray = new Tray(trayImage());
    tray.setToolTip("Mesh UI");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Mesh UI", click: menu.open },
        { type: "separator" },
        { label: "Quit Mesh UI", click: menu.quit },
      ]),
    );
    // macOS opens the menu on click; Windows and Linux open the window.
    if (process.platform !== "darwin") tray.on("click", menu.open);
    return tray;
  },
  open: () => void showWindow(),
  quit: () => app.quit(),
  notice() {
    const where = process.platform === "darwin" ? "menu bar" : "system tray";
    notifyHost.show({ title: "Mesh UI is still running", body: `It is in the ${where}, so desktop alerts keep arriving. Quit from there to close it.` }, () => void showWindow());
  },
});

/**
 * The window's `tray` host action. The single-instance lock follows the
 * setting, so a second launch shows this copy instead of a second window.
 * Headless runs report a tray (for screenshots of the setting) but never make one.
 */
const trayAction: NonNullable<HostActions["tray"]> = isHeadless
  ? { available: async () => true, apply: async () => false }
  : {
      available: async () => process.platform !== "linux" || linuxTrayAvailable(runText),
      async apply(on) {
        if (on) app.requestSingleInstanceLock();
        else app.releaseSingleInstanceLock();
        return trayMode.apply(on);
      },
    };

// ---------------------------------------------------------------------------
// Window

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const isMac = process.platform === "darwin";
  // Headless runs (ui:shot) always use the default size, so screenshots match.
  const limits = { width: 1200, height: 780, minWidth: 760, minHeight: 480 };
  const bounds = fitWindowState(
    isHeadless ? null : readWindowState(paths.windowState),
    [screen.getPrimaryDisplay(), ...screen.getAllDisplays()].map((d) => d.workArea),
    limits,
  );
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: limits.minWidth,
    minHeight: limits.minHeight,
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
              color: OVERLAY_COLOR,
              symbolColor: dark ? "#f5f5f5" : "#18181b",
              height: OVERLAY_HEIGHT,
            },
          }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Live rates keep their 4 s burst reads while the window is minimized or hidden.
      backgroundThrottling: false,
      ...(isHeadless ? { offscreen: true } : {}),
    },
  });

  // Ctrl+R / Cmd+R and F5 never reload the window: main catches them and hands them to the renderer's
  // shortcut registry, which runs whatever they are bound to (F5 is Refresh by default).
  // (F12 opens the app's own dev tools panel; the renderer handles it.)
  const win = mainWindow;
  // A reload or a closed window ends any dev tools recording; the new page starts with it off.
  // did-navigate fires for loads and reloads only, not the in-page hash changes between pages.
  win.webContents.on("did-navigate", () => setInspector(null));
  win.webContents.on("render-process-gone", () => setInspector(null));
  win.on("closed", () => setInspector(null));
  win.webContents.on("before-input-event", (event, input) => {
    const combo = caughtKey(input, process.platform);
    if (combo === null) return;
    event.preventDefault();
    win.webContents.send(IPC.caughtKey, combo);
  });

  if (!isHeadless) {
    trackWindowState(win, (state) => writeWindowState(paths.windowState, state));
    win.once("ready-to-show", () => {
      if (bounds.maximized) win.maximize();
      win.show();
    });
  }
  mainWindow.on("closed", () => (mainWindow = null));
  // Tray mode: closing (and on Windows and Linux minimizing) hides the window instead.
  win.on("close", (event) => {
    if (trayMode.close(win)) event.preventDefault();
  });
  win.on("minimize", () => void trayMode.minimize(win));
  // Windows logging off or shutting down: let the window close.
  win.on("session-end", () => trayMode.quitting());

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
// Amazon sign-in is the one exception: an ephemeral BrowserWindow with no
// preload may navigate Amazon hosts (see amazon-native-signin.ts).
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (isAmazonSignInContents(contents)) {
      if (!isAmazonAllowedNavigation(url)) event.preventDefault();
      return;
    }
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // Open external links in the user's browser, never inside the app.
  // Amazon sign-in forces popups into the same window (set in amazon-native-signin).
  contents.setWindowOpenHandler(({ url }) => {
    if (isAmazonSignInContents(contents)) {
      if (isAmazonAllowedNavigation(url)) void contents.loadURL(url);
      return { action: "deny" };
    }
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
  open(click) {
    if (!mainWindow) {
      const win = createWindow();
      win.webContents.once("did-finish-load", () => win.webContents.send(IPC.notifyClick, click));
      return;
    }
    showWindow().webContents.send(IPC.notifyClick, click);
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
    cliReadyAt = Date.now();
    lockDownSession();
    return cliMain(argv.slice(cliIndex + 1), electronCliHost(), cliExit);
  });
} else {
  if (isHeadless) app.dock?.hide();
  void app.whenReady().then(async () => {
    lockDownSession();
    const engine = await createAppEngine();
    const saved = await engine.execute<AppSettings>("app.settings.get");
    const runInTray = !isHeadless && saved.ok && saved.result.runInTray;
    // Tray mode keeps one copy running: a second launch shows it (second-instance) and quits.
    if (runInTray && !app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    registerIpc(ipcMain, {
      engine,
      isAppUrl,
      broadcast: (channel, event) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, event);
      },
      setTitlebarColors: (colors) => {
        if (!mainWindow || process.platform === "darwin" || isHeadless) return;
        // Only the symbol colour follows the theme; the overlay stays transparent.
        mainWindow.setTitleBarOverlay({ color: OVERLAY_COLOR, symbolColor: colors.symbolColor, height: OVERLAY_HEIGHT });
      },
      saveFile: saveFileHost,
      ...(isHeadless ? {} : { notify: notifyHost }),
      themes: createOpenVsx((url, init) => fetch(url, init)),
      devtools: { available: !isDemo, openElectron: () => mainWindow?.webContents.openDevTools({ mode: "right" }) },
    });
    createWindow();
    if (runInTray) void trayMode.apply(true);
    app.on("second-instance", () => void showWindow());
    app.on("activate", () => {
      // The Dock icon brings back a window hidden to the tray, or makes a new one.
      if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
      else if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    powerMonitor.on("shutdown", () => trayMode.quitting());
  });

  // Every real quit (tray menu, Cmd+Q, app menu) lets the window close.
  app.on("before-quit", () => trayMode.quitting());

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !handedOff) app.quit();
  });
}
