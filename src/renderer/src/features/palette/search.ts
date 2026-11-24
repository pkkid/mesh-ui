/**
 * The command palette's pure logic (docs/ux/pages/command-palette.md): the
 * result items, matching and ranking, scope counts, `>` id mode, params
 * fields and defaults read from a command's JSON Schema, and the CLI and MCP
 * text shown in the preview. No React and no `window.mesh`, so it is unit
 * tested in Node (search.test.ts).
 *
 * Everything about a command comes from the registry (`CommandInfo`); this
 * file only decides how to find and describe it.
 */
import { z } from "zod";

import { toolName } from "../../../../core/mcpNames";
import type { Device, Effect, Eero, Network, Permissions, ProfileList } from "../../../../core/model";
import type { CommandInfo, JsonSchema } from "../../../../core/registry";
import { allows } from "../../../../core/access";
import type { AccessLevel } from "../../../../core/model";
import { needsConfirm, ownerOnly } from "../../../../core/spec";
import { type GateOptions, gateFor, type WriteRequest } from "../../app/useWrite";

// ---------------------------------------------------------------------------
// Items

export type CommandItem = {
  kind: "command";
  key: string;
  info: CommandInfo;
  /** The registry label, or the preset's own label. */
  label: string;
  /** Preset params (`device.list {"status":"online"}`); `{}` for the plain command. */
  params: Record<string, unknown>;
  /** Why it cannot run here ("Owner only", "Off in bridge mode"), or null. */
  unavailable: string | null;
  /** Whether the command line's and MCP's access levels allow it: the preview shows only those calls. */
  cli: boolean;
  mcp: boolean;
};

/**
 * A place: a page, or a section or settings row on one (Places). `anchor` is the section's or row's `data-place`
 * (lib/places.ts); `context` names the page it is on.
 */
export type PageItem = {
  kind: "page";
  key: string;
  label: string;
  path: string;
  routeId: string;
  anchor?: string;
  context?: string;
  /** Other words a page is found by (RouteDef.keywords), ranked as a context match. */
  keywords?: string;
  place?: "page" | "section" | "setting";
};

export type DeviceItem = {
  kind: "device";
  key: string;
  id: string;
  label: string;
  device: Device;
  /** "Paused", "Blocked", "Offline", or null when online. */
  state: string | null;
  /** "Mia · Upstairs Hall". */
  context: string;
  /** The eero it is on ("Upstairs Hall"), shown alone by the detail page switcher. */
  eero: string | null;
};

export type ProfileItem = {
  kind: "profile";
  key: string;
  id: string;
  label: string;
  state: "Paused" | "Scheduled" | null;
  context: string;
};

export type EeroItem = {
  kind: "eero";
  key: string;
  id: string;
  /** The eero's location ("Basement"). */
  label: string;
  eero: Eero;
  /** "eero Pro 7 · 4 devices". The status shows beside it as a dot. */
  context: string;
};

export type Item = CommandItem | PageItem | EeroItem | DeviceItem | ProfileItem;
export type Kind = Item["kind"];
export type Scope = "all" | Kind;

/** Group order in the result list and the scope chips. */
export const KINDS: ReadonlyArray<Kind> = ["command", "page", "eero", "device", "profile"];

export type CommandPreset = { id: string; label: string; params: Record<string, unknown> };

/**
 * Commands with preset params, listed beside the plain command. Renderer only
 * (like shortcuts): the registry has no notion of presets.
 */
export const PRESETS: ReadonlyArray<CommandPreset> = [
  { id: "device.list", label: "List online devices", params: { status: "online" } },
  { id: "device.list", label: "List paused devices", params: { status: "paused" } },
  { id: "device.list", label: "List offline devices", params: { status: "offline" } },
];

/** Commands that need a person and a window, so the palette does not offer them. */
const HIDDEN = new Set(["auth.login.start", "auth.login.verify", "auth.login.resend", "auth.login.amazon"]);

