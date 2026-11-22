/**
 * Both halves of the `window.mesh` IPC protocol (docs/architecture/ui.md#the-bridge-windowmesh):
 *
 * - `registerIpc` (main): `mesh:execute` and `mesh:commands` call the engine,
 *   engine host events go out on `mesh:event`, `mesh:titlebar` sets the
 *   overlay colours, `mesh:save-file` saves text through the native save
 *   dialog and `mesh:notify` shows a desktop alert (src/main/notify.ts).
 *   Requests from anything but the app's own pages are refused.
 * - `createMeshBridge` (preload): the `window.mesh` object.
 *
 * Only engine results, the registry listing and host events cross this
 * boundary. The engine never returns the token, so neither does IPC.
 * No Electron values are imported here, so tests can drive both halves.
 */

import type { InspectRecord } from "../core/eero/inspect";
import { setInspector } from "../core/eero/inspect";
import type { Engine, ExecuteOptions } from "../core/engine";
import type { ExecuteResult } from "../core/errors";
import type { HostEvent } from "../core/model";
import {
  IPC,
  type MeshApi,
  type SaveFileResult,
  type ThemeDownloadResult,
  type ThemeSearchResult,
  type TitlebarColors,
} from "../shared/types";
import { formatCombo } from "../shared/shortcuts";
import { type NotifyHost, registerNotify } from "./notify";

// ---------------------------------------------------------------------------
// Main side

export type SenderEvent = {
  senderFrame?: { url: string } | null;
  /** The window that asked; the dev tools panel's records go back to it. */
  sender?: { send(channel: string, ...args: unknown[]): void; isDestroyed?(): boolean };
};

/** The parts of Electron's `ipcMain` used here. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: SenderEvent, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: SenderEvent, ...args: unknown[]) => void): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): void;
}

export type IpcOptions = {
  engine: Engine;
  /** True for URLs of the app's own pages. */
  isAppUrl(url: string): boolean;
  /** Sends a host event to every open window. */
  broadcast(channel: string, event: HostEvent): void;
  setTitlebarColors(colors: TitlebarColors): void;
  /** The native save dialog and file write; without it `mesh:save-file` is not registered. */
  saveFile?: SaveFileHost;
  /** Desktop alerts; without it `mesh:notify` is not registered (headless runs, tests). */
  notify?: NotifyHost;
  /** Open VSX theme search and download (src/main/open-vsx.ts); without it the channels answer "unavailable". */
  themes?: ThemeHost;
  /**
   * The F12 dev tools panel: whether there are eero requests to show (not
   * in demo mode) and how to open Electron's own developer tools. Without it
   * the panel says recording is unavailable.
   */
  devtools?: { available: boolean; openElectron(): void };
};

/** What the host provides for `window.mesh.searchThemes` and `downloadThemes`. */
export type ThemeHost = {
  search(query: unknown, sort: unknown): Promise<ThemeSearchResult>;
  download(extensionId: unknown): Promise<ThemeDownloadResult>;
};

/** What the host provides for `window.mesh.saveFile`. Paths stay in main. */
export type SaveFileHost = {
  /** Shows the save dialog suggesting `name`; resolves the chosen path, or null when canceled. */
  choosePath(name: string, ext: SaveExt): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
};

/** The only file types the renderer may save: plain text exports. */
export const SAVE_EXTS = {
  csv: "CSV",
  tsv: "TSV",
  txt: "Text",
  json: "JSON",
  jsonl: "JSON Lines",
  log: "Log",
} as const;
export type SaveExt = keyof typeof SAVE_EXTS;

/** Largest text the renderer may save (8 MB of UTF-16 code units). */
export const SAVE_MAX_CHARS = 8 * 1024 * 1024;

/**
 * Checks a save request from the renderer: text only, a bare file name (any
 * folder part is dropped) with a text extension. Returns the cleaned name or
 * why it was refused.
 */
export function checkSaveRequest(name: unknown, text: unknown): { name: string; ext: SaveExt } | { refused: string } {
  if (typeof text !== "string") return { refused: "Only text can be saved." };
  if (text.length > SAVE_MAX_CHARS) return { refused: "That file is too large to save." };
  if (typeof name !== "string") return { refused: "The file needs a name." };
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .trim()
    .slice(0, 120);
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!base || base.startsWith(".")) return { refused: "The file needs a name." };
  if (!Object.hasOwn(SAVE_EXTS, ext)) return { refused: "Only text files can be saved." };
  return { name: base, ext: ext as SaveExt };
}

/** The last part of a path, for "Saved <name>" (never the folder). */
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? "";

const refused = (): ExecuteResult<never> => ({
  ok: false,
  error: { code: "network_error", message: "Request refused: not from the app window." },
});

