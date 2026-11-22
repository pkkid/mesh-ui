/**
 * Types shared by main, preload and renderer: the `window.mesh` bridge
 * (docs/architecture/ui.md#the-bridge-windowmesh). The data model itself
 * lives in src/core/model.ts; this file only re-exports what crosses the
 * bridge. Nothing here may carry the session token.
 */

import type { ExecuteOptions } from "../core/engine";
import type { ExecuteError, ExecuteResult } from "../core/errors";
import type { HostEvent, SessionStorageKind } from "../core/model";
import type { CommandInfo } from "../core/registry";
import type { InspectRecord } from "../core/eero/inspect";

export type { CommandInfo, ExecuteError, ExecuteOptions, ExecuteResult, HostEvent };

/** IPC channel names: one per bridge call, plus one outbound event channel. */
export const IPC = {
  execute: "mesh:execute",
  commands: "mesh:commands",
  event: "mesh:event",
  titlebar: "mesh:titlebar",
  saveFile: "mesh:save-file",
  notify: "mesh:notify",
  notifyClick: "mesh:notify-click",
  caughtKey: "mesh:caught-key",
  themeSearch: "mesh:theme-search",
  themeDownload: "mesh:theme-download",
  devtoolsCapture: "mesh:devtools-capture",
  devtoolsRecord: "mesh:devtools-record",
  devtoolsOpen: "mesh:devtools-open",
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

/** Open VSX sort orders for theme search. */
export const THEME_SEARCH_SORTS = ["downloadCount", "rating", "timestamp", "relevance"] as const;
export type ThemeSearchSort = (typeof THEME_SEARCH_SORTS)[number];

/** A theme extension on Open VSX that Mesh UI can install (permissive licence, has colour themes). */
export type ThemeExtension = {
  /** `namespace.name`, e.g. `jdinhlife.gruvbox`. */
  id: string;
  name: string;
  publisher: string;
  description: string;
  version: string;
  license: string;
  downloadCount: number;
  themeCount: number;
};

/** One colour theme from an extension, trimmed to the colours Mesh UI reads. */
export type ThemeFile = {
  /** The extension's label for it ("Gruvbox Dark Hard"). */
  label: string;
  appearance: "light" | "dark" | null;
  theme: Record<string, unknown>;
};

export type ThemeSearchResult = { ok: true; extensions: ThemeExtension[] } | { ok: false; message: string };
export type ThemeDownloadResult =
  | { ok: true; extension: ThemeExtension; themes: ThemeFile[] }
  | { ok: false; message: string };

/** Where the eero session is kept: the OS keychain, or memory for this launch. */
export type SessionStorage = SessionStorageKind;

/** The API the preload script exposes to the renderer as `window.mesh`. */
export type MeshApi = {
  platform: "darwin" | "linux" | "win32" | (string & {});
  /**
   * The only data path. Never throws; IPC failures come back as `network_error`.
   * `{ fresh: true }` skips the engine's cached answer for a query (Refresh).
   */
  execute<R = unknown>(id: string, params?: unknown, options?: ExecuteOptions): Promise<ExecuteResult<R>>;
  /**
   * A key combination main caught before the page could see it (Ctrl+R, Cmd+R or F5, which would otherwise reload
   * the window), as shortcut text ("ctrl+KeyR", "F5"). The renderer's shortcut registry runs whatever is bound to
   * it. Returns an unsubscribe.
   */
  onCaughtKey(listener: (combo: string) => void): () => void;
  /** The command registry as JSON. */
  commands(): Promise<CommandInfo[]>;
  /** Host events (session.changed, network.selected, update.changed). Returns an unsubscribe. */
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
  /**
   * Searches Open VSX for colour themes (main fetches; the renderer stays
   * offline). Not a command: themes are view state. Never throws.
   */
  searchThemes(query: string, sort: ThemeSearchSort): Promise<ThemeSearchResult>;
  /** Downloads, verifies and unpacks one Open VSX theme extension. Never throws. */
  downloadThemes(extensionId: string): Promise<ThemeDownloadResult>;
  /**
   * The F12 dev tools panel (docs/architecture/devtools.md). Not a command,
   * so the CLI and MCP cannot reach it. `capture(true)` starts recording eero
   * requests (redacted: never the session token) and `capture(false)` stops
   * it; `available` is false where there are no eero requests (demo mode).
   */
  devtools: {
    capture(on: boolean): Promise<{ available: boolean }>;
    /** One request, sent when it starts and again as it completes (same id). Returns an unsubscribe. */
    onRecord(listener: (record: InspectRecord) => void): () => void;
    /** Opens Electron's own developer tools, docked to the right of the window. */
    openElectron(): void;
  };
};