export type AvailabilityContext = {
  signedIn: boolean;
  permissions: Permissions | null;
  /** The open network, for capability and bridge mode gates. */
  network?: Network | null;
  /** The command line and MCP access levels (Settings); missing means both full. */
  access?: Access;
};

/** The two access levels the palette follows (docs/architecture/security.md#access-levels). */
export type Access = { cli: AccessLevel; mcp: AccessLevel };

/** Whether each surface's level allows a command: the palette lists it only when one does. */
export function surfacesFor(info: Pick<CommandInfo, "effect" | "sensitive">, access: Access | undefined): { cli: boolean; mcp: boolean } {
  if (!access) return { cli: true, mcp: true };
  return { cli: allows(access.cli, info.effect, info.sensitive), mcp: allows(access.mcp, info.effect, info.sensitive) };
}

/** Why the palette cannot run a command the command line's level does not allow; it runs as the CLI would. */
export function cliRefusal(access: Access | undefined): string {
  return access?.cli === "off" ? "The command line is off in Settings" : "The command line's access in Settings does not allow this";
}

/**
 * What a write needs to run on this network, from its spec's `gate`
 * (src/core/spec.ts, listed by `mesh-ui commands`). Null for queries and
 * commands outside a network.
 */
export function commandGate(info: Pick<CommandInfo, "effect" | "scope" | "gate">): GateOptions | null {
  if (info.effect === "query" || info.scope !== "network" || !info.gate) return null;
  const { area, op, bridgeOff, capability } = info.gate;
  return { area: area ?? undefined, op, bridgeOff, capability: capability ?? undefined };
}

/**
 * Why a command cannot run here, or null when it can: destructive commands
 * are owner only, then the spec's gate (role and permission, bridge mode,
 * capability). The palette and pages (`useGate(id)` in components/ui/page)
 * both call this, so they dim the same command for the same reason.
 */
export function commandUnavailable(
  info: Pick<CommandInfo, "effect" | "scope" | "gate">,
  permissions: Permissions | null | undefined,
  network: Network | null | undefined,
): string | null {
  if (info.effect === "destructive") {
    // network.get carries the same role, for when the permissions read failed or has not landed.
    const refused = ownerOnly(permissions?.role ?? network?.role);
    if (refused) return refused;
  }
  const gate = commandGate(info);
  return gate ? gateFor(gate, permissions ?? undefined, network ?? undefined).reason : null;
}

/**
 * Whether the palette lists a command (`false`), and if so why it cannot run
 * (`string`) or that it can (`null`). Signed out, only app and auth commands
 * are listed. Writes dim by role, permission, bridge mode and capability
 * with the reason; the engine still has the last word when they run.
 */
export function availability(info: CommandInfo, ctx: AvailabilityContext): string | null | false {
  if (HIDDEN.has(info.id)) return false;
  if (!ctx.signedIn && info.scope === "network") return false;
  // Below both levels: neither the CLI nor an agent could run it, so the palette does not list it.
  const surfaces = surfacesFor(info, ctx.access);
  if (!surfaces.cli && !surfaces.mcp) return false;
  return commandUnavailable(info, ctx.permissions, ctx.network);
}

export function commandItems(
  commands: ReadonlyArray<CommandInfo>,
  ctx: AvailabilityContext,
  presets: ReadonlyArray<CommandPreset> = PRESETS,
): CommandItem[] {
  const out: CommandItem[] = [];
  for (const info of commands) {
    const unavailable = availability(info, ctx);
    if (unavailable === false) continue;
    const surfaces = surfacesFor(info, ctx.access);
    out.push({ kind: "command", key: `command:${info.id}`, info, label: info.label, params: {}, unavailable, ...surfaces });
    for (const p of presets.filter((p) => p.id === info.id)) {
      const key = `command:${info.id} ${JSON.stringify(p.params)}`;
      out.push({ kind: "command", key, info, label: p.label, params: p.params, unavailable, ...surfaces });
    }
  }
  return out;
}

