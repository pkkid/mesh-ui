/**
 * The eero backend: one file per area in this folder, each exporting a
 * factory named after its area (`export const network: EeroArea<"network">`).
 * Areas not registered yet answer "not available yet" (composeBackend);
 * since M3.12 every area is registered. Write methods (WRITE_METHODS in
 * backend.ts) an area does not have yet answer the same (partialArea).
 */

import { type AreaName, type Backend, composeBackend, type PartialWrites, type SecretStore } from "../../backend";
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

/** Every read of the area; its M4 writes may come one at a time (missing ones answer "not available yet"). */
export type EeroArea<K extends AreaName> = (ctx: EeroContext) => PartialWrites<K>;

// Area imports, one line each, alphabetical: import { network } from "./network";
import { account } from "./account";
import { admins } from "./admins";
import { auth } from "./auth";
import { device } from "./device";
import { diagnostics } from "./diagnostics";
import { eero } from "./eero";
import { events } from "./events";
import { guest } from "./guest";
import { integrations } from "./integrations";
import { internet } from "./internet";
import { network } from "./network";
import { notifications } from "./notifications";
import { profile } from "./profile";
import { routing } from "./routing";
import { settings } from "./settings";
import { updates } from "./updates";
import { usage } from "./usage";
import { wifi } from "./wifi";

/** Area factories, one line each, alphabetical. */
const areas: { [K in AreaName]?: EeroArea<K> } = {
  account,
  admins,
  auth,
  device,
  diagnostics,
  eero,
  events,
  guest,
  integrations,
  internet,
  network,
  notifications,
  profile,
  routing,
  settings,
  updates,
  usage,
  wifi,
};

export function createEeroBackend(options: EeroBackendOptions): Backend {
  const client = new EeroClient(options);
  const ctx: EeroContext = { options, client };
  const built: Partial<Record<AreaName, unknown>> = {};
  for (const [name, factory] of Object.entries(areas) as [AreaName, EeroArea<AreaName>][]) built[name] = factory(ctx);
  // composeBackend wraps each area in partialArea, so unbuilt writes answer "not available yet".
  const backend = composeBackend("eero", built as Parameters<typeof composeBackend>[1]);
  // checkOrigin only admits loopback origins, so an injected origin is the fake server.
  return options.origin === undefined ? backend : { ...backend, fake: true };
}
