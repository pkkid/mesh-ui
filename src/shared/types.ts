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
} as const;

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
};

// ---------------------------------------------------------------------------
// Prototype bridge, kept only so the prototype renderer still compiles until
// M1.7 (app shell) and M1.9 (sign-in) move every page to `execute`. These
// calls never reach eero: `load` reports signed out and sign-in answers that
// it is not available yet. Remove once nothing uses them.

/** @deprecated Prototype device shape; pages use src/core/model.ts. */
export type Device = {
  id: string;
  name: string;
  ip: string | null;
  mac: string | null;
  manufacturer: string | null;
  connected: boolean;
  wireless: boolean;
  frequency: string | null;
  via: string | null;
};

/** @deprecated Prototype network shape; pages use src/core/model.ts. */
export type Network = { id: string; name: string; devices: Device[] };

/** @deprecated Use `execute` with the auth and network commands. */
export type LegacyMeshApi = {
  startLogin(login: string): Promise<void>;
  verify(code: string): Promise<void>;
  load(): Promise<Network[] | null>;
  logout(): Promise<void>;
  sessionStorage(): Promise<SessionStorage>;
};
