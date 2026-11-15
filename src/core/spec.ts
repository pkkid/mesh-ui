/**
 * The command spec and the context a command runs with. One file per area in
 * src/core/commands/<area>.ts exports an array of specs built with
 * `defineCommand`. See docs/architecture/commands.md#the-spec.
 */

import { z } from "zod";
import type { Backend } from "./backend";
import type { AppSettings, BackendKind, CliStatus, Effect, HostEvent, Id, InstallKind, Permission, Permissions, Role, UpdateStatus } from "./model";
import type { Topic } from "./poll";

export type { Effect } from "./model";
export type { Topic } from "./poll";

export type Scope = "network" | "account" | "app";
export type Surface = "ui" | "cli" | "mcp";

/** Object kinds the engine can resolve from an id or a name. */
export type RefKind = "network" | "eero" | "device" | "profile";

export type RefCandidate = { id: Id; names: (string | null | undefined)[] };

/** App settings persisted by the host (settings.json). Never holds the token. */
export interface SettingsStore {
  get(): Promise<AppSettings>;
  update(patch: Partial<AppSettings>): Promise<AppSettings>;
}

/**
 * What only the Mesh UI window can do: the updater, putting the CLI on PATH
 * and relaunching. The Electron host gives them to the window's engine
 * (src/main/host-actions.ts); the CLI and MCP hosts give none, so the
 * commands that need them answer `bad_params` there (`HOST_ONLY`).
 */
export type HostActions = {
  update?: {
    /** The updater's state now. */
    status(): Promise<UpdateStatus>;
    /** Checks now and answers with the state after the check starts or ends. */
    check(): Promise<UpdateStatus>;
    /** Quits and installs a downloaded update (state `ready`). Only on request, never on its own. */
    install(): Promise<void>;
  };
  cli?: {
    status(): Promise<CliStatus>;
    install(): Promise<CliStatus>;
  };
  relaunch?: {
    /** Restarts Mesh UI in or out of demo mode. */
    demo(enabled: boolean): Promise<void>;
  };
  logs?: {
    /** Shows the eero request log in the file manager (its folder when there is no log yet). */
    showRequestLog(): Promise<{ path: string; exists: boolean }>;
  };
  amazon?: {
    /**
     * Opens the private Amazon sign-in window, exchanges the authorization
     * code, and resolves with an Amazon access token. Never returns the
     * token to the renderer; the command passes it to the backend only.
     */
    signIn(): Promise<string>;
  };
};

export const HOST_ONLY = "Only in the Mesh UI window.";

/** What the host tells the engine about itself, for app.info. */
export type HostInfo = {
  version: string;
  /** null under a plain Node host (tests). */
  electron: string | null;
  configDir: string | null;
  keychainName: string | null;
  /** Default `dev`. */
  install: InstallKind;
  actions?: HostActions;
};

export interface CommandContext {
  readonly backend: Backend;
  readonly surface: Surface;
  readonly host: HostInfo;
  readonly settings: SettingsStore;
  /** The network this call acts on (from `networkId` or the selection); null outside network scope. */
  readonly networkId: Id | null;
  /** Same as networkId, but throws bad_params when there is none. */
  readonly net: Id;
  /** The network selected in the session. */
  readonly selectedNetworkId: Id | null;
  /** Sets the selected network, saves it as lastNetworkId and emits network.selected. */
  selectNetwork(id: Id): Promise<void>;
  /** An id or exact case-insensitive name to an id. No match or several: bad_params. */
  resolve(kind: RefKind, ref: string): Promise<Id>;
  /** Same matching rules against any list, for kinds the engine does not know. */
  match(ref: string, candidates: RefCandidate[], kind?: string): Id;
  /** Epoch ms from the engine clock. */
  now(): number;
  /** Marks cached topics stale now, or at `atMs` (e.g. after a burst settles). */
  invalidate(topics: Topic[], atMs?: number): void;
  /** Sends a host event to listeners (the UI). Never eero data or the token. */
  emit(event: HostEvent): void;
}

/** Which `network.permissions` operation a write needs. */
export type GateOp = "create" | "update" | "delete";

/**
 * What a write needs to run on a network, declared on its spec so every
 * surface reads the same rule (docs/ux/overview.md#permission-gating). The
 * palette and pages dim with the reason; the engine and eero still have the
 * last word when it runs. Every non-query command declares one; `{ area:
 * null }` for writes no permission, mode or capability limits (sign-in,
 * app-local settings).
 */
export type WriteGate = {
  /** `network.permissions` `can` key (`devices`, `eeros`, `profiles`, `settings`, `network`), or null for none. */
  area: string | null;
  /** Default `update`. */
  op?: GateOp;
  /** Off in bridge and IP passthrough mode (eero has no router there). */
  bridgeOff?: true;
  /** A `network.get` capability that must be true. */
  capability?: string;
};

/** A gate with its defaults filled in, as `CommandInfo.gate` lists it. */
export type ResolvedGate = { area: string | null; op: GateOp; bridgeOff: boolean; capability: string | null };

