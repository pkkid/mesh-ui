/**
 * Network commands: list and switch networks, read one network, its health
 * and the signed-in user's permissions. See docs/architecture/commands.md
 * (network) and engine.md (Network switching).
 *
 * `network.list` reports the session's selection as it is: the last used
 * network (`lastNetworkId`) once one has been chosen, else every `selected`
 * is false. Sign-in uses it to open the last used network, else the first,
 * before any network-scoped command runs (which would auto-pick the first
 * network).
 *
 * `network.delete` (M5.3, destructive) takes the network name as
 * type-to-confirm and moves the session to another network.
 *
 * `network.restart` (M4.8) restarts every eero; its confirm and result quote
 * RESTART_ESTIMATE, the outage estimates the eero commands share.
 *
 * `network.nickname.set` (M6.9) sets the label eero's apps show beside the
 * network name, then reads the network back: eero has answered 200 to writes
 * it ignored, so a nickname that did not stick is an `eero_error`, never a
 * result that looks saved.
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { CommandError } from "../errors";
import { type AnyCommand, type CommandContext, defineCommand, ownerOnly, ref } from "../spec";
import { knownDevices } from "./device";

const empty = z.object({});

/** Outage estimates for restarts (docs/architecture/commands.md#restart-estimates, eero app copy). */
export const RESTART_ESTIMATE = {
  /** network.restart, or restarting the gateway eero. */
  network: "about 2 to 3 minutes",
  /** Restarting a leaf eero. */
  eero: "about 1 minute",
} as const;

/** Longest network nickname (eero's app limit, as device nicknames). */
export const NICKNAME_MAX = 32;

/**
 * The nickname as the network list reports it. The list reads it from the
 * account's network refs (`networks.data[].nickname_label`) as well as
 * `GET {net}`, which may not carry it (endpoints.md section 20), so the
 * check before and after a write sees what the switcher shows (#270).
 */
async function currentNickname(ctx: CommandContext): Promise<string | null> {
  const ref = (await ctx.backend.network.list()).find((n) => n.id === ctx.net);
  return ref ? (ref.nickname ?? null) : ((await ctx.backend.network.get(ctx.net)).nickname ?? null);
}

/** What a restart returns: the eeros that go down and how long for. */
export type RestartResult = { networkId: M.Id; eeroIds: M.Id[]; estimate: string };

/**
 * Problems worth a banner, most serious first. A network that is not
 * reporting gives one network_offline issue and nothing else; otherwise each
 * offline eero (with the devices last seen on it), then each weak wireless
 * link (with the devices connected through it now).
 */
export function healthIssues(health: Omit<M.NetworkHealth, "issues">, eeros: Pick<M.Eero, "id" | "upstream">[], devices: Pick<M.Device, "id" | "eeroId" | "connected">[]): M.HealthIssue[] {
  if (health.status === "offline") return [{ kind: "network_offline", eeroId: null, upstreamId: null, deviceIds: devices.map((d) => d.id) }];
  const upstream = new Map(eeros.map((e) => [e.id, e.upstream]));
  const on = (id: M.Id, connectedOnly: boolean) => devices.filter((d) => d.eeroId === id && (!connectedOnly || d.connected)).map((d) => d.id);
  const issue = (kind: M.HealthIssueKind, id: M.Id, connectedOnly: boolean): M.HealthIssue => ({ kind, eeroId: id, upstreamId: upstream.get(id) ?? null, deviceIds: on(id, connectedOnly) });
  return [
    ...health.eeros.filter((e) => e.status === "offline").map((e) => issue("eero_offline", e.id, false)),
    ...health.eeros.filter((e) => e.status !== "offline" && e.weakLink).map((e) => issue("weak_link", e.id, true)),
  ];
}

/**
 * The network to delete, after the owner and type-the-name checks. eero has
 * the last word on the role (a real network often reports none, so only a
 * known admin is refused here).
 */
