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

import type { Engine } from "../core/engine";
import type { ExecuteResult } from "../core/errors";
import type { HostEvent } from "../core/model";
import { IPC, type MeshApi, type SaveFileResult, type TitlebarColors } from "../shared/types";
import { type NotifyHost, registerNotify } from "./notify";

// ---------------------------------------------------------------------------
// Main side

export type SenderEvent = { senderFrame?: { url: string } | null };

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

  ipcMain.handle(IPC.execute, async (e, id, params) => {
    if (!trusted(e)) return refused();
    try {
      return await opts.engine.execute(typeof id === "string" ? id : String(id), params);
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

  const unregisterNotify = opts.notify ? registerNotify(ipcMain, trusted, opts.notify) : null;

  const unsubscribe = opts.engine.onEvent((event) => opts.broadcast(IPC.event, event));

  return () => {
    unsubscribe();
    ipcMain.removeHandler(IPC.execute);
    ipcMain.removeHandler(IPC.commands);
    if (saver) ipcMain.removeHandler(IPC.saveFile);
    ipcMain.removeAllListeners(IPC.titlebar);
    unregisterNotify?.();
  };
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
  const execute = async <R>(id: string, params?: unknown): Promise<ExecuteResult<R>> => {
    try {
      return (await ipc.invoke(IPC.execute, id, params)) as ExecuteResult<R>;
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
      const { title, body, target } = alert;
      if (typeof title !== "string" || typeof body !== "string" || typeof target !== "string") return;
      ipc.send(IPC.notify, { title, body, target });
    },
    onNotificationClick(listener) {
      const wrapped = (_e: unknown, target: unknown) => {
        if (typeof target === "string") listener(target);
      };
      ipc.on(IPC.notifyClick, wrapped);
      return () => void ipc.removeListener(IPC.notifyClick, wrapped);
    },
  };

  return api;
}
