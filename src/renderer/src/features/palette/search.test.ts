import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createDemoBackend } from "../../../../core/demo";
import { createEngine } from "../../../../core/engine";
import { mapPermissions } from "../../../../core/eero/map/network";
import type { DeviceList, Eero, Network, Permissions, ProfileList } from "../../../../core/model";
import { allCommands, type CommandInfo } from "../../../../core/registry";
import { type AnyCommand, defineCommand, ref } from "../../../../core/spec";
import { BRIDGE_OFF, type ConfirmAsk, gateFor, NO_PERMISSION, NOT_AVAILABLE, performWrite, type WriteDeps } from "../../app/useWrite";
import { toast } from "../../components/ui/toast";
import {
  availability,
  chosenParams,
  cliLine,
  commandItems,
  commandGate,
  commandUnavailable,
  defaultParams,
  deviceItems,
  eeroItems,
  highlightParts,
  matchText,
  mcpCall,
  pageItems,
  paramFields,
  profileItems,
  type Sources,
  search,
  siblingHits,
  missingRequired,
  validateParams,
  writeRequest,
} from "./search";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const SIGNED_IN = { signedIn: true, permissions: null };

async function demo() {
  const engine = createEngine({ backend: createDemoBackend({ clock: () => NOW }), clock: () => NOW });
  const get = async <R>(id: string): Promise<R> => {
    const r = await engine.execute<R>(id, {});
    if (!r.ok) throw new Error(r.error.message);
    return r.result;
  };
  const commands = engine.commands();
  const devices = await get<DeviceList>("device.list");
  const profiles = await get<ProfileList>("profile.list");
  const eeros = await get<Eero[]>("eero.list");
  return { engine, commands, devices, profiles, eeros };
}

const ROUTES = [
  { id: "overview", path: "/overview", title: "Overview" },
  { id: "devices", path: "/devices", title: "Devices" },
  { id: "device", path: "/devices/:deviceId", title: "Device" },
  { id: "profiles", path: "/profiles", title: "Profiles" },
  { id: "eeros", path: "/eeros", title: "eeros" },
];

async function sources(): Promise<Sources & { commandsInfo: CommandInfo[] }> {
  const d = await demo();
  return {
    commandsInfo: d.commands,
    commands: commandItems(d.commands, SIGNED_IN),
    pages: pageItems(ROUTES),
    eeros: eeroItems(d.eeros),
    devices: deviceItems(d.devices.devices, d.profiles, d.eeros),
    profiles: profileItems(d.profiles),
  };
}

const info = (cmds: CommandInfo[], id: string) => {
  const c = cmds.find((x) => x.id === id);
  if (!c) throw new Error(`no ${id}`);
  return c;
};

describe("matchText", () => {
  it("ranks exact over prefix over word start over substring over fuzzy", () => {
    const score = (q: string, t: string) => matchText(q, t)?.score ?? -1;
    expect(score("devices", "Devices")).toBeGreaterThan(score("dev", "Devices"));
    expect(score("dev", "Devices")).toBeGreaterThan(score("dev", "List devices"));
    expect(score("dev", "List devices")).toBeGreaterThan(score("evi", "Devices"));
    expect(score("evi", "Devices")).toBeGreaterThan(score("dvs", "Devices"));
    expect(score("dvs", "Devices")).toBeGreaterThan(0);
    expect(matchText("zz", "Devices")).toBeNull();
  });

  it("needs every token and returns merged highlight ranges", () => {
    const m = matchText("list dev", "List online devices");
    expect(m?.ranges).toEqual([
      [0, 4],
      [12, 15],
    ]);
    expect(matchText("list zebra", "List online devices")).toBeNull();
    expect(highlightParts("Devices", [[0, 3]])).toEqual([
      { text: "Dev", hit: true },
      { text: "ices", hit: false },
    ]);
  });

  it("does not fuzzy match a single letter", () => {
    expect(matchText("x", "Devices")).toBeNull();
    expect(matchText("d", "Devices")?.score).toBeGreaterThan(0);
  });
});

