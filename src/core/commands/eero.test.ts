import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { bandOf, cidr, eeroStatus, lanOf, mapEero, mapFirmwareHistory, mapPorts, portSpeed } from "../eero/map/eero";
import { createEngine } from "../engine";
import { meshQuality, withTopology } from "./eero";
import type * as M from "../model";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";

const demoEngine = () => createEngine({ backend: createDemoBackend({ clock: () => NOW }), clock: () => NOW });

describe("eero.list and eero.get (demo)", () => {
  it("lists the eeros gateway first with topology", async () => {
    const r = await demoEngine().execute<M.Eero[]>("eero.list");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result.map((e) => e.location)).toEqual(["Living Room", "Garage", "Office", "Upstairs Hall"]);
    const [gw, ...rest] = r.result;
    expect(gw?.isGateway).toBe(true);
    expect(gw?.upstream).toBeNull();
    for (const e of rest) expect(e.upstream).not.toBeNull();
  });

  it("derives hop and mesh quality in core", async () => {
    const engine = demoEngine();
    const r = await engine.execute<M.Eero[]>("eero.list");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result.map((e) => [e.location, e.hop, e.meshBars, e.meshQuality])).toEqual([
      ["Living Room", 0, null, null],
      ["Garage", 2, 2, "weak"],
      ["Office", 1, 5, "excellent"],
      ["Upstairs Hall", 1, 4, "excellent"],
    ]);
    const garage = await engine.execute<M.Eero>("eero.get", { eero: "Garage" });
    expect(garage.ok && [garage.result.hop, garage.result.meshQuality]).toEqual([2, "weak"]);
  });

  it("gets one eero by name, id or serial", async () => {
    const engine = demoEngine();
    const byName = await engine.execute<M.Eero>("eero.get", { eero: "office" });
    expect(byName.ok && byName.result).toMatchObject({ id: "80012", location: "Office", model: "eero Pro 7" });
    const byId = await engine.execute<M.Eero>("eero.get", { eero: "80012", networkId: MAPLE });
    expect(byId.ok && byId.result.location).toBe("Office");
    const bySerial = await engine.execute<M.Eero>("eero.get", { eero: "MU0DEMO0000012" });
    expect(bySerial.ok && bySerial.result.id).toBe("80012");
  });

  it("fails bad_params for a missing, unknown or extra param", async () => {
    const engine = demoEngine();
    expect(await engine.execute("eero.get", {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("eero.get", { eero: "Attic" })).toMatchObject({ ok: false, error: { code: "bad_params", message: 'No eero matches "Attic".' } });
    expect(await engine.execute("eero.list", { bogus: 1 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("are queries that poll every 60 s", () => {
    const info = demoEngine().commands().filter((c) => c.id.startsWith("eero."));
    expect(info.map((c) => [c.id, c.effect, c.poll])).toEqual([
      ["eero.list", "query", 60],
      ["eero.get", "query", 60],
      ["eero.ports.get", "query", 60],
      ["eero.firmware.history", "query", null],
    ]);
  });
});

describe("eero.ports.get and eero.firmware.history (demo)", () => {
  it("lists ports with speeds, attachments and actions", async () => {
    const r = await demoEngine().execute<M.EeroPorts>("eero.ports.get", { eero: "Living Room" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result.eeroId).toBe("80011");
    const [wan, ...lan] = r.result.ports;
    expect(wan).toMatchObject({ number: 1, isWan: true, status: "up", speedMbps: 10_000 });
    expect(lan.every((p) => !p.isWan)).toBe(true);
    expect(r.result.ports.map((p) => p.number)).toEqual([1, 2, 3, 4]);
    const office = await demoEngine().execute<M.EeroPorts>("eero.ports.get", { eero: "Office" });
    expect(office.ok && office.result.ports.map((p) => [p.number, p.status, p.speedMbps, p.attached?.name ?? null])).toEqual([
      [1, "up", 2500, "Office iMac"],
      [2, "down", null, null],
    ]);
  });

  it("answers an empty list for an eero without ports", async () => {
    const r = await demoEngine().execute<M.EeroPorts>("eero.ports.get", { eero: "Garage" });
    expect(r.ok && r.result).toEqual({ eeroId: "80014", ports: [] });
  });

  it("lists firmware newest first with the running version current", async () => {
    const r = await demoEngine().execute<M.FirmwareEntry[]>("eero.firmware.history", { eero: "Office" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result[0]).toMatchObject({ version: "7.12.1", current: true });
    expect(r.result.filter((f) => f.current)).toHaveLength(1);
    const times = r.result.map((f) => Date.parse(f.installedAt ?? ""));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const two = await demoEngine().execute<M.FirmwareEntry[]>("eero.firmware.history", { eero: "Office", limit: 2 });
    expect(two.ok && two.result.map((f) => f.version)).toEqual(r.result.slice(0, 2).map((f) => f.version));
  });

  it("fails bad_params for missing, unknown, extra or out of range params", async () => {
    const engine = demoEngine();
    for (const id of ["eero.ports.get", "eero.firmware.history"]) {
      expect(await engine.execute(id, {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
      expect(await engine.execute(id, { eero: "Attic" })).toMatchObject({ ok: false, error: { code: "bad_params", message: 'No eero matches "Attic".' } });
      expect(await engine.execute(id, { eero: "Office", bogus: 1 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
    expect(await engine.execute("eero.firmware.history", { eero: "Office", limit: 0 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("eero.firmware.history", { eero: "Office", limit: 51 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("refuses an eero from another network", async () => {
    const engine = demoEngine();
    // Great Room is Lake Cabin's gateway; the selected network is Maple Street.
    for (const id of ["eero.ports.get", "eero.firmware.history"]) {
      expect(await engine.execute(id, { eero: "Great Room" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
      expect(await engine.execute(id, { eero: "81021", networkId: MAPLE })).toMatchObject({ ok: false });
    }
    expect(await engine.backend.eero.ports(MAPLE, "81021").catch((e: Error) => e.message)).toMatch(/eero/i);
    expect(await engine.backend.eero.firmwareHistory(MAPLE, "81021", 5).catch((e: Error) => e.message)).toMatch(/eero/i);
  });
});

// ---------------------------------------------------------------------------
// Against the fake eero server, through the real client and mappers.

function fakeEngine() {
  const fake = createFakeEero();
  const token = fake.signIn();
  const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
  const live = createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch });
  const auth: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
  const summary = (id: string, name: string) => ({ id, name, nickname: null, role: "owner", status: "online", eeroCount: null, devicesOnline: null, isp: null, updateAvailable: null, lastSeen: null, selected: false }) as M.NetworkSummary;
  // Stub auth (no eero auth area yet) and network (keeps these tests to their own routes).
  const backend = composeBackend("eero", {
    auth: { ...live.auth, status: async () => auth },
    network: { ...live.network, list: async () => [summary("100001", "Maple Street"), summary("100002", "Lake Cabin")] },
    eero: live.eero,
    device: live.device,
    profile: live.profile,
  });
  return { fake, engine: createEngine({ backend }) };
}

describe("eero commands (fake eero server)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  it("maps GET {net}/eeros", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.Eero[]>("eero.list");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result.map((e) => [e.id, e.location, e.status, e.isGateway, e.backhaul, e.upstream, e.meshBars])).toEqual([
      ["500001", "Living Room", "online", true, "wired", null, null],
      ["500004", "Garage", "degraded", false, "wireless", "500001", 1],
      ["500002", "Office", "online", false, "wireless", "500001", 5],
      ["500003", "Upstairs Hall", "online", false, "wireless", "500001", 4],
    ]);
    const garage = r.result.find((e) => e.location === "Garage");
    expect(garage).toMatchObject({ model: "eero Beacon", bands: ["2.4", "5", "6"], nightlight: { mode: "off", brightness: 50, on: "20:00", off: "07:00" }, firmware: "7.10.1", updateAvailable: true });
    expect(fake.log.map((l) => `${l.method} ${l.path}`).sort()).toEqual(["GET /2.2/networks/100001", "GET /2.2/networks/100001/eeros"]);
    // Automatic DHCP: eero does not say which range it picked. The gateway is the gateway eero's address.
    expect(r.result.map((e) => [e.subnet, e.gatewayIp])).toEqual(Array(4).fill([null, "192.168.4.1"]));
  });

  it("maps a custom DHCP subnet and drops the gateway in bridge mode", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const net = fake.state.networks.get("100001");
    if (!net) throw new Error("no fake network");
    net.network.dhcp = { mode: "custom", custom: { subnet_ip: "10.8.0.0", subnet_mask: "255.255.255.0", start_ip: "10.8.0.10", end_ip: "10.8.0.200" } };
    const office = await engine.execute<M.Eero>("eero.get", { eero: "Office" });
    expect(office.ok && [office.result.subnet, office.result.gatewayIp]).toEqual(["10.8.0.0/24", "192.168.4.1"]);
    net.network.connection = { mode: "bridged" };
    const list = await engine.execute<M.Eero[]>("eero.list");
    expect(list.ok && list.result[0]?.gatewayIp).toBeNull();
  });

  it("maps ports: speeds, WAN, actions and attached devices joined by MAC", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.EeroPorts>("eero.ports.get", { eero: "Living Room" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result.eeroId).toBe("500001");
    expect(r.result.ports.map((p) => [p.number, p.name, p.status, p.speedMbps, p.supportedMbps, p.isWan, p.actions])).toEqual([
      [1, "WAN", "up", 2500, 2500, true, []],
      [2, "Port 2", "up", 1000, 2500, false, ["DISABLE_PORT", "RESTART_POWER"]],
    ]);
    const tv = r.result.ports[1]?.attached;
    const devices = await engine.execute<{ devices: M.Device[] }>("device.list");
    const tvDevice = devices.ok ? devices.result.devices.find((d) => d.name === "Living Room TV") : undefined;
    expect(tv).toEqual({ deviceId: tvDevice?.id, eeroId: null, name: "Living Room TV" });
    expect(fake.log.map((l) => l.path)).toContain("/2.2/eeros/500001/connections");
  });

  it("joins an attached eero by MAC and skips the joins when nothing is plugged in", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const net = fake.state.networks.get("100001");
    if (!net) throw new Error("no fake network");
    const office = net.eeros.find((e) => e.location === "Office");
    const ifaces = net.connections["500003"]?.ports?.interfaces ?? [];
    expect(ifaces.length).toBeGreaterThan(0);
    const before = fake.log.length;
    const idle = await engine.execute<M.EeroPorts>("eero.ports.get", { eero: "Office" });
    expect(idle.ok && idle.result.ports.every((p) => p.attached === null && p.status === "down" && p.speedMbps === null)).toBe(true);
    expect(fake.log.slice(before).some((l) => l.path.endsWith("/devices"))).toBe(false);
    // Plug the Office eero (wired backhaul) into Upstairs Hall port 1; the neighbor carries only a MAC in upper case.
    if (ifaces[0]) Object.assign(ifaces[0], { port_status: "UP", negotiated_speed: "P10G", neighbor: { type: "EERO", metadata: { mac: office?.mac_address?.toUpperCase() } } });
    const r = await engine.execute<M.EeroPorts>("eero.ports.get", { eero: "Upstairs Hall" });
    expect(r.ok && r.result.ports[0]).toMatchObject({ status: "up", speedMbps: 10_000, attached: { deviceId: null, eeroId: "500002", name: "Office" } });
  });

  it("answers an empty port list for an eero that reports none", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.EeroPorts>("eero.ports.get", { eero: "Garage" });
    expect(r.ok && r.result).toEqual({ eeroId: "500004", ports: [] });
  });

  it("sorts firmware history newest first (eero stores it oldest first) and marks current", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.FirmwareEntry[]>("eero.firmware.history", { eero: "Office" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result.map((f) => [f.version, f.current])).toEqual([
      ["7.10.1", true],
      ["7.9.2", false],
      ["7.8.0", false],
    ]);
    const one = await engine.execute<M.FirmwareEntry[]>("eero.firmware.history", { eero: "Office", limit: 1 });
    expect(one.ok && one.result.map((f) => f.version)).toEqual(["7.10.1"]);
    const call = fake.log.find((l) => l.path === "/2.2/eeros/500002/firmware_update/history");
    expect(call?.query).toBe("?limit=50&offset=0");
  });

  it("answers no history when eero has no history endpoint, and refuses other networks' eeros", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    expect(await engine.backend.eero.firmwareHistory("100001", "500010", 5).catch((e: Error) => e.message)).toBe("That eero is not on this network.");
    expect(await engine.backend.eero.ports("100001", "500010").catch((e: Error) => e.message)).toBe("That eero is not on this network.");
    expect(await engine.execute("eero.ports.get", { eero: "Cabin" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    const net = fake.state.networks.get("100001");
    if (net) delete net.firmwareHistory["500002"];
    const r = await engine.execute<M.FirmwareEntry[]>("eero.firmware.history", { eero: "Office" });
    expect(r.ok && r.result).toEqual([]);
  });

  it("gets one eero by location and refuses one from another network", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.Eero>("eero.get", { eero: "Office" });
    expect(r.ok && r.result).toMatchObject({ id: "500002", serial: "FAKE00OF0002", location: "Office" });
    expect(fake.log.map((l) => l.path)).toContain("/2.2/eeros/500002");
    const other = await engine.execute("eero.get", { eero: "Cabin", networkId: "Maple Street" });
    expect(other).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.backend.eero.get("100001", "500010").catch((e: Error) => e.message)).toBe("That eero is not on this network.");
  });
});

describe("hop and mesh quality", () => {
  const eero = (id: string, o: Partial<M.Eero> = {}) => ({ id, isGateway: false, upstream: null, backhaul: "wireless", meshBars: null, hop: null, meshQuality: null, ...o }) as M.Eero;

  it("follows the bar rules: 4 to 5 excellent, 3 good, 2 weak, 0 to 1 poor, wired none", () => {
    expect([5, 4, 3, 2, 1, 0].map((meshBars) => meshQuality({ backhaul: "wireless", meshBars }))).toEqual(["excellent", "excellent", "good", "weak", "poor", "poor"]);
    expect(meshQuality({ backhaul: "wired", meshBars: 5 })).toBeNull();
    expect(meshQuality({ backhaul: "wireless", meshBars: null })).toBeNull();
    expect(meshQuality({ backhaul: null, meshBars: 3 })).toBeNull();
  });

  it("counts links from the gateway and gives null for a broken chain", () => {
    const hops = (list: M.Eero[]) => Object.fromEntries(withTopology(list).map((e) => [e.id, e.hop]));
    expect(hops([eero("c", { upstream: "b" }), eero("gw", { isGateway: true, backhaul: "wired" }), eero("b", { upstream: "gw" }), eero("w", { backhaul: "wired" })])).toEqual({ c: 2, gw: 0, b: 1, w: 1 });
    expect(hops([eero("gw", { isGateway: true }), eero("x", { upstream: "y" }), eero("y", { upstream: "x" }), eero("z", { upstream: "gone" })])).toEqual({ gw: 0, x: null, y: null, z: null });
    expect(hops([eero("a"), eero("b", { upstream: "a" })])).toEqual({ a: null, b: null });
  });
});

describe("eero mapper", () => {
  it("normalises bands, status and odd fields without throwing", () => {
    expect(["band_2_4GHz", "band_5GHz_low", "band_5GHz_high", "band_6GHz", "5", "2.4GHz", "x"].map(bandOf)).toEqual(["2.4", "5", "5", "6", "5", "2.4", null]);
    expect(eeroStatus({ status: "green", heartbeat_ok: false })).toBe("offline");
    expect(eeroStatus({ status: "green", state: "UPDATING" })).toBe("updating");
    expect(eeroStatus({})).toBe("unknown");
    const e = mapEero({
      url: "/2.2/eeros/9",
      radio_channel_stats: { band_5GHz_low: { channel: 36, channel_width: "80MHz", client_count: 2 }, band_5GHz_high: { channel: 149, client_count: 3 } },
      update_status: { support_expired: true, support_expiration_date: "2027-01-01T00:00:00Z" },
      messages: ["Hi", { message: "There" }, 3],
    });
    expect(e).toMatchObject({ id: "9", location: "eero", backhaul: null, radios: [{ band: "5", channel: 36, widthMhz: 80, clients: 5 }], endOfLife: { expired: true }, messages: ["Hi", "There"] });
    expect(() => mapEero({})).not.toThrow();
    // Hop and quality come from core; LAN facts from the network (none given here).
    expect(mapEero({})).toMatchObject({ hop: null, meshQuality: null, subnet: null, gatewayIp: null });
    expect(e.radios[0]).toMatchObject({ txPowerDbm: null, autoChannel: null });
    expect(mapEero({ radio_channel_stats: { band_2_4GHz: { channel: 6, tx_power: 20, channel_utilization: 31 } } }).radios[0]).toMatchObject({ band: "2.4", txPowerDbm: 20, utilization: 31 });
  });

  it("reads LAN subnets and the gateway address", () => {
    expect(cidr("192.168.4.7", "255.255.252.0")).toBe("192.168.4.0/22");
    expect(cidr("10.0.0.0", "255.0.0.0")).toBe("10.0.0.0/8");
    expect(cidr("10.0.0.0", "255.0.255.0")).toBeNull();
    expect(cidr("300.0.0.0", "255.255.255.0")).toBeNull();
    expect(cidr(null, "255.255.255.0")).toBeNull();
    const gw = { gateway: true, ip_address: "192.168.7.1" };
    expect(lanOf({ dhcp: { mode: "custom", custom: { subnet_ip: "192.168.7.0", subnet_mask: "255.255.255.0" } } }, [{ ip_address: "192.168.7.9" }, gw])).toEqual({ subnet: "192.168.7.0/24", gatewayIp: "192.168.7.1" });
    expect(lanOf({ dhcp: { mode: "automatic" }, connection: { mode: "bridged" } }, [gw])).toEqual({ subnet: null, gatewayIp: null });
    expect(lanOf(null, [])).toEqual({ subnet: null, gatewayIp: null });
  });

  it("parses port speeds", () => {
    expect(["P2500", "P1000", "P100", "P10G", "P5000", "2.5Gbps", "1000Mbps", 2500, "", "PX", null, 0].map(portSpeed)).toEqual([2500, 1000, 100, 10_000, 5000, 2500, 1000, 2500, null, null, null, null]);
  });

  it("maps odd port rows without throwing", () => {
    const r = mapPorts("1", { ports: { interfaces: [{ interface_number: 2, port_status: "disabled", poe_status: "ENABLED", actions: [{ type: "enable_port" }, { type: "ENABLE_PORT_SECURITY" }, {}] }, { port_status: "UP", negotiated_speed: "P1000", neighbor: { type: "DEVICE", metadata: { mac: "AA:BB:CC:00:11:22", display_name: "NAS" } } }] } }, { devices: [], eeros: [] });
    expect(r.ports).toEqual([
      { number: 2, name: null, status: "disabled", speedMbps: null, supportedMbps: null, isWan: false, poe: "on", mac: null, attached: null, actions: ["ENABLE_PORT"] },
      { number: 2, name: null, status: "up", speedMbps: 1000, supportedMbps: null, isWan: false, poe: null, mac: null, attached: { deviceId: "aabbcc001122", eeroId: null, name: "NAS" }, actions: [] },
    ]);
    expect(mapPorts("1", null, { devices: [], eeros: [] })).toEqual({ eeroId: "1", ports: [] });
  });

  it("orders firmware history and marks only the newest running version current", () => {
    const rows = [
      { os_version: "7.1", installed: "2026-01-01T00:00:00Z" },
      { version: "7.3", installed_at: "2026-03-01T00:00:00Z" },
      { os_version: "7.1", created: "2026-04-01T00:00:00Z" },
      { os_version: "7.0" },
      { status: "failed" },
    ];
    expect(mapFirmwareHistory(rows, "7.1")).toEqual([
      { version: "7.1", installedAt: "2026-04-01T00:00:00Z", current: true },
      { version: "7.3", installedAt: "2026-03-01T00:00:00Z", current: false },
      { version: "7.1", installedAt: "2026-01-01T00:00:00Z", current: false },
      { version: "7.0", installedAt: null, current: false },
    ]);
    expect(mapFirmwareHistory(rows, null).some((f) => f.current)).toBe(false);
  });
});
