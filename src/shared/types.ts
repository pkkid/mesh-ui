/** Data shapes shared between the main process and the renderer. */

export type Device = {
  id: string;
  name: string;
  ip: string | null;
  mac: string | null;
  manufacturer: string | null;
  connected: boolean;
  wireless: boolean;
  /** Wi-Fi band in GHz, e.g. "5" or "2.4". */
  frequency: string | null;
  /** Location name of the eero node this device is attached to. */
  via: string | null;
};

export type Network = {
  id: string;
  name: string;
  devices: Device[];
};

export type TitlebarColors = {
  color: string;
  symbolColor: string;
};

/**
 * Where the eero session is kept: encrypted in the OS keychain-backed store,
 * or in memory only (sign in again each launch) when no keychain is available.
 */
export type SessionStorage = "keychain" | "memory";

/** The API the preload script exposes to the renderer as `window.mesh`. */
export type MeshApi = {
  platform: "darwin" | "linux" | "win32" | (string & {});
  startLogin(login: string): Promise<void>;
  verify(code: string): Promise<void>;
  /** Returns null when there is no saved session. */
  load(): Promise<Network[] | null>;
  /** Ends the session with eero, then forgets it locally. */
  logout(): Promise<void>;
  sessionStorage(): Promise<SessionStorage>;
  setTitlebarColors(colors: TitlebarColors): void;
};