describe("search", () => {
  it("groups ranked commands, pages, devices and profiles with scope counts", async () => {
    const s = await sources();
    const r = search("device", s);
    expect(r.mode).toBe("text");
    expect(r.groups.map((g) => g.kind)).toEqual(["command", "page"].filter((k) => r.counts[k as "command"] > 0));
    // The best command match is the one labelled "Device" or "Devices" with a prefix hit.
    const first = r.groups[0]?.hits[0];
    expect(first?.item.label.toLowerCase().startsWith("device")).toBe(true);
    expect(first?.ranges[0]).toEqual([0, 6]);
    expect(r.counts.page).toBe(1); // Devices, not the Device detail route
    expect(r.total).toBe(r.counts.command + r.counts.page + r.counts.eero + r.counts.device + r.counts.profile);
  });

  it("counts every kind but lists only the chosen scope", async () => {
    const s = await sources();
    const name = s.devices[0]?.label ?? "";
    const all = search(name, s);
    expect(all.counts.device).toBeGreaterThan(0);
    const only = search(name, s, "device");
    expect(only.groups.map((g) => g.kind)).toEqual(["device"]);
    expect(only.counts).toEqual(all.counts);
    expect(only.total).toBe(all.counts.device);
    expect(only.flat.every((h) => h.item.kind === "device")).toBe(true);
  });

  it("limits devices under All but not in their own scope", async () => {
    const s = await sources();
    const all = search("e", s);
    const devices = all.groups.find((g) => g.kind === "device");
    expect(devices?.hits.length).toBeLessThanOrEqual(5);
    expect(search("e", s, "device").flat.length).toBe(all.counts.device);
  });

  it("> mode lists only commands, matched by id, with id highlights", async () => {
    const s = await sources();
    const r = search(">eero.", s);
    expect(r.mode).toBe("id");
    expect(r.groups.map((g) => g.kind)).toEqual(["command"]);
    expect(r.counts.device + r.counts.page + r.counts.eero + r.counts.profile).toBe(0);
    const ids = r.flat.map((h) => (h.item.kind === "command" ? h.item.info.id : ""));
    expect(ids.slice(0, 3).sort()).toEqual(["eero.find", "eero.get", "eero.list"]);
    expect(r.flat[0]?.idRanges[0]).toEqual([0, 5]);
    // No fuzzy matches in id mode: "eero." is not demo.scenario.set.
    expect(ids).not.toContain("demo.scenario.set");
    // Presets are not ids.
    expect(search(">device.list", s).flat).toHaveLength(1);
  });

  it("shows recent commands first and pages on an empty query", async () => {
    const s = await sources();
    const r = search("", { ...s, recent: ["command:network.health"] });
    const first = r.flat[0]?.item;
    expect(first?.kind === "command" && first.info.id).toBe("network.health");
    expect(r.counts.device).toBe(0);
    expect(r.counts.eero).toBe(0);
    expect(r.counts.page).toBe(4);
  });

  it("lists every command of an effect when the query names it", async () => {
    const s = await sources();
    for (const effect of ["query", "write", "disruptive", "destructive"] as const) {
      const want = s.commands.filter((c) => c.info.effect === effect && Object.keys(c.params).length === 0).length;
      const r = search(` ${effect.toUpperCase()} `, s);
      const cmds = r.flat.filter((h) => h.item.kind === "command");
      expect(want).toBeGreaterThan(0);
      expect(cmds).toHaveLength(want);
      expect(cmds.every((h) => h.item.kind === "command" && h.item.info.effect === effect)).toBe(true);
    }
    // A partial word is an ordinary search.
    expect(search("destr", s).flat.some((h) => h.item.kind === "command" && h.item.info.effect !== "destructive")).toBe(true);
  });

  it("finds presets by their own label", async () => {
    const s = await sources();
    const hit = search("online devices", s).flat[0]?.item;
    expect(hit?.kind === "command" && hit.params).toEqual({ status: "online" });
  });
});

