/**
 * The command spec and the context a command runs with. One file per area in
 * src/core/commands/<area>.ts exports an array of specs built with
 * `defineCommand`. See docs/architecture/commands.md#the-spec.
 */

import { z } from "zod";
import type { Backend } from "./backend";
import type { AppSettings, BackendKind, Effect, HostEvent, Id } from "./model";
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

/** What the host tells the engine about itself, for app.info. */
export type HostInfo = {
  version: string;
  /** null under a plain Node host (tests). */
  electron: string | null;
  configDir: string | null;
  keychainName: string | null;
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

export const needsConfirm = (effect: Effect): boolean => effect === "disruptive" || effect === "destructive";

/** Command id rule: dotted lowercase, 2 or 3 parts, snake_case words. */
export const COMMAND_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/;