export function pageItems(routes: ReadonlyArray<{ id: string; path: string; title: string; keywords?: string }>): PageItem[] {
  // Detail routes need an id; the palette reaches them through eero, device and profile rows.
  return routes
    .filter((r) => !r.path.includes(":"))
    .map((r) => ({ kind: "page", key: `page:${r.id}`, label: r.title, path: r.path, routeId: r.id, keywords: r.keywords, place: "page" }));
}

export type PlaceEntry = { route: string; title: string; kind: "section" | "setting"; anchor: string; when: string | null };

/**
 * The sections and settings rows Places offers: each on its page (`context`), with the anchor it jumps to. `shown`
 * leaves out the ones the page would not show now (their show-if rule, features/palette/placeRules.ts).
 */
export function placeItems(
  places: ReadonlyArray<PlaceEntry>,
  routes: ReadonlyArray<{ id: string; path: string; title: string }>,
  shown: (rule: string | null) => boolean,
): PageItem[] {
  const pageOf = new Map(routes.filter((r) => !r.path.includes(":")).map((r) => [r.id, r] as const));
  const out: PageItem[] = [];
  for (const p of places) {
    const page = pageOf.get(p.route);
    if (!page || !shown(p.when)) continue;
    out.push({ kind: "page", key: `place:${p.route}:${p.anchor}`, label: p.title, path: page.path, routeId: page.id, anchor: p.anchor, context: page.title, place: p.kind });
  }
  return out;
}

export function eeroItems(eeros: ReadonlyArray<Eero> | null): EeroItem[] {
  return (eeros ?? []).map((e) => {
    const n = e.clients.total;
    const devices = n === null ? null : `${n} ${n === 1 ? "device" : "devices"}`;
    const context = [e.model, devices].filter(Boolean).join(" · ");
    return { kind: "eero", key: `eero:${e.id}`, id: e.id, label: e.location, eero: e, context };
  });
}

export function deviceItems(devices: ReadonlyArray<Device>, profiles: ProfileList | null, eeros: ReadonlyArray<Eero> | null): DeviceItem[] {
  const profileName = new Map(profiles?.profiles.map((p) => [p.id, p.name]) ?? []);
  const eeroName = new Map(eeros?.map((e) => [e.id, e.location]) ?? []);
  return devices.map((d) => {
    const state = d.blocked ? "Blocked" : d.paused ? "Paused" : !d.connected ? "Offline" : null;
    const eero = (d.eeroId ? eeroName.get(d.eeroId) : null) ?? null;
    const context = [d.profileId ? profileName.get(d.profileId) : null, eero].filter(Boolean).join(" · ");
    return { kind: "device", key: `device:${d.id}`, id: d.id, label: d.name, device: d, state, context, eero };
  });
}

export function profileItems(list: ProfileList | null): ProfileItem[] {
  return (list?.profiles ?? []).map((p) => {
    const state = p.paused ? "Paused" : p.state === "scheduled" ? "Scheduled" : null;
    const devices = `${p.deviceIds.length} ${p.deviceIds.length === 1 ? "device" : "devices"}`;
    const schedule = p.schedules[0]?.name;
    const context = [devices, schedule].filter(Boolean).join(" · ");
    return { kind: "profile", key: `profile:${p.id}`, id: p.id, label: p.name, state, context };
  });
}

// ---------------------------------------------------------------------------
// Matching

/** Half-open [start, end) character ranges to highlight. */
export type Range = readonly [number, number];
export type Match = { score: number; ranges: Range[] };

const isWordStart = (text: string, i: number) => i === 0 || !/[a-z0-9]/i.test(text[i - 1] ?? "");