export const resolveGate = (g: WriteGate): ResolvedGate => ({
  area: g.area,
  op: g.op ?? "update",
  bridgeOff: g.bridgeOff === true,
  capability: g.capability ?? null,
});

export const OWNER_ONLY = "Owner only";

/**
 * The owner-only rule for destructive commands, shared by core
 * (`network.delete`), the palette and pages: refused with `OWNER_ONLY` for a
 * known non-owner (an admin), null otherwise. A real owner maps to `owner`
 * (eero sends `network-owner`); an unknown role (null: eero sent no
 * permissions) is left to the permission gate and eero, so a failed read
 * never locks the owner out.
 */
export function ownerOnly(role: Role | null | undefined): string | null {
  return role && role !== "owner" ? OWNER_ONLY : null;
}

/**
 * The permission a gate's `area` resolves to, or null when eero reports
 * nothing that covers it (then permission does not gate; the engine and eero
 * decide). A real `{net}/permissions` sends only `network`, `eeros` and
 * dotted keys (`network.proxied_nodes`), so (docs/architecture/data-model.md#permissions):
 *
 * 1. A key eero sends is used as sent.
 * 2. A dotted key it does not send inherits its nearest sent parent
 *    (`network.subnets.main.password` from `network.subnets`, then `network`).
 * 3. An area it does not send (`devices`, `profiles`, `settings`) inherits
 *    `network`, as do dotted keys with no sent parent.
 *
 * An inherited permission is the parent's `update` for every op: who may
 * change the network may change what is in it. (`network.create` is false
 * even for the owner; it means creating a network.)
 */
export function permissionFor(permissions: Pick<Permissions, "can">, area: string): Permission | null {
  const own = permissions.can[area];
  if (own) return own;
  const parts = area.split(".");
  const parents = parts.slice(0, -1).map((_, i) => parts.slice(0, parts.length - 1 - i).join("."));
  if (parts[0] !== "network") parents.push("network");
  for (const key of parents) {
    const p = permissions.can[key];
    if (p) return { read: p.read, create: p.update, update: p.update, delete: p.update };
  }
  return null;
}

export interface CommandSpec<P extends z.ZodObject = z.ZodObject, R = unknown> {
  /** Dotted lowercase: area.verb or area.object.verb. */
  id: string;
  /** Short sentence case English, the palette label. */
  label: string;
  /** One or two sentences; for disruptive and destructive, names the outage or loss. */
  description?: string;
  /** lucide icon name. */
  icon?: string;
  /** zod object schema. The registry adds `networkId` and `confirm` where they apply. */
  params: P;
  effect: Effect;
  /** Default "network". */
  scope?: Scope;
  /** Query: cache topic it reads. Queries without a topic are not cached. */
  topic?: Topic;
  /** Query: cache lifetime override in seconds (0 = do not cache). Default from TTL[topic]. */
  ttl?: number | ((params: z.output<P>) => number);
  /** Write: what it needs to run here (permission, bridge mode, capability). Required for every non-query command (registry.test.ts). */
  gate?: WriteGate;
  /** Write: topics to mark stale after success. */
  invalidates?: Topic[];
  /** The result holds a credential. Never cached; masked by the CLI. */
  sensitive?: true;
  /** Query: poll interval in seconds, from POLL in poll.ts. */
  poll?: number;
  /** Register only with this backend (demo.scenario.set). */
  backend?: BackendKind;
  /** needs_confirm message. Default is built from the label and effect. */
  confirmMessage?(ctx: CommandContext, params: z.output<P>): string | Promise<string>;
  /**
   * A `write` that takes devices offline only in some cases (moving a device
   * into a paused profile): the needs_confirm message when this run would,
   * or null when nothing goes offline. Checked before `run` unless params
   * have `confirm: true`; the registry adds an optional `confirm` param.
   */
  confirmWhen?(ctx: CommandContext, params: z.output<P>): Promise<string | null>;
  run(ctx: CommandContext, params: z.output<P>): Promise<R>;
}

/** Any spec, for lists of specs with different params and results. */
export type AnyCommand = CommandSpec<any, any>;

/** Identity helper that infers params and result types. */
export function defineCommand<P extends z.ZodObject, R>(spec: CommandSpec<P, R>): CommandSpec<P, R> {
  return spec;
}

/** A Ref param: an id or an exact, case-insensitive name. */
export function ref(kind: string) {
  return z.string().trim().min(1).describe(`A ${kind} id or exact name (case-insensitive).`);
}

/** Every network-scoped command accepts this; the registry adds it. */
export const networkIdParam = ref("network").optional();

/** Added by the registry to every disruptive and destructive command. Only true passes. */
export const confirmParam = z.boolean().optional().describe("Must be true to run this command.");

/** Added by the registry to writes with `confirmWhen`. Only needed when the run would take devices offline. */
export const confirmWhenParam = z
  .boolean()
  .optional()
  .describe("Must be true when this run would take devices offline (the command answers needs_confirm saying which).");

export const needsConfirm = (effect: Effect): boolean => effect === "disruptive" || effect === "destructive";

/** Command id rule: dotted lowercase, 2 or 3 parts, snake_case words. */
export const COMMAND_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/;
