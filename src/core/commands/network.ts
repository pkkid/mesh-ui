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
 * `network.restart` (M4.8) restarts every eero; its confirm and result quote
 * RESTART_ESTIMATE, the outage estimates the eero commands share.
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand, ref } from "../spec";
import { knownDevices } from "./device";

const empty = z.object({});

/** Outage estimates for restarts (docs/architecture/commands.md#restart-estimates, eero app copy). */
export const RESTART_ESTIMATE = {
  /** network.restart, or restarting the gateway eero. */
  network: "about 2 to 3 minutes",
  /** Restarting a leaf eero. */
  eero: "about 1 minute",
} as const;

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
    invalidates: ["network", "eeros"],
    async confirmMessage(ctx) {
      const name = (await ctx.backend.network.get(ctx.net).catch(() => null))?.name;
      return `Restarts every eero on ${name ?? "the network"}. Every device loses internet for ${RESTART_ESTIMATE.network}.`;
    },
    async run(ctx): Promise<RestartResult> {
      const eeros = await ctx.backend.eero.list(ctx.net).catch(() => [] as M.Eero[]);
      await ctx.backend.network.restart(ctx.net);
      // An offline eero cannot take the restart, so it is not waited for.
      return { networkId: ctx.net, eeroIds: eeros.filter((e) => e.status !== "offline").map((e) => e.id), estimate: RESTART_ESTIMATE.network };
    },
  }),
];