/** One query token against one text. Exact beats prefix beats word start beats substring beats fuzzy. */
function matchToken(token: string, text: string, fuzzy: boolean): Match | null {
  const t = text.toLowerCase();
  if (t === token) return { score: 1000, ranges: [[0, token.length]] };
  if (t.startsWith(token)) return { score: 800 - Math.min(t.length - token.length, 100), ranges: [[0, token.length]] };
  let at = t.indexOf(token);
  let firstAt = at;
  while (at > 0 && !isWordStart(t, at)) at = t.indexOf(token, at + 1);
  if (at > 0) return { score: 600 - Math.min(at, 100), ranges: [[at, at + token.length]] };
  if (firstAt >= 0) return { score: 400 - Math.min(firstAt, 100), ranges: [[firstAt, firstAt + token.length]] };
  // Fuzzy: every character in order. Only for tokens of 2+ characters, so one letter does not match everything.
  if (!fuzzy || token.length < 2) return null;
  const ranges: [number, number][] = [];
  let from = 0;
  let gaps = 0;
  for (const ch of token) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    gaps += i - from;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
    from = i + 1;
  }
  firstAt = ranges[0]?.[0] ?? 0;
  if (gaps > token.length * 3) return null;
  return { score: 200 - Math.min(gaps * 5 + firstAt, 190), ranges };
}

/**
 * Every whitespace-separated token must match; scores add up. Null when one
 * does not. `fuzzy: false` (id mode) needs each token as a substring.
 */
export function matchText(query: string, text: string, { fuzzy = true } = {}): Match | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { score: 0, ranges: [] };
  let score = 0;
  const ranges: Range[] = [];
  for (const token of tokens) {
    const m = matchToken(token, text, fuzzy);
    if (!m) return null;
    score += m.score;
    ranges.push(...m.ranges);
  }
  return { score, ranges: mergeRanges(ranges) };
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** Splits text into plain and highlighted parts for rendering. */
export function highlightParts(text: string, ranges: ReadonlyArray<Range>): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) parts.push({ text: text.slice(at, s), hit: false });
    parts.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

// ---------------------------------------------------------------------------
// Search

export type Hit = {
  item: Item;
  score: number;
  /** Highlight in the label. */
  ranges: Range[];
  /** Highlight in the command id (`>` mode). */
  idRanges: Range[];
};

export type Sources = {
  commands: ReadonlyArray<CommandItem>;
  pages: ReadonlyArray<PageItem>;
  /** Optional so older callers and tests without eeros still work. */
  eeros?: ReadonlyArray<EeroItem>;
  devices: ReadonlyArray<DeviceItem>;
  profiles: ReadonlyArray<ProfileItem>;
  /** Keys of recently run commands, newest first; shown on an empty query. */
  recent?: ReadonlyArray<string>;
};

export type SearchResult = {
  /** `id` when the query starts with `>`: commands only, matched by id and label. */
  mode: "text" | "id";
  groups: { kind: Kind; hits: Hit[] }[];
  /** Matches per kind, before the scope and group limits. */
  counts: Record<Kind, number>;
  /** Matches in the current scope. */
  total: number;
  /** The selectable hits in display order. */
  flat: Hit[];
};

/** Most rows a group shows under "All"; its own scope shows every match. */
export const GROUP_LIMIT: Record<Kind, number> = { command: 50, page: 8, eero: 5, device: 5, profile: 5 };

/** The effects a query can name to list every command of that kind ("disruptive"). */
const EFFECTS: ReadonlyArray<Effect> = ["query", "write", "disruptive", "destructive"];

function rank(hits: Hit[]): Hit[] {
  return hits.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
}