const isColor = (v: unknown): v is string => typeof v === "string" && v.length <= 64;

/** Wires the channels. Returns a function that removes them again. */
export function registerIpc(ipcMain: IpcMainLike, opts: IpcOptions): () => void {
  const trusted = (e: SenderEvent) => {
    const url = e.senderFrame?.url;
    return typeof url === "string" && opts.isAppUrl(url);
  };

  ipcMain.handle(IPC.execute, async (e, id, params, options) => {
    if (!trusted(e)) return refused();
    // Only the known option crosses: `fresh`, and only as a real boolean.
    const fresh = !!options && typeof options === "object" && (options as { fresh?: unknown }).fresh === true;
    try {
      return await opts.engine.execute(typeof id === "string" ? id : String(id), params, fresh ? { fresh } : undefined);
    } catch {
      // execute never throws; this guards the IPC boundary anyway.
      return { ok: false, error: { code: "network_error", message: "The app could not run that command." } };
    }
  });

  ipcMain.handle(IPC.commands, (e) => (trusted(e) ? opts.engine.commands() : []));

  ipcMain.on(IPC.titlebar, (e, colors) => {
    if (!trusted(e) || !colors || typeof colors !== "object") return;
    const { color, symbolColor } = colors as Partial<TitlebarColors>;
    if (isColor(color) && isColor(symbolColor)) opts.setTitlebarColors({ color, symbolColor });
  });

  const saver = opts.saveFile;
  if (saver) {
    ipcMain.handle(IPC.saveFile, async (e, name, text): Promise<SaveFileResult> => {
      if (!trusted(e)) return { status: "failed", message: "Request refused: not from the app window." };
      const ok = checkSaveRequest(name, text);
      if ("refused" in ok) return { status: "failed", message: ok.refused };
      try {
        const chosen = await saver.choosePath(ok.name, ok.ext);
        if (!chosen) return { status: "canceled" };
        await saver.write(chosen, text as string);
        return { status: "saved", name: baseName(chosen) };
      } catch {
        return { status: "failed", message: "The file could not be saved." };
      }
    });
  }

  const themes = opts.themes;
  const unavailable = { ok: false, message: "Theme search is not available here." } as const;
  ipcMain.handle(IPC.themeSearch, async (e, query, sort): Promise<ThemeSearchResult> => {
    if (!trusted(e)) return { ok: false, message: "Request refused: not from the app window." };
    return themes ? themes.search(query, sort) : unavailable;
  });
  ipcMain.handle(IPC.themeDownload, async (e, id): Promise<ThemeDownloadResult> => {
    if (!trusted(e)) return { ok: false, message: "Request refused: not from the app window." };
    return themes ? themes.download(id) : unavailable;
  });

  const unregisterNotify = opts.notify ? registerNotify(ipcMain, trusted, opts.notify) : null;

  // Dev tools: recording runs only between capture(true) and capture(false) (or the window going away).
  ipcMain.handle(IPC.devtoolsCapture, (e, on) => {
    if (!trusted(e)) return { available: false };
    const available = opts.devtools?.available === true;
    const sender = e.sender;
    if (on === true && available && sender) {
      setInspector((record) => {
        if (sender.isDestroyed?.()) return setInspector(null);
        sender.send(IPC.devtoolsRecord, record);
      });
    } else {
      setInspector(null);
    }
    return { available };
  });
  ipcMain.on(IPC.devtoolsOpen, (e) => {
    if (trusted(e)) opts.devtools?.openElectron();
  });

  const unsubscribe = opts.engine.onEvent((event) => opts.broadcast(IPC.event, event));

  return () => {
    unsubscribe();
    ipcMain.removeHandler(IPC.execute);
    ipcMain.removeHandler(IPC.commands);
    if (saver) ipcMain.removeHandler(IPC.saveFile);
    ipcMain.removeHandler(IPC.themeSearch);
    ipcMain.removeHandler(IPC.themeDownload);
    ipcMain.removeHandler(IPC.devtoolsCapture);
    ipcMain.removeAllListeners(IPC.devtoolsOpen);
    setInspector(null);
    ipcMain.removeAllListeners(IPC.titlebar);
    unregisterNotify?.();
  };
}

/** The parts of Electron's `Input` (before-input-event) the reload keys check reads. */
export type KeyInput = { type: string; key: string; control: boolean; meta: boolean; alt: boolean; shift: boolean };