describe("eero rows", () => {
  it("describe each eero by location, model, status and device count", async () => {
    const d = await demo();
    const items = eeroItems(d.eeros);
    expect(items).toHaveLength(d.eeros.length);
    const gateway = items.find((i) => i.eero.isGateway);
    expect(gateway?.key).toBe(`eero:${gateway?.id}`);
    expect(gateway?.label).toBe(gateway?.eero.location);
    const n = gateway?.eero.clients.total ?? 0;
    expect(gateway?.context).toBe(`${gateway?.eero.model} · ${n} ${n === 1 ? "device" : "devices"}`);
    expect(eeroItems(null)).toEqual([]);
  });

  it("leave out a missing model or device count", async () => {
    const d = await demo();
    const [first] = d.eeros;
    if (!first) throw new Error("no eeros");
    const [bare] = eeroItems([{ ...first, model: null, clients: { total: null, wired: null, wireless: null } }]);
    expect(bare?.context).toBe("");
    const [one] = eeroItems([{ ...first, clients: { total: 1, wired: 0, wireless: 1 } }]);
    expect(one?.context).toBe(`${first.model} · 1 device`);
  });

  it("find an eero by its location, ahead of devices on it", async () => {
    const s = await sources();
    const r = search("garage", s);
    const group = r.groups.find((g) => g.kind === "eero");
    expect(group?.hits.map((h) => h.item.label)).toEqual(["Garage"]);
    expect(group?.hits[0]?.ranges).toEqual([[0, 6]]);
    expect(r.counts.eero).toBe(1);
    // The eeros group sits before devices.
    const kinds = r.groups.map((g) => g.kind);
    if (kinds.includes("device")) expect(kinds.indexOf("eero")).toBeLessThan(kinds.indexOf("device"));
  });

  it("match the model below every location match", async () => {
    const s = await sources();
    const r = search("beacon", s, "eero");
    expect(r.flat.map((h) => h.item.label)).toEqual(["Garage"]);
    expect(r.flat[0]?.ranges).toEqual([]); // the match is in the model, not the label
    const office = search("office", s, "eero").flat[0];
    expect(office?.score).toBeGreaterThan(r.flat[0]?.score ?? 0);
  });

  it("rank exact over prefix over word start over substring", async () => {
    const s = await sources();
    const names = (q: string) => search(q, s, "eero").flat.map((h) => h.item.label);
    expect(names("up")).toEqual(["Upstairs Hall"]);
    expect(names("hall")).toEqual(["Upstairs Hall"]);
    expect(names("room")[0]).toBe("Living Room");
  });

  it("have their own scope", async () => {
    const s = await sources();
    const only = search("o", s, "eero");
    expect(only.groups.map((g) => g.kind)).toEqual(["eero"]);
    expect(only.total).toBe(only.counts.eero);
  });
});

describe("detail page switcher", () => {
  it("lists every sibling in the given order with nothing typed", async () => {
    const s = await sources();
    const reversed = [...s.devices].reverse();
    expect(siblingHits("", "device", reversed).map((h) => h.item.id)).toEqual(reversed.map((d) => d.id));
    expect(siblingHits("  ", "eero", s.eeros ?? []).map((h) => h.item.id)).toEqual((s.eeros ?? []).map((e) => e.id));
  });

  it("ranks matches as the palette does for that kind", async () => {
    const s = await sources();
    for (const q of ["garage", "o", "beacon"]) {
      expect(siblingHits(q, "eero", s.eeros ?? []).map((h) => h.item.key)).toEqual(search(q, s, "eero").flat.map((h) => h.item.key));
    }
    const devices = siblingHits("tv", "device", s.devices);
    expect(devices.map((h) => h.item.key)).toEqual(search("tv", s, "device").flat.map((h) => h.item.key));
    expect(devices.every((h) => h.item.kind === "device")).toBe(true);
    expect(siblingHits("zzzzqx", "profile", s.profiles)).toEqual([]);
  });
});