export function search(query: string, sources: Sources, requested: Scope = "all"): SearchResult {
  const trimmed = query.trim();
  const mode = trimmed.startsWith(">") ? "id" : "text";
  // `>` lists only commands, so a device or page scope falls back to All.
  const scope: Scope = mode === "id" && requested !== "command" ? "all" : requested;
  const q = mode === "id" ? trimmed.slice(1).trim() : trimmed;
  const effectQuery = mode === "text" && EFFECTS.some((e) => e === q.toLowerCase());
  const byKind: Record<Kind, Hit[]> = { command: [], page: [], eero: [], device: [], profile: [] };

  if (mode === "id") {
    for (const item of sources.commands) {
      if (Object.keys(item.params).length > 0) continue; // presets are shortcuts, not ids
      const id = matchText(q, item.info.id, { fuzzy: false });
      const label = matchText(q, item.label, { fuzzy: false });
      if (!id && !label) continue;
      // Ids rank ahead of labels in id mode.
      const score = Math.max(id ? id.score + 50 : 0, label?.score ?? 0);
      byKind.command.push({ item, score, ranges: label?.ranges ?? [], idRanges: id?.ranges ?? [] });
    }
    rank(byKind.command);
  } else if (q === "") {
    const recent = sources.recent ?? [];
    const order = (key: string) => {
      const i = recent.indexOf(key);
      return i < 0 ? 0 : 1000 - i;
    };
    byKind.command = sources.commands.map((item) => ({ item, score: order(item.key), ranges: [], idRanges: [] }));
    byKind.command.sort((a, b) => b.score - a.score);
    // With nothing typed, Places lists the pages only, not every section and setting.
    byKind.page = sources.pages.filter((item) => item.kind === "page" && !item.anchor).map((item) => ({ item, score: 0, ranges: [], idRanges: [] }));
  } else {
    const add = (kind: Kind, items: ReadonlyArray<Item>, extra?: (item: Item) => string | null) => {
      for (const item of items) {
        const m = matchText(q, item.label);
        const alt = extra?.(item);
        const m2 = !m && alt ? matchText(q, alt) : null;
        if (m) byKind[kind].push({ item, score: m.score, ranges: m.ranges, idRanges: [] });
        // A match only in the context ranks below every label match.
        else if (m2) byKind[kind].push({ item, score: m2.score / 10, ranges: [], idRanges: [] });
      }
      rank(byKind[kind]);
    };
    // An effect's name ("write", "destructive") lists every command with that effect, by label, with no
    // group limit, so the whole category can be read at once. Presets are left out: they repeat a command.
    const effect = EFFECTS.find((e) => e === q.toLowerCase());
    if (effectQuery && effect) {
      byKind.command = sources.commands
        .filter((item) => item.info.effect === effect && Object.keys(item.params).length === 0)
        .map((item) => ({ item, score: 0, ranges: [], idRanges: [] }));
      rank(byKind.command);
    } else add("command", sources.commands);
    // A place matches its title, then (ranked lower) the page it is on or its keywords: "advanced" lists Advanced
    // networking first, and "settings" still finds Application.
    add("page", sources.pages, (i) => (i.kind === "page" ? (i.context ?? i.keywords ?? null) : null));
    // An eero matches its location, then (ranked lower) its model.
    add("eero", sources.eeros ?? [], (i) => (i.kind === "eero" ? i.eero.model : null));
    add("device", sources.devices, (i) => (i.kind === "device" ? i.context : null));
    add("profile", sources.profiles);
  }

  const kinds = mode === "id" ? (["command"] as Kind[]) : KINDS;
  const counts: Record<Kind, number> = {
    command: byKind.command.length,
    page: mode === "id" ? 0 : byKind.page.length,
    eero: mode === "id" ? 0 : byKind.eero.length,
    device: mode === "id" ? 0 : byKind.device.length,
    profile: mode === "id" ? 0 : byKind.profile.length,
  };
  const groups = kinds
    .filter((k) => scope === "all" || scope === k)
    .map((kind) => ({ kind, hits: scope === "all" && !(kind === "command" && effectQuery) ? byKind[kind].slice(0, GROUP_LIMIT[kind]) : byKind[kind] }))
    .filter((g) => g.hits.length > 0);
  const total = scope === "all" ? KINDS.reduce((sum, k) => sum + counts[k], 0) : counts[scope];
  return { mode, groups, counts, total, flat: groups.flatMap((g) => g.hits) };
}

