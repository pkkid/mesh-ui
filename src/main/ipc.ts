/**
 * Both halves of the `window.mesh` IPC protocol (docs/architecture/ui.md#the-bridge-windowmesh):
 *
 * - `registerIpc` (main): `mesh:execute` and `mesh:commands` call the engine,
 *   engine host events go out on `mesh:event`, and `mesh:titlebar` sets the
 *   overlay colours. Requests from anything but the app's own pages are
 *   refused.
 * - `createMeshBridge` (preload): the `window.mesh` object.
 *
 * Only engine results, the registry listing and host events cross this
 * boundary. The engine never returns the token, so neither does IPC.
 * No Electron values are imported here, so tests can drive both halves.
 */

import type { Engine } from "../core/engine";
import type { ExecuteResult } from "../core/errors";
import type { HostEvent } from "../core/model";
import { IPC, type LegacyMeshApi, type MeshApi, type TitlebarColors } from "../shared/types";

// ---------------------------------------------------------------------------
// Main side

type SenderEvent = { senderFrame?: { url: string } | null };

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
};

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

  const unsubscribe = opts.engine.onEvent((event) => opts.broadcast(IPC.event, event));

  return () => {
    unsubscribe();
    ipcMain.removeHandler(IPC.execute);
    ipcMain.removeHandler(IPC.commands);
    ipcMain.removeAllListeners(IPC.titlebar);
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

export function createMeshBridge(ipc: IpcRendererLike, platform: string): MeshApi & LegacyMeshApi {
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
  };

  // Prototype calls (see LegacyMeshApi). They never reach eero.
  const unavailable = () => Promise.reject(new Error("Sign-in is not available in this build yet."));
  const legacy: LegacyMeshApi = {
    startLogin: unavailable,
    verify: unavailable,
    load: async () => null,
    logout: async () => {
      await execute("auth.logout");
    },
    sessionStorage: async () => {
      const status = await execute<{ storage?: unknown }>("auth.status");
      return status.ok && status.result.storage === "keychain" ? "keychain" : "memory";
    },
  };

  return { ...api, ...legacy };
}
