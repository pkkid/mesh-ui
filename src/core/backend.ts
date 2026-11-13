/**
 * The Backend interface: what commands call instead of eero. Methods take ids
 * and model-shaped inputs and return model objects from model.ts. Two
 * implementations: `eero` (src/core/eero/backend) and `demo` (src/core/demo).
 * See docs/architecture/backends.md.
 *
 * Network-scoped methods take the network id first. Methods throw
 * `BackendError`, which the engine maps to an error code.
 *
 * The interface is split into one sub-interface per area, so each eero
 * backend area file implements exactly one of them. This file holds every
 * M1 method; later milestones add their writes here.
 */

import { BackendError } from "./errors";
import type * as M from "./model";

export { BackendError } from "./errors";

// ---------------------------------------------------------------------------
// Host contract

/**
 * Where the host keeps the session token (Electron safeStorage in the app
 * and CLI). Only the eero backend uses it; the token never leaves the
 * backend's process and is never returned by a command.
 */
export interface SecretStore {
  /** The saved token, or null. Deletes unreadable or plaintext files. */
  load(): Promise<string | null>;
  /** Saves when a real OS keychain exists; answers where it ended up. */
  save(token: string): Promise<M.SessionStorageKind>;
  clear(): Promise<void>;
  /** "keychain" when save would persist, else "memory". */
  storage(): Promise<M.SessionStorageKind>;
}

// ---------------------------------------------------------------------------
// Areas

/** Sign-in state as the backend sees it. The engine adds `backend`. */
export type AuthState = Omit<M.AuthStatus, "backend">;

export interface AuthBackend {
  status(): Promise<AuthState>;
  /** Sends a code to an email or E.164 phone; the session becomes pending. */
  start(login: string): Promise<void>;
  /** The session becomes signed in. A wrong code keeps it pending. */
  verify(code: string): Promise<void>;
  resend(): Promise<void>;
  /** Clears the local session first, then tells eero, best effort. */
  logout(): Promise<void>;
}

export interface AccountBackend {
  get(): Promise<M.Account>;
}

export interface NetworkBackend {
  /** `selected` is filled in by core; backends may leave it false. */
  list(): Promise<M.NetworkSummary[]>;
  get(net: M.Id): Promise<M.Network>;
  health(net: M.Id): Promise<M.NetworkHealth>;
  permissions(net: M.Id): Promise<M.Permissions>;
}

export type SpeedTestQuery = { from: M.Iso; to: M.Iso; limit: number };

export interface InternetBackend {
  /** `planMbps` comes from app settings and is filled in by core. */
  get(net: M.Id): Promise<Omit<M.Internet, "planMbps">>;
  /** Newest first. `rating` is computed in core, so backends leave it null. */
  speedTests(net: M.Id, q: SpeedTestQuery): Promise<M.SpeedTest[]>;
}

export type UsageQuery = {
  scope: M.UsageScope;
  /** Required for eero, device and profile scopes; null for network and guest. */
  id: M.Id | null;
  range: M.UsageRange;
  from: M.Iso;
  to: M.Iso;
  cadence: M.UsageCadence;
  /** IANA zone the buckets are aligned to. */
  timezone: string;
};

export type BreakdownQuery = {
  by: M.UsageBreakdown["by"];
  range: M.UsageRange;
  from: M.Iso;
  to: M.Iso;
};

export interface UsageBackend {
  series(net: M.Id, q: UsageQuery): Promise<M.UsageSeries>;
  /** Rows unsorted and without filtering; core sorts and computes shares. */
  breakdown(net: M.Id, q: BreakdownQuery): Promise<M.UsageBreakdown>;
}

export interface EeroBackend {
  list(net: M.Id): Promise<M.Eero[]>;
  get(net: M.Id, eero: M.Id): Promise<M.Eero>;
}

export interface DeviceBackend {
  /** Includes blocked devices (merged from the blacklist). */
  list(net: M.Id): Promise<M.Device[]>;
  get(net: M.Id, device: M.Id): Promise<M.Device>;
  /** Asks eero for a burst of live rates. Core enforces once a minute. */
  requestBurst(net: M.Id): Promise<M.BurstResult>;
}

export interface ProfileBackend {
  /** `nextChange` is computed in core; backends may leave it null. */
  list(net: M.Id): Promise<M.Profile[]>;
  get(net: M.Id, profile: M.Id): Promise<M.Profile>;
}

export type EventChunk = { events: M.NetworkEvent[]; nextCursor: string | null };

export interface EventsBackend {
  /** One page, newest first. `cursor` is the `nextCursor` of the previous page. */
  list(net: M.Id, cursor: string | null): Promise<EventChunk>;
}

// ---------------------------------------------------------------------------
// The whole backend

export interface BackendAreas {
  auth: AuthBackend;
  account: AccountBackend;
  network: NetworkBackend;
  internet: InternetBackend;
  usage: UsageBackend;
  eero: EeroBackend;
  device: DeviceBackend;
  profile: ProfileBackend;
  events: EventsBackend;
}

export type AreaName = keyof BackendAreas;

export const AREA_NAMES: readonly AreaName[] = [
  "auth",
  "account",
  "network",
  "internet",
  "usage",
  "eero",
  "device",
  "profile",
  "events",
];

export interface Backend extends BackendAreas {
  readonly kind: M.BackendKind;
  /** True when the eero backend talks to the local fake eero server (an injected origin). Unset for live and demo. */
  readonly fake?: true;
}

/**
 * An area whose every method throws `eero_error` "not available yet". Used to
 * fill areas that a backend does not implement yet, so the engine still runs.
 */
export function unimplementedArea<K extends AreaName>(kind: M.BackendKind, area: K): BackendAreas[K] {
  return new Proxy({} as BackendAreas[K], {
    get(_target, method) {
      if (typeof method !== "string") return undefined;
      return () => Promise.reject(new BackendError("eero_error", `${area}.${method} is not available in the ${kind} backend yet.`));
    },
  });
}

/** Builds a Backend from the areas given, filling the rest with `unimplementedArea`. */
export function composeBackend(kind: M.BackendKind, areas: Partial<BackendAreas>): Backend {
  const full = { kind } as { kind: M.BackendKind } & Record<AreaName, unknown>;
  for (const name of AREA_NAMES) full[name] = areas[name] ?? unimplementedArea(kind, name);
  return full as Backend;
}