/** A device, eero or profile in a detail page's switcher (features/shell/TitleSwitcher.tsx). */
export type SiblingItem = DeviceItem | EeroItem | ProfileItem;
export type SiblingHit = Hit & { item: SiblingItem };

/**
 * A detail page switcher's rows: every item in the list page's order with
 * nothing typed, else the palette's matches for that kind, ranked as the
 * palette ranks them (so "find a device" finds the same thing in both).
 */
export function siblingHits(query: string, kind: SiblingItem["kind"], items: ReadonlyArray<SiblingItem>): SiblingHit[] {
  const of = <K extends SiblingItem["kind"]>(k: K) => items.filter((i): i is Extract<SiblingItem, { kind: K }> => i.kind === k);
  if (query.trim() === "") return of(kind).map((item) => ({ item, score: 0, ranges: [], idRanges: [] }));
  return search(query, { commands: [], pages: [], eeros: of("eero"), devices: of("device"), profiles: of("profile") }, kind).flat as SiblingHit[];
}

// ---------------------------------------------------------------------------
// Params from JSON Schema

/** The registry adds these; the palette fills networkId with the open network and confirm after the dialog. */
const SHARED_PARAMS = new Set(["networkId", "confirm"]);

export type RefKind = "device" | "profile" | "eero" | "network";

export type ParamField = {
  name: string;
  required: boolean;
  description: string | null;
  /** `ref`: an entity picker; `enum`: segmented when `segmented`, else a select. */
  kind: "ref" | "enum" | "boolean" | "integer" | "number" | "string" | "list";
  /** Accepts null (device.list `profile: null` means Unassigned). */
  nullable: boolean;
  refKind: RefKind | null;
  options: string[];
  /** Small enums (up to 4 short options) render as a segmented control. */
  segmented: boolean;
  default: unknown;
  min: number | null;
  max: number | null;
};

type Prop = JsonSchema & {
  type?: string;
  enum?: unknown[];
  anyOf?: Prop[];
  items?: Prop;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

const REF_RE = /\b(?:an?|this)\s+(device|profile|eero|network)\b[^.;]*\bid\b/i;

function refKindOf(...descriptions: (string | undefined)[]): RefKind | null {
  for (const d of descriptions) {
    const m = d ? REF_RE.exec(d) : null;
    if (m?.[1]) return m[1].toLowerCase() as RefKind;
  }
  return null;
}

/** The fields the params form shows, in schema order. */
export function paramFields(schema: JsonSchema): ParamField[] {
  const props = (schema.properties ?? {}) as Record<string, Prop>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(props)
    .filter(([name]) => !SHARED_PARAMS.has(name))
    .map(([name, prop]) => {
      const branches = prop.anyOf ?? [prop];
      const nullable = branches.some((b) => b.type === "null");
      const main = branches.find((b) => b.type !== "null") ?? prop;
      const options = (main.enum ?? []).map(String);
      const refKind = main.type === "string" && options.length === 0 ? refKindOf(prop.description, main.description) : null;
      const kind: ParamField["kind"] = refKind
        ? "ref"
        : options.length > 0
          ? "enum"
          : main.type === "array"
            ? "list"
            : main.type === "boolean" || main.type === "integer" || main.type === "number"
              ? main.type
              : "string";
      if (kind === "list") options.push(...(main.items?.enum ?? []).map(String));
      return {
        name,
        required: required.has(name),
        description: prop.description ?? main.description ?? null,
        kind,
        nullable,
        refKind,
        options,
        segmented: kind === "enum" && options.length <= 4 && options.every((o) => o.length <= 10),
        default: prop.default ?? main.default,
        min: main.minimum ?? null,
        max: main.maximum ?? null,
      };
    });
}

/** The params a form starts with: schema defaults, then the preset's params on top. */
export function defaultParams(schema: JsonSchema, preset: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of paramFields(schema)) if (f.default !== undefined) out[f.name] = f.default;
  return { ...out, ...preset };
}

