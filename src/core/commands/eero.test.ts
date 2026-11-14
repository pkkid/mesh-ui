import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { bandOf, eeroStatus, lanOf, mapEero, mapFirmwareHistory, mapPorts, portSpeed } from "../eero/map/eero";
import { createEngine } from "../engine";
import { allCommands } from "../registry";
import { eeroRestartMessage, meshQuality, restartedBy, withTopology } from "./eero";
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
    expect(info.filter((c) => c.effect === "query").map((c) => [c.id, c.effect, c.poll])).toEqual([
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
      // Wireless parents come by name (eero sends no url); the wired one from its EERO neighbour on the WAN-labelled port.
      ["500004", "Garage", "degraded", false, "wireless", "500002", 1],
      ["500002", "Office", "online", false, "wireless", "500001", 5],
      ["500003", "Upstairs Hall", "online", false, "wired", "500001", null],
    ]);
    // Hop follows the real links, not the "hangs off the gateway" fallback.
    expect(r.result.map((e) => [e.location, e.hop])).toEqual([
      ["Living Room", 0],
      ["Garage", 2],
      ["Office", 1],
      ["Upstairs Hall", 1],
    ]);
    const garage = r.result.find((e) => e.location === "Garage");
    expect(garage).toMatchObject({ model: "eero Beacon", bands: ["2.4", "5", "6"], nightlight: { mode: "off", brightness: 50, on: "20:00", off: "07:00" }, firmware: "7.10.1", updateAvailable: true });
    expect(fake.log.map((l) => `${l.method} ${l.path}`).sort()).toEqual(["GET /2.2/networks/100001", "GET /2.2/networks/100001/eeros"]);
    // Automatic DHCP: eero's default LAN, as reservation.list reports it. The gateway is the gateway eero's address.
    expect(r.result.map((e) => [e.subnet, e.gatewayIp])).toEqual(Array(4).fill(["192.168.4.0/22", "192.168.4.1"]));
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

  it("joins an attached eero by url and skips the joins when nothing is plugged in", async () => {
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
    // Plug the Office eero and a switch with two devices into Upstairs Hall port 1, as eero reports it.
    if (ifaces[0]) {
      Object.assign(ifaces[0], {
        port_status: "DATA_CONNECTED",
        negotiated_speed: "P10G",
        connection_status: {
          type: "MULTIPLE_DEVICES",
          metadata: { multiple_devices: { connections: [{ type: "CLIENT_DEVICE", metadata: { display_name: "Printer", url: "/2.2/networks/100001/devices/0" } }, { type: "EERO_DEVICE", metadata: { location: "Office", model: "eero Pro 7", url: office?.url } }] } },
        },
      });
    }
    const r = await engine.execute<M.EeroPorts>("eero.ports.get", { eero: "Upstairs Hall" });
    expect(r.ok && r.result.ports[0]).toMatchObject({ status: "up", speedMbps: 10_000, attached: { deviceId: null, eeroId: "500002", name: "Office" } });
  });

  it("answers an empty port list for an eero that reports none", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.EeroPorts>("eero.ports.get", { eero: "Garage" });
    expect(r.ok && r.result).toEqual({ eeroId: "500004", ports: [] });
  });

  it("maps firmware history rows (firmware_version, finished_at) newest first and marks current", async () => {
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
    // A single read names the wireless parent from the list, so eero.get agrees with eero.list.
    const garage = await engine.execute<M.Eero>("eero.get", { eero: "Garage" });
    expect(garage.ok && [garage.result.upstream, garage.result.hop, garage.result.subnet]).toEqual(["500002", 2, "192.168.4.0/22"]);
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
    const gw = { gateway: true, ip_address: "192.168.7.1" };
    expect(lanOf({ dhcp: { mode: "custom", custom: { subnet_ip: "192.168.7.0", subnet_mask: "255.255.255.0" } } }, [{ ip_address: "192.168.7.9" }, gw])).toEqual({ subnet: "192.168.7.0/24", gatewayIp: "192.168.7.1" });
    // Automatic DHCP: eero's default LAN, the same source as reservation.list.
    expect(lanOf({ dhcp: { mode: "automatic" }, connection: { mode: "nat" } }, [gw])).toEqual({ subnet: "192.168.4.0/22", gatewayIp: "192.168.7.1" });
    expect(lanOf({ dhcp: { mode: "automatic" }, connection: { mode: "bridged" } }, [gw])).toEqual({ subnet: null, gatewayIp: null });
    expect(lanOf(null, [])).toEqual({ subnet: null, gatewayIp: null });
  });

  it("parses port speeds", () => {
    expect(["P2500", "P1000", "P100", "P10G", "P5000", "2.5Gbps", "1000Mbps", 2500, "", "PX", null, 0].map(portSpeed)).toEqual([2500, 1000, 100, 10_000, 5000, 2500, 1000, 2500, null, null, null, null]);
  });

  it("maps odd port rows without throwing", () => {
    const r = mapPorts("1", { ports: { interfaces: [{ interface_number: 2, port_status: "disabled", poe_status: "ENABLED", actions: [{ type: "enable_port" }, { type: "ENABLE_PORT_SECURITY" }, {}] }, { port_status: "DATA_CONNECTED", negotiated_speed: "P1000", connection_status: { type: "MULTIPLE_DEVICES", metadata: { multiple_devices: { connections: [{ type: "CLIENT_DEVICE", metadata: { url: "/2.2/networks/1/devices/aabbcc001122", display_name: "NAS" } }] } } } }, { interface_number: 3, port_status: "DISCONNECTED", negotiated_speed: "P1000", connection_status: { type: "MULTIPLE_DEVICES", metadata: { multiple_devices: { connections: [{ type: "CLIENT_DEVICE", metadata: {} }, { type: "CLIENT_DEVICE", metadata: {} }] } } } }] } }, { devices: [], eeros: [] });
    expect(r.ports).toEqual([
      { number: 2, name: null, status: "disabled", speedMbps: null, supportedMbps: null, isWan: false, poe: "on", mac: null, attached: null, actions: ["ENABLE_PORT"] },
      { number: 2, name: null, status: "up", speedMbps: 1000, supportedMbps: null, isWan: false, poe: null, mac: null, attached: { deviceId: "aabbcc001122", eeroId: null, name: "NAS" }, actions: [] },
      { number: 3, name: null, status: "down", speedMbps: null, supportedMbps: null, isWan: false, poe: null, mac: null, attached: { deviceId: null, eeroId: null, name: "2 devices" }, actions: [] },
    ]);
    expect(mapPorts("1", null, { devices: [], eeros: [] })).toEqual({ eeroId: "1", ports: [] });
  });

  it("orders firmware history and marks only the newest running version current", () => {
    const rows = [
      { firmware_version: "v7.1-2+20260101.prod", finished_at: "2026-01-01T00:00:00Z" },
      { firmware_version: "v7.3-1+20260301.prod", timestamp: "2026-03-01T00:00:00Z" },
      { firmware_version: "v7.1-2+20260401.prod", finished_at: "2026-04-01T00:00:00+0000", timestamp: "2026-03-31T23:59:00Z" },
      { firmware_version: "v7.0-9" },
      { firmware_version: "v7.4-0+20260501.prod", finished_at: "2026-05-01T00:00:00Z", outcome: "Failure", status: "failed" },
      { status: "completed" },
    ];
    expect(mapFirmwareHistory(rows, "v7.1-2")).toEqual([
      { version: "v7.1-2", installedAt: "2026-04-01T00:00:00.000Z", current: true },
      { version: "v7.3-1", installedAt: "2026-03-01T00:00:00.000Z", current: false },
      { version: "v7.1-2", installedAt: "2026-01-01T00:00:00.000Z", current: false },
      { version: "v7.0-9", installedAt: null, current: false },
    ]);
    expect(mapFirmwareHistory(rows, null).some((f) => f.current)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Writes (M4.8)

async function ok<R>(p: Promise<{ ok: true; result: R } | { ok: false; error: { code: string; message: string } }>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}

describe("eero writes (demo)", () => {
  it("registers effects and the topics each write invalidates", () => {
    const specs = Object.fromEntries(allCommands().map((c) => [c.id, c]));
    expect(["eero.rename", "eero.find", "eero.led.set", "eero.nightlight.set", "eero.restart"].map((id) => [id, specs[id]?.effect, specs[id]?.invalidates])).toEqual([
      ["eero.rename", "write", ["eeros", "network", "eero_ports"]],
      ["eero.find", "write", []],
      ["eero.led.set", "write", ["eeros"]],
      ["eero.nightlight.set", "write", ["eeros"]],
      ["eero.restart", "disruptive", ["eeros", "network"]],
    ]);
  });

  it("renames an eero, and the next read (cached before) shows it", async () => {
    const engine = demoEngine();
    await ok(engine.execute<M.Eero[]>("eero.list"));
    const r = await ok(engine.execute<M.Eero>("eero.rename", { eero: "Office", location: "  Study  " }));
    expect(r).toMatchObject({ id: "80012", location: "Study" });
    expect((await ok(engine.execute<M.Eero[]>("eero.list"))).map((e) => e.location)).toContain("Study");
    expect((await ok(engine.execute<M.Eero>("eero.get", { eero: "Study" }))).id).toBe("80012");
  });

  it("rejects bad rename, find and light params", async () => {
    const engine = demoEngine();
    const code = async (id: string, params: unknown) => ((await engine.execute(id, params)) as { error?: { code: string } }).error?.code;
    expect(await code("eero.rename", { eero: "Office", location: "" })).toBe("bad_params");
    expect(await code("eero.rename", { eero: "Office", location: "x".repeat(33) })).toBe("bad_params");
    expect(await code("eero.rename", { eero: "Attic", location: "Study" })).toBe("bad_params");
    expect(await code("eero.find", { eero: "Office", seconds: 5 })).toBe("bad_params");
    expect(await code("eero.find", { eero: "Office", seconds: 61 })).toBe("bad_params");
    expect(await code("eero.find", { eero: "Office", stop: true })).toBe("bad_params");
    expect(await code("eero.led.set", { eero: "Office" })).toBe("bad_params");
    expect(await code("eero.led.set", { eero: "Office", brightness: 101 })).toBe("bad_params");
    expect(await code("eero.nightlight.set", { eero: "Garage", mode: "dim" })).toBe("bad_params");
    expect(await code("eero.nightlight.set", { eero: "Garage", mode: "schedule", on: "25:00" })).toBe("bad_params");
  });

  it("blinks an eero for 30 s by default", async () => {
    const engine = demoEngine();
    expect(await ok(engine.execute("eero.find", { eero: "Office" }))).toEqual({ eeroId: "80012", seconds: 30 });
    expect(await ok(engine.execute("eero.find", { eero: "Office", seconds: 45 }))).toEqual({ eeroId: "80012", seconds: 45 });
  });

  it("sets the status light, keeping the field not given", async () => {
    const engine = demoEngine();
    expect((await ok(engine.execute<M.Eero>("eero.led.set", { eero: "Office", on: false }))).led).toEqual({ on: false, brightness: 60 });
    expect((await ok(engine.execute<M.Eero>("eero.led.set", { eero: "Office", brightness: 20 }))).led).toEqual({ on: false, brightness: 20 });
    expect((await ok(engine.execute<M.Eero>("eero.get", { eero: "Office" }))).led).toEqual({ on: false, brightness: 20 });
  });

  it("sets the Beacon nightlight and refuses an eero without one (capability check)", async () => {
    const engine = demoEngine();
    const r = await ok(engine.execute<M.Eero>("eero.nightlight.set", { eero: "Garage", mode: "schedule", on: "21:30" }));
    expect(r.nightlight).toEqual({ mode: "schedule", brightness: 40, on: "21:30", off: "07:00" });
    expect((await ok(engine.execute<M.Eero>("eero.get", { eero: "Garage" }))).nightlight).toEqual({ mode: "schedule", brightness: 40, on: "21:30", off: "07:00" });
    expect((await ok(engine.execute<M.Eero>("eero.nightlight.set", { eero: "Garage", mode: "off" }))).nightlight?.mode).toBe("off");
    expect(await engine.execute("eero.nightlight.set", { eero: "Office", mode: "ambient" })).toMatchObject({
      ok: false,
      error: { code: "bad_params", message: "Office has no nightlight. Only eero Beacon has one." },
    });
  });

  it("asks before a restart, naming the gateway outage or the leaf's downstream eeros", async () => {
    const engine = demoEngine();
    expect(await engine.execute("eero.restart", { eero: "Living Room" })).toMatchObject({
      ok: false,
      error: { code: "needs_confirm", message: "Living Room is the gateway: restarting it takes Maple Street offline. Every device loses internet for about 2 to 3 minutes." },
    });
    expect(await engine.execute("eero.restart", { eero: "Office" })).toMatchObject({
      ok: false,
      error: { code: "needs_confirm", message: "Restarts Office. Its devices drop for about 1 minute. Garage connects through it and drops too." },
    });
    expect(await engine.execute("eero.restart", { eero: "Upstairs Hall" })).toMatchObject({ error: { message: "Restarts Upstairs Hall. Its devices drop for about 1 minute." } });
    // Nothing restarted while asking.
    expect((await ok(engine.execute<M.Eero[]>("eero.list"))).every((e) => e.status !== "updating")).toBe(true);
  });

  it("restarts with confirm: the eero and those through it show updating", async () => {
    const engine = demoEngine();
    const r = await ok(engine.execute("eero.restart", { eero: "Office", confirm: true }));
    expect(r).toEqual({ networkId: MAPLE, eeroIds: ["80012", "80014"], estimate: "about 1 minute" });
    const office = await ok(engine.execute<M.Eero>("eero.get", { eero: "Office" }));
    expect(office.status).toBe("updating");
    const gw = await ok(engine.execute("eero.restart", { eero: "Living Room", confirm: true }));
    expect(gw).toMatchObject({ estimate: "about 2 to 3 minutes" });
    expect((gw as { eeroIds: string[] }).eeroIds).toHaveLength(4);
  });

  it("lists who a restart takes down", () => {
    const eeros = [
      { id: "g", location: "G", isGateway: true, upstream: null },
      { id: "a", location: "A", isGateway: false, upstream: "g" },
      { id: "b", location: "B", isGateway: false, upstream: "a" },
      { id: "c", location: "C", isGateway: false, upstream: "b" },
      { id: "d", location: "D", isGateway: false, upstream: "a" },
    ];
    expect(restartedBy(eeros[1]!, eeros).sort()).toEqual(["a", "b", "c", "d"]);
    expect(restartedBy(eeros[3]!, eeros)).toEqual(["c"]);
    expect(restartedBy(eeros[0]!, eeros)).toHaveLength(5);
    expect(eeroRestartMessage(eeros[1]!, eeros, "Home")).toBe("Restarts A. Its devices drop for about 1 minute. B, D connect through it and drop too.");
  });
});

describe("eero writes (fake eero server)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  it("rename sends PUT {eero} with a form location, and the next read shows it", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    await ok(engine.execute("eero.list"));
    const r = await ok(engine.execute<M.Eero>("eero.rename", { eero: "Office", location: "Study" }));
    expect(r.location).toBe("Study");
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({ method: "PUT", path: "/2.2/eeros/500002", encoding: "form", body: { location: "Study" }, status: 200 });
    // eeros was invalidated: the list reads eero again and shows the new name.
    const before = fake.log.length;
    expect((await ok(engine.execute<M.Eero[]>("eero.list"))).map((e) => e.location)).toContain("Study");
    expect(fake.log.length).toBeGreaterThan(before);
  });

  it("status light goes through resources.led_action with a form body", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const raw = fake.state.networks.get("100001")?.eeros.find((e) => e.location === "Office");
    if (!raw?.resources) throw new Error("fixture");
    raw.resources.led_action = "/2.2/eeros/500002/led_custom";
    expect(await engine.execute("eero.led.set", { eero: "Office", on: false, brightness: 30 })).toMatchObject({ ok: false });
    expect(fake.writes.at(-1)).toMatchObject({ method: "PUT", path: "/2.2/eeros/500002/led_custom", encoding: "form", body: { led_on: "false", led_brightness: "30" } });
    raw.resources.led_action = "/2.2/eeros/500002/led";
    const r = await ok(engine.execute<M.Eero>("eero.led.set", { eero: "Office", brightness: 40 }));
    expect(fake.writes.at(-1)).toMatchObject({ method: "PUT", path: "/2.2/eeros/500002/led", contentType: "application/x-www-form-urlencoded", body: { led_brightness: "40" } });
    expect(fake.writes.at(-1)?.body).not.toHaveProperty("led_on");
    expect(r.led).toEqual({ on: true, brightness: 40 });
    expect(raw.led_brightness).toBe(40);
  });

  it("find posts led_cycle by serial with blue and white colours", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const serial = fake.state.networks.get("100001")?.eeros.find((e) => e.location === "Office")?.serial;
    expect(await ok(engine.execute("eero.find", { eero: "Office", seconds: 20 }))).toEqual({ eeroId: "500002", seconds: 20 });
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      method: "POST",
      path: `/2.2/eeros/${serial}/led_cycle`,
      encoding: "form",
      body: { "colors[]": ["blue", "white"], duration: "20", time_per_color: "1" },
      status: 200,
    });
    expect(fake.writes[0]?.rawBody).toBe("colors%5B%5D=blue&colors%5B%5D=white&duration=20&time_per_color=1");
  });

  it("nightlight sends JSON to the nightlight link; a non-Beacon fails the capability check without a write", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await ok(engine.execute<M.Eero>("eero.nightlight.set", { eero: "Garage", mode: "schedule", brightness: 70, on: "21:00", off: "06:30" }));
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      method: "PUT",
      path: "/2.2/eeros/500004/nightlight/settings",
      encoding: "json",
      body: { enabled: true, brightness_percentage: 70, schedule: { enabled: true, on: "21:00", off: "06:30" } },
    });
    expect(r.nightlight).toEqual({ mode: "schedule", brightness: 70, on: "21:00", off: "06:30" });
    await ok(engine.execute("eero.nightlight.set", { eero: "Garage", mode: "ambient" }));
    expect(fake.writes.at(-1)?.body).toEqual({ enabled: true, brightness_percentage: 70, schedule: { enabled: false, on: "21:00", off: "06:30" } });
    expect(await engine.execute("eero.nightlight.set", { eero: "Office", mode: "ambient" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(fake.writes).toHaveLength(2);
  });

  it("restart needs confirm, then posts resources.reboot with an empty body", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    expect(await engine.execute("eero.restart", { eero: "Living Room" })).toMatchObject({ ok: false, error: { code: "needs_confirm", message: expect.stringContaining("is the gateway") } });
    expect(fake.writes).toHaveLength(0);
    const r = await ok(engine.execute("eero.restart", { eero: "Upstairs Hall", confirm: true }));
    expect(r).toEqual({ networkId: "100001", eeroIds: ["500003"], estimate: "about 1 minute" });
    expect(fake.writes).toEqual([expect.objectContaining({ method: "POST", path: "/2.2/eeros/500003/reboot", encoding: "empty", rawBody: '""', status: 201 })]);
  });

  it("maps an offline eero's refusal to eero_error", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute("eero.restart", { eero: "Garage", confirm: true });
    // Garage is yellow in the fixture; force it offline.
    expect(r.ok).toBe(true);
    const garage = fake.state.networks.get("100001")?.eeros.find((e) => e.location === "Garage");
    if (garage) garage.status = "red";
    expect(await engine.execute("eero.restart", { eero: "Garage", confirm: true })).toMatchObject({ ok: false, error: { code: "eero_error" } });
  });
});

