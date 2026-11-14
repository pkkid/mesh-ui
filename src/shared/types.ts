/**
 * Types shared by main, preload and renderer: the `window.mesh` bridge
 * (docs/architecture/ui.md#the-bridge-windowmesh). The data model itself
 * lives in src/core/model.ts; this file only re-exports what crosses the
 * bridge. Nothing here may carry the session token.
 */

import type { ExecuteError, ExecuteResult } from "../core/errors";
import type { HostEvent, SessionStorageKind } from "../core/model";
import type { CommandInfo } from "../core/registry";

export type { CommandInfo, ExecuteError, ExecuteResult, HostEvent };

/** IPC channel names: one per bridge call, plus one outbound event channel. */
export const IPC = {
  execute: "mesh:execute",
  commands: "mesh:commands",
  event: "mesh:event",
  titlebar: "mesh:titlebar",
  saveFile: "mesh:save-file",
  notify: "mesh:notify",
  notifyClick: "mesh:notify-click",
} as const;

/**
 * Where a clicked desktop alert leads: the app's own hash path ("/eeros") on
 * the network the alert came from. Main hands it back unchanged on
 * `mesh:notify-click`.
 */
export type AlertTarget = { target: string; networkId: string };

/** One desktop alert the renderer asks the host to show. */
export type DesktopAlert = AlertTarget & { title: string; body: string };

/**
 * What `saveFile` reports. Never the path: the renderer learns only the file
 * name the user chose, to say "Saved speed-tests.csv".
 */
export type SaveFileResult =
  | { status: "saved"; name: string }
  | { status: "canceled" }
  | { status: "failed"; message: string };

export type TitlebarColors = {
  color: string;
  symbolColor: string;
};

/** Where the eero session is kept: the OS keychain, or memory for this launch. */
export type SessionStorage = SessionStorageKind;

/** The API the preload script exposes to the renderer as `window.mesh`. */
export type MeshApi = {
  platform: "darwin" | "linux" | "win32" | (string & {});
  /** The only data path. Never throws; IPC failures come back as `network_error`. */
  execute<R = unknown>(id: string, params?: unknown): Promise<ExecuteResult<R>>;
  /** The command registry as JSON. */
  commands(): Promise<CommandInfo[]>;
  /** Host events (session.changed, network.selected, update.ready). Returns an unsubscribe. */
  on(listener: (event: HostEvent) => void): () => void;
  /** Window-only, not a command. */
  setTitlebarColors(colors: TitlebarColors): void;
  /**
   * Saves text (CSV, JSON, logs) to a file the user picks in the native save
   * dialog; `name` is only the suggested file name. Not a command: it reads
   * nothing from eero. Never throws.
   */
  saveFile(name: string, text: string): Promise<SaveFileResult>;
  /** Shows one OS notification through the host. Not a command; fire and forget. */
  notify(alert: DesktopAlert): void;
  /** A desktop alert was clicked: the window is focused, open its target on its network. Returns an unsubscribe. */
  onNotificationClick(listener: (click: AlertTarget) => void): () => void;
};