describe("availability", () => {
  it("runs queries and writes, and hides network commands when signed out", async () => {
    const { commands } = await demo();
    expect(availability(info(commands, "device.list"), SIGNED_IN)).toBeNull();
    expect(availability(info(commands, "network.select"), SIGNED_IN)).toBeNull();
    expect(availability(info(commands, "device.rates.refresh"), SIGNED_IN)).toBeNull();
    expect(availability(info(commands, "auth.login.start"), SIGNED_IN)).toBe(false);
    const signedOut = commandItems(commands, { signedIn: false, permissions: null });
    expect(signedOut.length).toBeGreaterThan(0);
    expect(signedOut.every((c) => c.info.scope !== "network")).toBe(true);
    const destructive = { ...info(commands, "device.list"), effect: "destructive" as const };
    expect(availability(destructive, { signedIn: true, permissions: { role: "admin", can: {} } })).toBe("Owner only");
    // The real network sends no role (M5.6 capture): that is not an admin, so an owner's destructive commands stay usable.
    expect(availability(destructive, { signedIn: true, permissions: { role: null, can: {} } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Writes. The real device, profile and network writes land in parallel M4
// stories, so these test-only specs stand in for them (any real spec with the
// same id is swapped out). Each keeps its own state so a run is visible.

type Kit = { paused: Set<string>; restarts: number; profiles: string[] };

function writeSpecs(kit: Kit): AnyCommand[] {
  const device = z.object({ device: ref("device") });
  return [
    defineCommand({
      id: "device.pause",
      label: "Pause device",
      effect: "write",
      params: device,
      run: async (_ctx, p) => (kit.paused.add(p.device), { paused: [...kit.paused] }),
    }),
    defineCommand({
      id: "device.resume",
      label: "Resume device",
      effect: "write",
      params: device,
      run: async (_ctx, p) => (kit.paused.delete(p.device), { paused: [...kit.paused] }),
    }),
    defineCommand({ id: "device.block", label: "Block device", effect: "write", params: device, run: async () => ({}) }),
    defineCommand({
      id: "network.restart",
      label: "Restart network",
      effect: "disruptive",
      params: z.object({}),
      confirmMessage: () => "Everyone loses internet for about 2 to 3 minutes.",
      run: async () => ({ restarts: ++kit.restarts }),
    }),
    defineCommand({
      id: "eero.restart",
      label: "Restart eero",
      effect: "disruptive",
      params: z.object({ eero: ref("eero") }),
      run: async () => ({}),
    }),
    defineCommand({
      id: "profile.delete",
      label: "Delete profile",
      effect: "destructive",
      params: z.object({ profile: ref("profile") }),
      run: async (_ctx, p) => ((kit.profiles = kit.profiles.filter((n) => n !== p.profile)), { profiles: kit.profiles }),
    }),
  ];
}

function writeSetup(answers: boolean[] = []) {
  const kit: Kit = { paused: new Set(), restarts: 0, profiles: ["Mia", "Leo"] };
  // Stand-ins take the real spec's gate, as the gate is part of the command, not its run.
  const real = new Map(allCommands().map((c) => [c.id, c]));
  const specs = writeSpecs(kit).map((c) => ({ ...c, gate: real.get(c.id)?.gate }));
  const ids = new Set(specs.map((c) => c.id));
  const engine = createEngine({
    backend: createDemoBackend({ clock: () => NOW }),
    clock: () => NOW,
    commands: [...allCommands().filter((c) => !ids.has(c.id)), ...specs],
  });
  const asks: ConfirmAsk[] = [];
  const executed: { id: string; params: unknown }[] = [];
  const deps: WriteDeps = {
    execute: (id, params) => (executed.push({ id, params }), engine.execute(id, params)),
    info: async (id) => engine.commands().find((c) => c.id === id),
    ask: async (a) => (asks.push(a), answers.shift() ?? false),
    invalidate: () => {},
  };
  return { kit, engine, commands: engine.commands(), deps, asks, executed };
}

async function read<R>(engine: ReturnType<typeof createEngine>, id: string): Promise<R> {
  const r = await engine.execute<R>(id, {});
  if (!r.ok) throw new Error(r.error.message);
  return r.result;
}

describe("dimming writes", () => {
  it("reads the permission area, op, bridge mode and capability from the spec's gate", () => {
    const t = writeSetup();
    const at = (id: string) => commandGate(info(t.commands, id));
    expect(at("device.pause")).toEqual({ area: "devices", op: "update", bridgeOff: true, capability: undefined });
    expect(at("device.block")).toMatchObject({ bridgeOff: true, capability: "device_blacklist" });
    expect(at("profile.create")).toMatchObject({ area: "profiles", op: "create", bridgeOff: true });
    expect(at("profile.delete")).toMatchObject({ area: "profiles", op: "delete" });
    expect(at("wifi.name.set")).toMatchObject({ area: "settings", op: "update", bridgeOff: false });
    expect(at("guest.enable")).toMatchObject({ area: "settings", op: "update", bridgeOff: true });
    expect(at("device.list")).toBeNull();
    expect(at("network.select")).toBeNull();
  });

  it("a page (useGate by id) and the palette dim the same command for the same reason", async () => {
    const t = writeSetup();
    const network = await read<Network>(t.engine, "network.get");
    const owner = await read<Permissions>(t.engine, "network.permissions");
    const admin: Permissions = { role: "admin", can: { ...owner.can, eeros: { read: true, create: false, update: false, delete: false } } };
    const bridged = { ...network, connectionMode: "bridged" as const };
    const noBlock = { ...network, capabilities: { ...network.capabilities, device_blacklist: false } };
    const reasons = new Set<string | null>();
    for (const c of t.commands.filter((c) => c.effect !== "query" && c.scope === "network")) {
      for (const [permissions, net] of [[owner, network], [admin, network], [owner, bridged], [owner, noBlock]] as const) {
        // useGate("<id>") in components/ui/page.tsx returns commandUnavailable's reason.
        const page = commandUnavailable(c, permissions, net);
        expect(availability(c, { signedIn: true, permissions, network: net })).toBe(page);
        reasons.add(page);
      }
    }
    // Every kind of reason came up, so the comparison covers each rule.
    expect([...reasons].sort()).toEqual([BRIDGE_OFF, NOT_AVAILABLE, "Owner only", null].sort());
    expect(commandUnavailable(info(t.commands, "device.block"), owner, noBlock)).toBe(NOT_AVAILABLE);
    expect(commandUnavailable(info(t.commands, "device.pause"), owner, bridged)).toBe(BRIDGE_OFF);
  });

  it("dims by role, permission, bridge mode and capability, with the reason", async () => {
    const t = writeSetup();
    const network = await read<Network>(t.engine, "network.get");
    const owner = await read<Permissions>(t.engine, "network.permissions");
    const admin: Permissions = {
      role: "admin",
      can: { ...owner.can, eeros: { read: true, create: false, update: false, delete: false } },
    };
    const member: Permissions = { role: null, can: { ...owner.can, devices: { read: true, create: false, update: false, delete: false } } };
    const on = (permissions: Permissions, net: Network = network) => ({ signedIn: true, permissions, network: net });
    const av = (id: string, ctx: ReturnType<typeof on>) => availability(info(t.commands, id), ctx);

    for (const id of ["device.pause", "device.block", "network.restart", "eero.restart", "profile.delete"]) {
      expect(av(id, on(owner))).toBeNull();
    }
    expect(av("eero.restart", on(admin))).toBe("Owner only");
    expect(av("profile.delete", on(admin))).toBe("Owner only");
    expect(av("device.pause", on(member))).toBe(NO_PERMISSION);
    const bridged = { ...network, connectionMode: "bridged" as const };
    expect(av("device.pause", on(owner, bridged))).toBe(BRIDGE_OFF);
    expect(av("network.restart", on(owner, bridged))).toBeNull();
    // Guest network writes are off in bridge mode, as on the Guest page; reading it is not.
    for (const id of ["guest.enable", "guest.disable", "guest.rename", "guest.password.set"]) {
      expect(av(id, on(owner, bridged))).toBe(BRIDGE_OFF);
      expect(av(id, on(owner))).toBeNull();
    }
    expect(av("guest.get", on(owner, bridged))).toBeNull();
    const noBlock = { ...network, capabilities: { ...network.capabilities, device_blacklist: false } };
    expect(av("device.block", on(owner, noBlock))).toBe(NOT_AVAILABLE);
    expect(av("device.pause", on(owner, noBlock))).toBeNull();

    // Dimmed items carry the reason into the result list.
    const items = commandItems(t.commands, on(owner, bridged));
    expect(items.find((c) => c.info.id === "device.pause")?.unavailable).toBe(BRIDGE_OFF);
  });
});

/**
 * The shape a real `{net}/permissions` sends (M5.1-fix capture; flags
 * invented to match): role `network-owner`, only `network` and `eeros`
 * areas plus dotted keys, `network.create` false even for the owner.
 */
const T = true;
const F = false;
const p = (create: boolean, read: boolean, update: boolean, del: boolean) => ({ create, read, update, delete: del });
const REAL_OWNER = mapPermissions({
  role: "network-owner",
  permissions: {
    network: p(F, T, T, T),
    eeros: p(T, T, T, T),
    "network.transfer": p(F, F, F, F),
    "network.admin_invites": p(T, T, T, T),
    "network.standard_admins": p(F, T, F, T),
    "network.ownership_transfer": p(T, T, F, T),
    "network.proxied_nodes": p(F, T, T, F),
    "network.smart_home_hub": p(T, T, T, T),
    "network.radio_settings": p(F, T, T, T),
    "network.subnets.main.password": p(F, T, T, F),
    "amazon.account": p(T, T, T, T),
    per_eero: [{ id: 1, eero: p(T, T, T, T) }],
  },
} as never);
const REAL_ADMIN = mapPermissions({
  role: "standard-admin",
  permissions: { network: p(F, T, T, F), eeros: p(F, T, F, F), "network.admin_invites": p(F, T, F, F), "network.standard_admins": p(F, T, F, F), "network.ownership_transfer": p(F, F, F, F), "amazon.account": p(F, T, F, F) },
} as never);

describe("dimming writes on the real permissions shape", () => {
  it("maps the real owner and admin roles", () => {
    expect(REAL_OWNER.role).toBe("owner");
    expect(REAL_ADMIN.role).toBe("admin");
    expect(REAL_OWNER.can.devices).toBeUndefined();
  });

  it("an owner can run every network write: Wi-Fi, device, profile, routing and destructive ones", async () => {
    const t = writeSetup();
    const network = await read<Network>(t.engine, "network.get");
    const blocked = t.commands
      .filter((c) => c.effect !== "query" && c.scope === "network")
      .map((c) => [c.id, commandUnavailable(c, REAL_OWNER, network)] as const)
      .filter(([, reason]) => reason === NO_PERMISSION || reason === "Owner only");
    expect(blocked).toEqual([]);
    for (const id of ["wifi.name.set", "device.pause", "device.block", "profile.create", "profile.delete", "reservation.add", "forward.add", "pinhole.remove", "network.transfer", "network.delete", "admin.remove", "integrations.amazon.unlink"]) {
      const c = t.commands.find((x) => x.id === id);
      expect(c && commandUnavailable(c, REAL_OWNER, network), id).toBeNull();
    }
    expect(t.commands.filter((c) => c.effect === "destructive" && c.scope === "network").length).toBeGreaterThan(0);
  });

  it("an admin is refused owner-only commands and may change the network", async () => {
    const t = writeSetup();
    const network = await read<Network>(t.engine, "network.get");
    for (const c of t.commands.filter((c) => c.effect === "destructive" && c.scope === "network")) {
      expect(commandUnavailable(c, REAL_ADMIN, network), c.id).toBe("Owner only");
    }
    for (const id of ["wifi.name.set", "device.pause", "profile.create"]) {
      expect(commandUnavailable(info(t.commands, id), REAL_ADMIN, network), id).toBeNull();
    }
    expect(commandUnavailable(info(t.commands, "eero.restart"), REAL_ADMIN, network)).toBe("Owner only");
  });

  it("refuses a destructive command for an admin from network.get's role when permissions did not load", async () => {
    const t = writeSetup();
    const network = await read<Network>(t.engine, "network.get");
    const del = info(t.commands, "network.delete");
    expect(commandUnavailable(del, null, { ...network, role: "admin" })).toBe("Owner only");
    expect(availability(del, { signedIn: true, permissions: null, network: { ...network, role: "admin" } })).toBe("Owner only");
    expect(commandUnavailable(del, null, { ...network, role: "owner" })).toBeNull();
    expect(commandUnavailable(del, null, { ...network, role: null })).toBeNull();
  });

  // M5.R-fix4: the owner's Eco efficiency was refused by eero (403), not by this gate: the role gate was right,
  // and nothing checked the power_saving capability, which a real network without the hardware sends as false.
  it("on a real-shaped network without power saving hardware, the owner sees Not available for Eco only, never a role reason", async () => {
    const t = writeSetup();
    const demo = await read<Network>(t.engine, "network.get");
    const network: Network = { ...demo, role: "owner", capabilities: { ...demo.capabilities, power_saving: false, scheduled_power_saving: false } };
    // The page dims the Eco switch on the capability; the command's own gate leaves the schedule switch usable.
    for (const id of ["settings.power_saving.set", "settings.power_schedule.add", "settings.power_schedule.update", "settings.power_schedule.remove", "settings.timezone.set"]) {
      expect(commandUnavailable(info(t.commands, id), REAL_OWNER, network), id).toBeNull();
    }
    expect(gateFor({ area: "settings", capability: "power_saving" }, REAL_OWNER, network)).toEqual({ allowed: false, reason: NOT_AVAILABLE });
    const reasons = t.commands.filter((c) => c.effect !== "query" && c.scope === "network").map((c) => commandUnavailable(c, REAL_OWNER, network));
    expect(reasons.filter((r) => r === NO_PERMISSION || r === "Owner only")).toEqual([]);
  });

  it("a page (useGate by id) and the palette agree on the real shape", async () => {
    const t = writeSetup();
    const network = await read<Network>(t.engine, "network.get");
    for (const c of t.commands.filter((c) => c.effect !== "query" && c.scope === "network")) {
      for (const permissions of [REAL_OWNER, REAL_ADMIN]) {
        expect(availability(c, { signedIn: true, permissions, network }), c.id).toBe(commandUnavailable(c, permissions, network));
      }
    }
  });
});

describe("running writes", () => {
  beforeEach(() => toast.clear());

  it("runs a write on Enter with a success toast and no confirm", async () => {
    const t = writeSetup();
    const pause = info(t.commands, "device.pause");
    const res = await performWrite(writeRequest(pause, pause.label, { device: "Leo's iPad" }), t.deps);
    expect(res).toMatchObject({ ok: true, result: { paused: ["Leo's iPad"] } });
    expect(t.asks).toEqual([]);
    expect(t.executed).toEqual([{ id: "device.pause", params: { device: "Leo's iPad" } }]);
    expect(toast.list()).toMatchObject([{ kind: "success", title: "Done: Pause device, Leo's iPad" }]);
  });

  it("asks before a disruptive command with the engine's message, then runs it with confirm", async () => {
    const t = writeSetup([true]);
    const restart = info(t.commands, "network.restart");
    const req = writeRequest(restart, restart.label, {});
    expect(req.progress).toBe("Restart network");
    const res = await performWrite(req, t.deps);
    expect(res).toMatchObject({ ok: true, result: { restarts: 1 } });
    expect(t.asks).toMatchObject([
      { id: "network.restart", effect: "disruptive", title: "Restart network?", message: "Everyone loses internet for about 2 to 3 minutes." },
    ]);
    expect(t.executed.map((e) => e.params)).toEqual([{}, { confirm: true }]);
    expect(toast.list()).toMatchObject([{ kind: "success", title: "Done: Restart network" }]);
  });

  it("runs nothing when the confirm is cancelled", async () => {
    const t = writeSetup([false]);
    const restart = info(t.commands, "network.restart");
    expect(await performWrite(writeRequest(restart, restart.label, {}), t.deps)).toBeNull();
    expect(t.kit.restarts).toBe(0);
    expect(toast.list()).toEqual([]);
  });

  it("asks to type the target's name before a destructive command", async () => {
    const t = writeSetup([true]);
    const del = info(t.commands, "profile.delete");
    const res = await performWrite(writeRequest(del, del.label, { profile: "Mia" }), t.deps);
    expect(res).toMatchObject({ ok: true, result: { profiles: ["Leo"] } });
    expect(t.asks).toMatchObject([{ effect: "destructive", title: "Delete profile: Mia?", typeToConfirm: "Mia", confirmLabel: "Delete profile" }]);
  });
});

describe("params from JSON Schema", () => {
  it("reads fields: refs, small enums as segmented, nullable refs, and skips shared params", async () => {
    const { commands } = await demo();
    const fields = paramFields(info(commands, "device.list").params);
    const by = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(by.networkId).toBeUndefined();
    expect(by.status).toMatchObject({ kind: "enum", options: ["online", "offline", "paused", "blocked"], segmented: true, required: false });
    expect(by.profile).toMatchObject({ kind: "ref", refKind: "profile", nullable: true });
    expect(by.eero).toMatchObject({ kind: "ref", refKind: "eero" });
    expect(by.paused?.kind).toBe("boolean");
    expect(by.limit).toMatchObject({ kind: "integer", min: 1, max: 500 });
    expect(by.type?.segmented).toBe(false); // five options

    const get = paramFields(info(commands, "device.get").params);
    expect(get).toEqual([expect.objectContaining({ name: "device", kind: "ref", refKind: "device", required: true })]);
    const events = paramFields(info(commands, "events.list").params);
    expect(events.find((f) => f.name === "type")).toMatchObject({ kind: "list" });
  });

  it("starts the form from schema defaults with preset params on top", async () => {
    const { commands } = await demo();
    const history = info(commands, "speedtest.history").params;
    expect(defaultParams(history)).toEqual({ range: "week", limit: 50, format: "json" });
    expect(defaultParams(history, { range: "day" })).toEqual({ range: "day", limit: 50, format: "json" });
    expect(defaultParams(info(commands, "device.list").params, { status: "online" })).toEqual({ status: "online" });
    expect(chosenParams(history, defaultParams(history, { range: "day" }))).toEqual({ range: "day" });
  });

  it("validates with zod messages keyed by field", async () => {
    const { commands } = await demo();
    const get = info(commands, "device.get").params;
    expect(validateParams(get, { device: "x" })).toEqual({});
    expect(Object.keys(validateParams(get, {}))).toEqual(["device"]);
    const list = info(commands, "device.list").params;
    expect(validateParams(list, { limit: 0 }).limit).toMatch(/>=\s*1|too small/i);
    expect(validateParams(list, { status: "online" })).toEqual({});
    expect(missingRequired(get, {})).toEqual(["device"]);
    expect(missingRequired(get, { device: "x" })).toEqual([]);
  });
});

describe("CLI and MCP text", () => {
  it("builds the CLI line, quoting single quotes and adding --confirm when needed", () => {
    expect(cliLine("device.list", {}, "query")).toBe("mesh-ui run device.list");
    expect(cliLine("device.list", { status: "online" }, "query")).toBe(`mesh-ui run device.list --params '{"status":"online"}'`);
    expect(cliLine("device.get", { device: "Leo's Switch" }, "query")).toBe(
      `mesh-ui run device.get --params '{"device":"Leo'\\''s Switch"}'`,
    );
    expect(cliLine("eero.restart", { eero: "x" }, "disruptive")).toBe(`mesh-ui run eero.restart --params '{"eero":"x"}' --confirm`);
  });

  it("builds the MCP tools/call with the core tool name, adding confirm when needed", () => {
    expect(mcpCall("device.list", { status: "online" }, "query")).toEqual({ name: "device_list", arguments: { status: "online" } });
    expect(mcpCall("eero.restart", { eero: "x" }, "disruptive")).toEqual({ name: "eero_restart", arguments: { eero: "x", confirm: true } });
  });
});
