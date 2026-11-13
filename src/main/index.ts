import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from "electron";
import type { TitlebarColors } from "@shared/types";
import { demoNetworks, isDemo } from "./demo";
import * as eero from "./eero";
import { clearToken, loadToken, saveToken, sessionStorage } from "./session";

/** Matches --titlebar-height in the renderer's index.css. */
const TITLEBAR_HEIGHT = 44;

let token: string | null = null;
let mainWindow: BrowserWindow | null = null;

ipcMain.handle("start-login", async (_e, login: string) => {
  token = await eero.startLogin(login);
});

ipcMain.handle("verify", async (_e, code: string) => {
  if (!token) throw new Error("No login in progress");
  await eero.verify(token, code);
  saveToken(token);
});

ipcMain.handle("logout", async () => {
  const current = token ?? loadToken();
  token = null;
  clearToken();
  // Best effort: the local session is already gone even if eero is unreachable.
  if (current && !isDemo) await eero.logout(current).catch(() => {});
});

ipcMain.handle("session-storage", () => sessionStorage());

ipcMain.handle("load", async () => {
  if (isDemo) return demoNetworks;
  token ??= loadToken();
  if (!token) return null;
  try {
    return await eero.loadNetworks(token);
  } catch (err) {
    // An expired or revoked session sends the user back to sign in.
    if (err instanceof eero.EeroError && err.status === 401) {
      token = null;
      clearToken();
      return null;
    }
    throw err;
  }
});

ipcMain.on("set-titlebar-colors", (_e, colors: TitlebarColors) => {
  if (!mainWindow || process.platform === "darwin") return;
  mainWindow.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
});

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

app.setName("Mesh UI");
// Keep config in a lowercase directory (~/.config/mesh-ui on Linux,
// ~/Library/Application Support/mesh-ui on macOS, %APPDATA%\mesh-ui on
// Windows) rather than the display name. Must run before the app is ready.
app.setPath("userData", path.join(app.getPath("appData"), "mesh-ui"));
app.whenReady().then(() => {
  // The app needs no camera, mic, location, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