async function deletable(ctx: CommandContext, typed: string): Promise<M.Network> {
  const n = await ctx.backend.network.get(ctx.net);
  if (ownerOnly(n.role)) throw new CommandError("bad_params", "Only the network owner can delete it.");
  if (typed.trim() !== n.name) throw new CommandError("bad_params", `Type the network name, ${n.name}, exactly to delete it.`, { issues: [{ path: "networkName", message: `Type ${n.name} exactly.` }] });
  return n;
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "network.list",
    label: "Networks",
    description: "Lists the networks on this account with role, status, eero count and devices online. `selected` marks the network the session acts on; all false means none is chosen yet.",
    icon: "network",
    params: empty,
    effect: "query",
    scope: "account",
    topic: "account",
    async run(ctx): Promise<M.NetworkSummary[]> {
      const list = await ctx.backend.network.list();
      return list.map((n) => ({ ...n, selected: n.id === ctx.selectedNetworkId }));
    },
  }),

  defineCommand({
    id: "network.select",
    label: "Switch network",
    description: "Makes a network the selected one for this app and the CLI. Local only: nothing changes on eero.",
    icon: "arrow-left-right",
    params: z.object({ network: ref("network") }),
    effect: "write",
    gate: { area: null },
    scope: "account",
    // network.get caches the `selected` flag.
    invalidates: ["network"],
    async run(ctx, p): Promise<{ networkId: M.Id }> {
      const id = await ctx.resolve("network", p.network);
      await ctx.selectNetwork(id);
      return { networkId: id };
    },
  }),

  defineCommand({
    id: "network.get",
    label: "Network",
    description:
      "One network: name, nickname, status, role, counts, capabilities, time zone and banner messages. counts.devices is every known device, the same number as device.list summary.total; counts.profiles is the number of profiles profile.list lists.",
    icon: "network",
    params: empty,
    effect: "query",
    topic: "network",
    poll: POLL.network,
    async run(ctx): Promise<M.Network> {
      const [n, devices, profiles] = await Promise.all([
        ctx.backend.network.get(ctx.net),
        ctx.backend.device.list(ctx.net),
        ctx.backend.profile.list(ctx.net).catch(() => null),
      ]);
      // eero's clients.count is connected devices only; the sidebar count is every known device, as device.list counts them.
      // A real network sends no profile count; it is profile.list's, which leaves out eero's default (Unassigned) profile.
      const counts = { ...n.counts, devices: knownDevices(devices, ctx.now()).length, profiles: profiles ? profiles.length : n.counts.profiles };
      return { ...n, counts, selected: n.id === ctx.selectedNetworkId };
    },
  }),

  defineCommand({
    id: "network.health",
    label: "Network health",
    description: "Internet and mesh status, each eero's status and mesh bars, weak links, banner messages and issues (weak_link, eero_offline, network_offline with the eero, its upstream and the devices affected).",
    icon: "activity",
    params: empty,
    effect: "query",
    topic: "network",
    poll: POLL.network,
    async run(ctx): Promise<M.NetworkHealth> {
      const health = await ctx.backend.network.health(ctx.net);
      // Only read eeros and devices when there is something to report, so a healthy poll stays one call.
      const needed = health.status === "offline" || health.eeros.some((e) => e.status === "offline" || e.weakLink);
      if (!needed) return { ...health, issues: [] };
      const [eeros, devices] = await Promise.all([ctx.backend.eero.list(ctx.net), ctx.backend.device.list(ctx.net)]);
      return { ...health, issues: healthIssues(health, eeros, knownDevices(devices, ctx.now())) };
    },
  }),

  defineCommand({
    id: "network.permissions",
    label: "Permissions",
    description: "Your role on the network and what it may read, create, update and delete, per area.",
    icon: "shield",
    params: empty,
    effect: "query",
    topic: "permissions",
    run: (ctx): Promise<M.Permissions> => ctx.backend.network.permissions(ctx.net),
  }),

  defineCommand({
    id: "network.restart",
    label: "Restart network",
    description: `Restarts every eero on the network. Every device loses internet for ${RESTART_ESTIMATE.network}. Answers once eero accepts it, not when the eeros are back; returns the eeros that restart.`,
    icon: "rotate-ccw",
    params: empty,
    effect: "disruptive",
    gate: { area: "network" },
    invalidates: ["network", "eeros"],
    async confirmMessage(ctx) {
      const name = (await ctx.backend.network.get(ctx.net).catch(() => null))?.name;
      return `Restarts every eero on ${name ?? "the network"} at once. Everyone loses internet for ${RESTART_ESTIMATE.network}.`;
    },
    async run(ctx): Promise<RestartResult> {
      const eeros = await ctx.backend.eero.list(ctx.net).catch(() => [] as M.Eero[]);
      await ctx.backend.network.restart(ctx.net);
      // An offline eero cannot take the restart, so it is not waited for.
      return { networkId: ctx.net, eeroIds: eeros.filter((e) => e.status !== "offline" && e.kind !== "builtin").map((e) => e.id), estimate: RESTART_ESTIMATE.network };
    },
  }),

  defineCommand({
    id: "network.nickname.set",
    label: "Network nickname",
    description: `Sets the network's nickname: the label eero's apps show to tell networks apart, not the Wi-Fi name. Up to ${NICKNAME_MAX} characters; an empty nickname clears it. Reads the network back and fails with eero_error if eero did not keep it. Applies without a restart.`,
    icon: "tag",
    params: z.object({
      nickname: z.string().trim().max(NICKNAME_MAX, `Use ${NICKNAME_MAX} characters or fewer.`).describe(`The nickname, up to ${NICKNAME_MAX} characters; empty clears it.`),
    }),
    effect: "write",
    gate: { area: "network" },
    invalidates: ["account", "network"],
    async run(ctx, p): Promise<{ networkId: M.Id; nickname: string | null }> {
      const want = p.nickname === "" ? null : p.nickname;
      if ((await currentNickname(ctx)) === want) return { networkId: ctx.net, nickname: want };
      await ctx.backend.network.setNickname(ctx.net, want);
      const got = await currentNickname(ctx);
      if (got !== want) {
        const shown = (v: string | null) => (v === null ? "no nickname" : `"${v}"`);
        throw new CommandError("eero_error", `eero accepted the nickname but still reports ${shown(got)}, not ${shown(want)}. Check again in a minute; if it has not changed, eero did not save it.`);
      }
      return { networkId: ctx.net, nickname: got };
    },
  }),

  defineCommand({
    id: "network.delete",
    label: "Delete network",
    description:
      "Deletes the network: every eero resets, and its profiles, history and admins are gone. Cannot be undone. Owner only. `networkName` must equal the network's current name (type-to-confirm). Afterwards the session moves to another network, if there is one.",
    icon: "trash-2",
    params: z.object({ networkName: z.string().trim().min(1).describe("The network's current name, exactly, to confirm.") }),
    effect: "destructive",
    gate: { area: "network", op: "delete" },
    invalidates: ["account", "network", "eeros", "devices", "profiles", "settings", "wifi", "guest", "routing", "updates", "admins", "permissions"],
    async confirmMessage(ctx, p) {
      const n = await deletable(ctx, p.networkName);
      return `Deletes ${n.name}: every eero resets, and its profiles, history and admins are gone. Every device loses internet until the eeros are set up again. This cannot be undone.`;
    },
    async run(ctx, p): Promise<{ deleted: M.Id; name: string; selectedNetworkId: M.Id | null }> {
      const n = await deletable(ctx, p.networkName);
      await ctx.backend.network.remove(ctx.net);
      ctx.invalidate(["account"]);
      // Move the session off the deleted network; with none left, the next network-scoped command says so.
      const next = ctx.selectedNetworkId === n.id ? ((await ctx.backend.network.list()).find((x) => x.id !== n.id)?.id ?? null) : ctx.selectedNetworkId;
      if (next && next !== ctx.selectedNetworkId) await ctx.selectNetwork(next);
      return { deleted: n.id, name: n.name, selectedNetworkId: next };
    },
  }),
];