/**
 * The key combination (src/shared/shortcuts.ts) when a key press is one main
 * must catch: `Cmd+R` on macOS, `Ctrl+R` elsewhere, or a bare `F5`. The
 * default menu's Reload would reload the window on the first, so main stops
 * all of them before the page and the menu see them and hands the
 * combination to the renderer (`window.mesh.onCaughtKey`), whose shortcut
 * registry runs whatever is bound to it (Refresh by default is `F5`).
 * `Ctrl+Shift+R` (force reload) is left alone. Null for every other key.
 */
export function caughtKey(input: KeyInput, platform: string): string | null {
  if (input.type !== "keyDown" || input.alt || input.shift) return null;
  if (input.key === "F5") return !input.control && !input.meta ? "F5" : null;
  const mac = platform === "darwin";
  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod || input.key.toLowerCase() !== "r") return null;
  return formatCombo({ ctrl: !mac, meta: mac, alt: false, shift: false, code: "KeyR" });
}

// ---------------------------------------------------------------------------
// Preload side

/** The parts of Electron's `ipcRenderer` used here. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

export function createMeshBridge(ipc: IpcRendererLike, platform: string): MeshApi {
  const execute = async <R>(id: string, params?: unknown, options?: ExecuteOptions): Promise<ExecuteResult<R>> => {
    try {
      const args: unknown[] = options?.fresh === true ? [id, params, { fresh: true }] : [id, params];
      return (await ipc.invoke(IPC.execute, ...args)) as ExecuteResult<R>;
    } catch {
      return { ok: false, error: { code: "network_error", message: "Lost contact with the app." } };
    }
  };

  const api: MeshApi = {
    platform,
    execute,
    commands: async () => {
      try {
        return (await ipc.invoke(IPC.commands)) as Awaited<ReturnType<MeshApi["commands"]>>;
      } catch {
        return [];
      }
    },
    on(listener) {
      const wrapped = (_e: unknown, event: unknown) => listener(event as HostEvent);
      ipc.on(IPC.event, wrapped);
      return () => void ipc.removeListener(IPC.event, wrapped);
    },
    setTitlebarColors: (colors) => ipc.send(IPC.titlebar, { color: colors.color, symbolColor: colors.symbolColor }),
    saveFile: async (name, text) => {
      // Refuse non-text here too, so nothing else is ever sent.
      if (typeof name !== "string" || typeof text !== "string") return { status: "failed", message: "Only text can be saved." };
      try {
        return (await ipc.invoke(IPC.saveFile, name, text)) as SaveFileResult;
      } catch {
        return { status: "failed", message: "Lost contact with the app." };
      }
    },
    notify: (alert) => {
      if (!alert || typeof alert !== "object") return;
      const { title, body, target, networkId } = alert;
      if (typeof title !== "string" || typeof body !== "string" || typeof target !== "string" || typeof networkId !== "string") return;
      ipc.send(IPC.notify, { title, body, target, networkId });
    },
    searchThemes: async (query, sort) => {
      if (typeof query !== "string" || typeof sort !== "string") return { ok: false, message: "Bad search." };
      try {
        return (await ipc.invoke(IPC.themeSearch, query, sort)) as ThemeSearchResult;
      } catch {
        return { ok: false, message: "Lost contact with the app." };
      }
    },
    downloadThemes: async (extensionId) => {
      if (typeof extensionId !== "string") return { ok: false, message: "That is not an extension id." };
      try {
        return (await ipc.invoke(IPC.themeDownload, extensionId)) as ThemeDownloadResult;
      } catch {
        return { ok: false, message: "Lost contact with the app." };
      }
    },
    onCaughtKey(listener) {
      const wrapped = (_e: unknown, combo: unknown) => {
        if (typeof combo === "string") listener(combo);
      };
      ipc.on(IPC.caughtKey, wrapped);
      return () => void ipc.removeListener(IPC.caughtKey, wrapped);
    },
    devtools: {
      capture: async (on) => {
        try {
          return (await ipc.invoke(IPC.devtoolsCapture, on === true)) as { available: boolean };
        } catch {
          return { available: false };
        }
      },
      onRecord(listener) {
        const wrapped = (_e: unknown, record: unknown) => {
          if (record && typeof record === "object") listener(record as InspectRecord);
        };
        ipc.on(IPC.devtoolsRecord, wrapped);
        return () => void ipc.removeListener(IPC.devtoolsRecord, wrapped);
      },
      openElectron: () => ipc.send(IPC.devtoolsOpen),
    },
    onNotificationClick(listener) {
      const wrapped = (_e: unknown, click: unknown) => {
        const { target, networkId } = (click ?? {}) as Record<string, unknown>;
        if (typeof target === "string" && typeof networkId === "string") listener({ target, networkId });
      };
      ipc.on(IPC.notifyClick, wrapped);
      return () => void ipc.removeListener(IPC.notifyClick, wrapped);
    },
  };

  return api;
}
