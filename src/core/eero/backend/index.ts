/**
 * The eero backend: one file per area in this folder, each exporting a
 * factory named after its area (`export const network: EeroArea<"network">`).
 * Areas not registered yet answer "not available yet".
 */

import { type AreaName, type Backend, type BackendAreas, composeBackend, type SecretStore } from "../../backend";

export type EeroBackendOptions = {
  /** Host session store; the token never leaves this backend. */
  secrets: SecretStore;
  /** null or absent: the default app-like User-Agent. */
  userAgent?: string | null;
  /** Dev and test only: origin of the fake eero server. Release builds never set it. */
  origin?: string;
};

/** Shared by every area. The HTTP client (M1.2) is added here. */
export type EeroContext = {
  readonly options: EeroBackendOptions;
};

export type EeroArea<K extends AreaName> = (ctx: EeroContext) => BackendAreas[K];

// Area imports, one line each, alphabetical: import { network } from "./network";

/** Area factories, one line each, alphabetical. */
const areas: { [K in AreaName]?: EeroArea<K> } = {};

export function createEeroBackend(options: EeroBackendOptions): Backend {
  const ctx: EeroContext = { options };
  const built: Partial<Record<AreaName, unknown>> = {};
  for (const [name, factory] of Object.entries(areas) as [AreaName, EeroArea<AreaName>][]) built[name] = factory(ctx);
  return composeBackend("eero", built as Partial<BackendAreas>);
}
