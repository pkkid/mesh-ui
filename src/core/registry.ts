/**
 * Collects every CommandSpec, adds the shared params (`networkId`,
 * `confirm`) and builds the JSON Schema surfaces show. Fails at startup on a
 * duplicate or badly formed id.
 */

import { z } from "zod";
import * as areas from "./commands";
import type { BackendKind, Effect } from "./model";
import { type AnyCommand, COMMAND_ID, confirmParam, needsConfirm, networkIdParam, type Scope } from "./spec";

export type JsonSchema = Record<string, unknown>;

/** What `engine.commands()`, `mesh-ui commands` and the MCP tool list show. */
export type CommandInfo = {
  id: string;
  label: string;
  description: string | null;
  icon: string | null;
  effect: Effect;
  scope: Scope;
  sensitive: boolean;
  poll: number | null;
  /** JSON Schema of the params, including networkId and confirm. */
  params: JsonSchema;
};

export type RegisteredCommand = {
  spec: AnyCommand;
  scope: Scope;
  /** The spec's params plus networkId and confirm, strict (unknown keys fail). */
  schema: z.ZodObject;
  info: CommandInfo;
};

export interface Registry {
  get(id: string): RegisteredCommand | undefined;
  list(): RegisteredCommand[];
  describe(): CommandInfo[];
}

/** Every spec from src/core/commands, in area order. */
export function allCommands(): AnyCommand[] {
  return Object.values(areas as Record<string, AnyCommand[]>).flat();
}

function register(spec: AnyCommand): RegisteredCommand {
  if (!COMMAND_ID.test(spec.id)) throw new Error(`Bad command id "${spec.id}"`);
  if (!spec.label) throw new Error(`Command ${spec.id} has no label`);
  if (!(spec.params instanceof z.ZodObject)) throw new Error(`Command ${spec.id} params must be a z.object`);
  const scope: Scope = spec.scope ?? "network";
  const extra: Record<string, z.ZodType> = {};
  if (scope === "network") extra.networkId = networkIdParam;
  if (needsConfirm(spec.effect)) extra.confirm = confirmParam;
  for (const key of Object.keys(extra)) {
    if (key in spec.params.shape) throw new Error(`Command ${spec.id} must not declare "${key}"; the registry adds it`);
  }
  const schema = spec.params.extend(extra).strict();
  const info: CommandInfo = {
    id: spec.id,
    label: spec.label,
    description: spec.description ?? null,
    icon: spec.icon ?? null,
    effect: spec.effect,
    scope,
    sensitive: spec.sensitive === true,
    poll: spec.poll ?? null,
    params: z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema,
  };
  return { spec, scope, schema, info };
}

/**
 * Builds a registry. Specs limited to one backend (`spec.backend`) are left
 * out unless `backend` matches.
 */
export function createRegistry(specs: AnyCommand[] = allCommands(), opts: { backend?: BackendKind } = {}): Registry {
  const byId = new Map<string, RegisteredCommand>();
  for (const spec of specs) {
    if (spec.backend && spec.backend !== opts.backend) continue;
    if (byId.has(spec.id)) throw new Error(`Duplicate command id "${spec.id}"`);
    byId.set(spec.id, register(spec));
  }
  const list = [...byId.values()];
  return {
    get: (id) => byId.get(id),
    list: () => list,
    describe: () => list.map((c) => c.info),
  };
}
