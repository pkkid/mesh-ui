/**
 * The eero backend: one file per area in this folder, each exporting a
 * factory named after its area (`export const network: EeroArea<"network">`).
 * Areas not registered yet answer "not available yet" (composeBackend): in
 * M3 that is guest, wifi, settings, diagnostics, admins, integrations and
 * notifications until each story adds its file and one line below.
 */

import { type AreaName, type Backend, type BackendAreas, composeBackend, type SecretStore } from "../../backend";
import { EeroClient, type RequestLogEntry } from "../client";
import type { RateLimiter } from "../ratelimit";

export type EeroBackendOptions = {
  /** Host session store; the token never leaves this backend. */
  secrets: SecretStore;
  /** null or absent: the default app-like User-Agent. */
  userAgent?: string | null;
  /** Dev and test only: origin of the fake eero server. Release builds never set it. */
  origin?: string;
  /** Tests only: an in-process fetch, e.g. the fake eero server's. */
  fetch?: typeof fetch;
  /** Tests only: a limiter of their own instead of the default budget. */
  limiter?: RateLimiter;
  /** How long identical GETs share an answer; see READ_SHARE_MS. */
  readShareMs?: number;
  onLog?: (entry: RequestLogEntry) => void;
  onSessionChange?: (signedIn: boolean) => void;
};

/** Shared by every area. Areas call eero only through `client`. */
export type EeroContext = {
  readonly options: EeroBackendOptions;
  readonly client: EeroClient;
};

export type EeroArea<K extends AreaName> = (ctx: EeroContext) => BackendAreas[K];

// Area imports, one line each, alphabetical: import { network } from "./network";
import { account } from "./account";
import { auth } from "./auth";
import { device } from "./device";
import { eero } from "./eero";
import { events } from "./events";
import { guest } from "./guest";
import { internet } from "./internet";
import { network } from "./network";
import { notifications } from "./notifications";
import { profile } from "./profile";
import { routing } from "./routing";
import { updates } from "./updates";
import { usage } from "./usage";

/** Area factories, one line each, alphabetical. */
const areas: { [K in AreaName]?: EeroArea<K> } = {
  account,
  auth,
  device,
  eero,
  events,
  guest,
  internet,
  network,
  notifications,
  profile,
  routing,
  updates,
  usage,
};

export function createEeroBackend(options: EeroBackendOptions): Backend {
  const client = new EeroClient(options);
  const ctx: EeroContext = { options, client };
  const built: Partial<Record<AreaName, unknown>> = {};
  for (const [name, factory] of Object.entries(areas) as [AreaName, EeroArea<AreaName>][]) built[name] = factory(ctx);
  const backend = composeBackend("eero", built as Partial<BackendAreas>);
  // checkOrigin only admits loopback origins, so an injected origin is the fake server.
  return options.origin === undefined ? backend : { ...backend, fake: true };
}