/**
 * Params with the schema defaults left out, so the CLI and MCP lines show
 * only what the user chose (`{"status":"online"}`, not every default).
 */
export function chosenParams(schema: JsonSchema, params: Record<string, unknown>): Record<string, unknown> {
  const defaults = new Map(paramFields(schema).map((f) => [f.name, f.default]));
  return Object.fromEntries(
    Object.entries(params).filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify(defaults.get(k))),
  );
}

// The renderer's CSP has no 'unsafe-eval', so zod must not compile parsers with new Function.
z.config({ jitless: true });

const validators = new WeakMap<JsonSchema, z.ZodType | null>();

/**
 * Field messages for invalid params, from zod (the same messages the engine
 * returns in `bad_params`), keyed by top-level field. Empty when valid.
 */
export function validateParams(schema: JsonSchema, params: Record<string, unknown>): Record<string, string> {
  let v = validators.get(schema);
  if (v === undefined) {
    try {
      v = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
    } catch {
      v = null;
    }
    validators.set(schema, v);
  }
  if (!v) return {};
  const res = v.safeParse(params);
  if (res.success) return {};
  const out: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "";
    out[key] ??= issue.message;
  }
  return out;
}

/** Required fields with no value yet. The form marks them instead of showing a zod message. */
export function missingRequired(schema: JsonSchema, params: Record<string, unknown>): string[] {
  return paramFields(schema)
    .filter((f) => f.required && params[f.name] === undefined)
    .map((f) => f.name);
}

// ---------------------------------------------------------------------------
// Writes

/** The first entity picker's value ("Leo's iPad"), which names what a write changes. */
function targetName(fields: ReadonlyArray<ParamField>, params: Record<string, unknown>): string | null {
  for (const f of fields) {
    const v = params[f.name];
    if (f.kind === "ref" && typeof v === "string" && v !== "") return v;
  }
  return null;
}

/**
 * How the palette runs a write through the write kit, for any command:
 * success toast, progress toast for disruptive ones, and a confirm titled
 * with the target. Destructive commands with a target ask for its name to be
 * typed. The consequence text is the engine's `needs_confirm` message.
 */
export function writeRequest(
  info: CommandInfo,
  label: string,
  params: Record<string, unknown>,
  fields: ReadonlyArray<ParamField> = paramFields(info.params),
): WriteRequest {
  const target = targetName(fields, params);
  return {
    id: info.id,
    params,
    success: target ? `Done: ${label}, ${target}` : `Done: ${label}`,
    progress: info.effect === "disruptive" ? (target ? `${label}: ${target}` : label) : undefined,
    failure: `Couldn't run ${label}`,
    confirm: {
      title: target ? `${label}: ${target}?` : `${label}?`,
      confirmLabel: label,
      typeToConfirm: info.effect === "destructive" && target ? target : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI and MCP text

export { needsConfirm };

/** The equivalent CLI line: `mesh-ui run device.list --params '{"status":"online"}'`. */
export function cliLine(id: string, params: Record<string, unknown>, effect: Effect): string {
  const json = Object.keys(params).length ? ` --params '${JSON.stringify(params).replaceAll("'", "'\\''")}'` : "";
  return `mesh-ui run ${id}${json}${needsConfirm(effect) ? " --confirm" : ""}`;
}

// Tool name and hints live in core so the preview matches `mesh-ui mcp`.
export { type McpHints, mcpHints, toolName } from "../../../../core/mcpNames";

/** The MCP `tools/call` an agent would send for the same params. */
export function mcpCall(id: string, params: Record<string, unknown>, effect: Effect): { name: string; arguments: Record<string, unknown> } {
  return { name: toolName(id), arguments: needsConfirm(effect) ? { ...params, confirm: true } : params };
}
