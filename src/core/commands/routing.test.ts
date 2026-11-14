import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapLan, mapRouting } from "../eero/map/routing";
import { createEngine } from "../engine";
import type * as M from "../model";
import type { ForwardList, PinholeList, ReservationList } from "./routing";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const KIM = "6092118";

function demo() {
  const backend = createDemoBackend({ clock: () => NOW });
  return { backend, engine: createEngine({ backend, clock: () => NOW }) };
}

async function ok<R>(engine: ReturnType<typeof createEngine>, id: string, params: Record<string, unknown> = {}): Promise<R> {
  const r = await engine.execute<R>(id, params);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}

describe("reservation.list (demo)", () => {
  it("lists reservations joined to devices, with the LAN map and leased count", async () => {
    const { engine } = demo();
    const r = await ok<ReservationList>(engine, "reservation.list");
    const devices = (await ok<M.DeviceList>(engine, "device.list")).devices;
    expect(r.unavailable).toBeNull();
    expect(r.reservations.length).toBeGreaterThan(0);
    expect(r.reservations.map((x) => x.name)).toEqual([...r.reservations.map((x) => x.name)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    for (const x of r.reservations) {
      const d = devices.find((y) => y.id === x.deviceId);
      expect(d?.mac).toBe(x.mac);
    }
    const mbp = r.reservations.find((x) => x.name === "Alex's MacBook Pro");
    expect(mbp).toMatchObject({ ip: "192.168.4.23", forwards: 3 });
    expect(r.lan).toMatchObject({ subnet: "192.168.4.0/22", size: 1024, gateway: "192.168.4.1", staticRange: { start: "192.168.4.2", end: "192.168.4.99" } });
    // Reserved devices sit in the static range; the other connected main-network clients hold pool leases (.4.100 up). Guests (Grandma's iPad) do not.
    expect(r.lan?.pool.leased).toBe(22);
    // The leased addresses behind the count, for the address map: unique, in address order, all inside the pool.
    expect(r.leases).toHaveLength(22);
    expect(new Set(r.leases).size).toBe(22);
    const num = (ip: string) => ip.split(".").reduce((a, n) => a * 256 + Number(n), 0);
    expect(r.leases.map(num)).toEqual([...r.leases.map(num)].sort((a, b) => a - b));
    for (const ip of r.leases) expect(num(ip) >= num("192.168.4.100") && num(ip) <= num("192.168.7.254")).toBe(true);
    for (const x of r.reservations) expect(r.leases).not.toContain(x.ip);
  });

  it("counts leases as connected main-network devices inside the pool without a reservation", async () => {
    const { backend } = demo();
    const devices = await backend.device.list("4821907");
    const routing = await backend.routing.get("4821907");
    const base = devices.find((d) => d.connected && d.ssid === "main" && !routing.reservations.some((x) => x.deviceId === d.id));
    if (!base) throw new Error("fixture");
    const at = (id: string, ipv4: string, extra: Partial<M.Device> = {}): M.Device => ({ ...base, id, mac: `0a:00:00:00:00:${id}`, ipv4, ...extra });
    const list = [
      at("01", "192.168.4.150"),
      at("02", "192.168.7.254"),
      at("03", "192.168.4.50"), // static range
      at("04", "192.168.4.160", { ssid: "guest" }),
      at("05", "192.168.4.170", { connected: false }),
      // Blocked but still reported connected with a pool address: never a lease.
      at("06", "192.168.4.180", { blocked: true }),
    ];
    const engine = createEngine({ backend: { ...backend, device: { ...backend.device, list: async () => list } }, clock: () => NOW });
    expect((await ok<ReservationList>(engine, "reservation.list")).lan?.pool.leased).toBe(2);
  });

  it("never counts a blocked device as leased, using device.list's blocked flag", async () => {
    const { backend } = demo();
    const devices = await backend.device.list("4821907");
    const routing = await backend.routing.get("4821907");
    const reserved = new Set(routing.reservations.map((x) => x.deviceId));
    const lease = devices.find((d) => d.connected && d.ssid === "main" && !reserved.has(d.id) && d.ipv4?.startsWith("192.168.4.1"));
    if (!lease) throw new Error("fixture");
    const before = (await ok<ReservationList>(demo().engine, "reservation.list")).lan?.pool.leased ?? 0;
    // Block one leased device the way a backend might report it: still connected, pool address kept.
    const list = devices.map((d) => (d.id === lease.id ? { ...d, blocked: true } : d));
    const engine = createEngine({ backend: { ...backend, device: { ...backend.device, list: async () => list } }, clock: () => NOW });
    const listed = (await ok<M.DeviceList>(engine, "device.list")).devices.find((d) => d.id === lease.id);
    expect(listed?.blocked).toBe(true);
    expect((await ok<ReservationList>(engine, "reservation.list")).lan?.pool.leased).toBe(before - 1);
  });

  it("answers empty with a reason in bridge mode", async () => {
    const { engine } = demo();
    expect(await ok<ReservationList>(engine, "reservation.list", { networkId: KIM })).toEqual({
      reservations: [],
      lan: null,
      leases: [],
      unavailable: "Reservations and port forwards are off while the network is in bridge mode.",
    });
  });

  it("is a cached query on the routing topic", async () => {
    const { engine } = demo();
    expect(engine.commands().find((c) => c.id === "reservation.list")).toMatchObject({ effect: "query" });
    expect(await engine.execute("reservation.list", { networkId: "Nowhere" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});

describe("forward.list (demo)", () => {
  it("lists every forward, or one device's, by port", async () => {
    const { engine } = demo();
    const all = await ok<ForwardList>(engine, "forward.list");
    expect(all.unavailable).toBeNull();
    expect(all.forwards.length).toBeGreaterThan(3);
    const mine = await ok<ForwardList>(engine, "forward.list", { device: "alex's macbook pro" });
    expect(mine.forwards.map((f) => [f.name, f.externalPort, f.protocol, f.enabled])).toEqual([
      ["Web dev server", "8080", "tcp", true],
      ["Syncthing", "22000", "both", true],
      ["Game server", "27015-27030", "udp", false],
    ]);
    const deviceId = mine.forwards[0]?.deviceId;
    expect(mine.forwards.every((f) => f.deviceId === deviceId)).toBe(true);
    // By MAC too; a device with no forwards gets an empty list.
    const mac = (await ok<M.Device>(engine, "device.get", { device: "Alex's MacBook Pro" })).mac;
    expect((await ok<ForwardList>(engine, "forward.list", { device: mac })).forwards).toHaveLength(3);
    expect((await ok<ForwardList>(engine, "forward.list", { device: "Desk Lamp" })).forwards).toEqual([]);
  });

  it("fails bad_params for an unknown device or bad params", async () => {
    const { engine } = demo();
    expect(await engine.execute("forward.list", { device: "Toaster" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("forward.list", { device: "" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("forward.list", { device: 42 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("answers empty with a reason in bridge mode", async () => {
    const { engine } = demo();
    const r = await ok<ForwardList>(engine, "forward.list", { networkId: KIM });
    expect(r).toEqual({ forwards: [], unavailable: "Reservations and port forwards are off while the network is in bridge mode." });
  });
});

describe("pinhole.list (demo)", () => {
  it("lists IPv6 pinholes by port, each joined to a device with its IPv6 address", async () => {
    const { engine } = demo();
    const r = await ok<PinholeList>(engine, "pinhole.list");
    const devices = (await ok<M.DeviceList>(engine, "device.list")).devices;
    expect(r.unavailable).toBeNull();
    expect(r.pinholes.map((p) => [devices.find((d) => d.id === p.deviceId)?.name, p.port, p.protocol])).toEqual([
      ["Synology NAS", "443", "tcp"],
      ["PlayStation 5", "3074", "udp"],
    ]);
    for (const p of r.pinholes) expect(devices.find((d) => d.id === p.deviceId)?.ipv6).toContain(p.address);
    expect(engine.commands().find((c) => c.id === "pinhole.list")).toMatchObject({ effect: "query", label: "IPv6 firewall rules" });
  });

  it("joins a pinhole named by MAC and fills a missing address from the device", async () => {
    const { backend } = demo();
    const devices = await backend.device.list("4821907");
    const nas = devices.find((d) => d.name === "Synology NAS");
    if (!nas) throw new Error("fixture");
    const get = backend.routing.get;
    const routing = { ...backend.routing, get: async (net: M.Id) => ({ ...(await get(net)), pinholes: [{ id: "1", deviceId: nas.mac.replace(/:/g, "").toUpperCase(), address: null, port: "22", protocol: "tcp" as const }] }) };
    const engine = createEngine({ backend: { ...backend, routing }, clock: () => NOW });
    expect((await ok<PinholeList>(engine, "pinhole.list")).pinholes).toEqual([{ id: "1", deviceId: nas.id, address: nas.ipv6[0] ?? null, port: "22", protocol: "tcp" }]);
  });

  it("fails bad_params for unknown params or an unknown network", async () => {
    const { engine } = demo();
    expect(await engine.execute("pinhole.list", { device: "Synology NAS" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("pinhole.list", { networkId: "Nowhere" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("answers empty with a reason in bridge mode, and empty on a network with none", async () => {
    const { engine } = demo();
    expect(await ok<PinholeList>(engine, "pinhole.list", { networkId: KIM })).toEqual({
      pinholes: [],
      unavailable: "Reservations and port forwards are off while the network is in bridge mode.",
    });
    const nets = (await ok<M.NetworkSummary[]>(engine, "network.list")).filter((n) => n.id !== KIM && n.id !== "4821907");
    expect(nets.length).toBeGreaterThan(0);
    for (const n of nets) expect(await ok<PinholeList>(engine, "pinhole.list", { networkId: n.id })).toEqual({ pinholes: [], unavailable: null });
  });
});

describe("device.get reservation (demo)", () => {
  it("carries the reservation and link-local address", async () => {
    const d = await ok<M.Device>(demo().engine, "device.get", { device: "Alex's MacBook Pro" });
    expect(d.reservation).toMatchObject({ ip: "192.168.4.23" });
    expect(d.ipv6LinkLocal).toMatch(/^fe80::/);
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
  const backend = composeBackend("eero", {
    auth: { ...live.auth, status: async () => auth },
    network: { ...live.network, list: async () => [summary("100001", "Maple Street"), summary("100002", "Lake Cabin")] },
    device: live.device,
    routing: live.routing,
  });
  return { fake, engine: createEngine({ backend }) };
}

/** A fresh engine over the same fake server, so nothing is cached. */
function createEngineFor(fake: ReturnType<typeof createFakeEero>) {
  const token = fake.signIn();
  const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
  return createEngine({ backend: createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch }) });
}

describe("routing commands (fake eero server)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  it("maps GET {net}/routing into reservations and forwards joined to devices", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await ok<ReservationList>(engine, "reservation.list");
    expect(r.reservations).toEqual([
      { id: "301", deviceId: "0a1b2c000002", name: "Alex's Laptop", mac: "0a:1b:2c:00:00:02", ip: "192.168.4.22", forwards: 1 },
      { id: "300", deviceId: "0a1b2c000006", name: "Living Room TV", mac: "0a:1b:2c:00:00:06", ip: "192.168.4.26", forwards: 1 },
    ]);
    // Automatic DHCP: eero's default LAN.
    expect(r.lan).toEqual({
      subnet: "192.168.4.0/22",
      size: 1024,
      gateway: "192.168.4.1",
      // The two reserved clients keep static-range addresses; the connected unreserved main-network ones (not the guest plug) lease from the pool.
      pool: { start: "192.168.4.100", end: "192.168.7.254", size: 923, leased: 4 },
      staticRange: { start: "192.168.4.2", end: "192.168.4.99" },
    });
    const f = await ok<ForwardList>(engine, "forward.list");
    expect(f.forwards).toEqual([
      { id: "401", deviceId: "0a1b2c000002", name: "Web dev server", ip: "192.168.4.22", externalPort: "8080", internalPort: "8080", protocol: "both", enabled: false },
      { id: "400", deviceId: "0a1b2c000006", name: "Media server", ip: "192.168.4.26", externalPort: "32400", internalPort: "32400", protocol: "tcp", enabled: true },
    ]);
    expect((await ok<ForwardList>(engine, "forward.list", { device: "Living Room TV" })).forwards.map((x) => x.id)).toEqual(["400"]);
    expect(fake.log.some((e) => e.method === "GET" && e.path === "/2.2/networks/100001/routing")).toBe(true);
  });

  it("maps GET {net}/routing pinholes, joined to devices by MAC", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await ok<PinholeList>(engine, "pinhole.list");
    expect(r).toEqual({ pinholes: [{ id: "500", deviceId: "0a1b2c000002", address: "2001:db8:100:1::22", port: "443", protocol: "tcp" }], unavailable: null });
    const laptop = (await ok<M.DeviceList>(engine, "device.list")).devices.find((d) => d.id === r.pinholes[0]?.deviceId);
    expect(laptop?.name).toBe("Alex's Laptop");
    // An empty pinhole list, as the real capture showed.
    const maple = fake.state.networks.get("100001");
    if (!maple) throw new Error("fixture");
    maple.routing = { ...maple.routing, pinholes: { url: "/2.2/networks/100001/pinholes", data: [] } };
    expect(await ok<PinholeList>(createEngineFor(fake), "pinhole.list")).toEqual({ pinholes: [], unavailable: null });
  });

  it("loads the Reservations & ports page with one routing read", async () => {
    const fake = createFakeEero();
    close = fake.close;
    const token = fake.signIn();
    const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
    const engine = createEngine({ backend: createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch }) });
    // docs/ux/pages/reservations-ports.md, Data: every read at once, as React mounts them, with the shell's.
    const page: [string, unknown?][] = [["auth.status"], ["account.get"], ["network.list"], ["network.get"], ["internet.get"], ["device.list"], ["reservation.list"], ["forward.list"], ["pinhole.list"]];
    const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
    expect(results.flatMap((x, i) => (x.ok ? [] : [`${page[i]?.[0]}: ${x.error.message}`]))).toEqual([]);
    // The three lists share one GET {net}/routing; the whole page stays a handful of requests.
    expect(fake.log.filter((e) => e.path.endsWith("/routing")).length).toBe(1);
    expect(fake.log.filter((e) => e.path.endsWith("/devices")).length).toBeLessThanOrEqual(2);
    expect(fake.log.length).toBeLessThanOrEqual(14);
  });

  it("does not count a blocked device as leased", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    fake.state.networks.get("100001")?.blacklist.push("0a:1b:2c:00:00:03");
    const jamie = (await ok<M.DeviceList>(engine, "device.list")).devices.find((d) => d.name === "Jamie's Phone");
    expect(jamie).toMatchObject({ blocked: true, ipv4: "192.168.4.103" });
    // Four connected unreserved main-network pool clients (the guest plug is not one), less the blocked Jamie's Phone.
    expect((await ok<ReservationList>(engine, "reservation.list")).lan?.pool.leased).toBe(3);
  });

  it("uses a custom DHCP range and skips GET routing in bridge mode", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const maple = fake.state.networks.get("100001");
    if (!maple) throw new Error("fixture");
    maple.network.dhcp = { mode: "custom", custom: { subnet_ip: "10.0.0.0", subnet_mask: "255.255.255.0", start_ip: "10.0.0.50", end_ip: "10.0.0.200" } };
    const r = await ok<ReservationList>(engine, "reservation.list");
    expect(r.lan).toMatchObject({ subnet: "10.0.0.0/24", size: 256, gateway: "10.0.0.1", pool: { start: "10.0.0.50", end: "10.0.0.200", size: 151 }, staticRange: { start: "10.0.0.2", end: "10.0.0.49" } });

    const lake = fake.state.networks.get("100002");
    if (!lake) throw new Error("fixture");
    lake.network.connection = { mode: "bridged" };
    const before = fake.log.length;
    const bridged = await ok<ForwardList>(engine, "forward.list", { networkId: "100002" });
    expect(bridged).toEqual({ forwards: [], unavailable: "Reservations and port forwards are off while the network is in bridge mode." });
    expect(fake.log.slice(before).some((e) => e.path.endsWith("/routing"))).toBe(false);
  });

  it("fills device.get's reservation from routing and maps link-local IPv6", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const maple = fake.state.networks.get("100001");
    const laptop = maple?.devices.find((d) => d.mac === "0a:1b:2c:00:00:02");
    if (!laptop) throw new Error("fixture");
    laptop.ipv6_addresses = [{ address: "2001:db8:100:1::22" }, "fe80::81b:2cff:fe00:2", "2001:db8:100:1::a"];
    const d = await ok<M.Device>(engine, "device.get", { device: "Alex's Laptop" });
    expect(d).toMatchObject({ reservation: { id: "301", ip: "192.168.4.22" }, ipv6: ["2001:db8:100:1::22", "2001:db8:100:1::a"], ipv6LinkLocal: "fe80::81b:2cff:fe00:2" });
    expect(fake.log.at(-1)?.path).toBe("/2.2/networks/100001/routing");
    const phone = await ok<M.Device>(engine, "device.get", { device: "Alex's Phone" });
    expect(phone).toMatchObject({ reservation: null, ipv6: [], ipv6LinkLocal: null });
  });
});

describe("routing mapper", () => {
  it("is lenient with missing and odd rows", () => {
    const r = mapRouting(
      {
        devices: { data: [{ url: "/2.2/networks/1/devices/aabbccddeeff", mac: "AA:BB:CC:DD:EE:FF" }] },
        reservations: { data: [{ url: "/2.2/networks/1/reservations/9", mac: "aa:bb:cc:dd:ee:ff", ip: "192.168.4.9" }, { description: "no mac" }] },
        forwards: { data: [{ url: "/2.2/networks/1/forwards/7", ip: "192.168.4.9", gateway_port: 443, protocol: "UDP" }, { description: "no port" }] },
        pinholes: { data: [{ url: "/2.2/networks/1/pinholes/5", device: "/2.2/networks/1/devices/aabbccddeeff", port: "22", protocol: "both" }] },
      },
      undefined,
    );
    expect(r.reservations).toEqual([{ id: "9", deviceId: "aabbccddeeff", name: "", mac: "aa:bb:cc:dd:ee:ff", ip: "192.168.4.9", forwards: 1 }]);
    expect(r.forwards).toEqual([{ id: "7", deviceId: "aabbccddeeff", name: "", ip: "192.168.4.9", externalPort: "443", internalPort: "443", protocol: "udp", enabled: true }]);
    expect(r.pinholes).toEqual([{ id: "5", deviceId: "aabbccddeeff", address: null, port: "22", protocol: "both" }]);
    expect(mapRouting(null, undefined)).toMatchObject({ reservations: [], forwards: [], pinholes: [] });
    expect(mapLan({ mode: "custom", custom: { subnet_ip: "nope" } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Writes (M5.5)

const BRIDGED = "Reservations and port forwards are off while the network is in bridge mode.";

async function fails(engine: ReturnType<typeof createEngine>, id: string, params: Record<string, unknown>, field?: string) {
  const r = await engine.execute(id, params);
  if (r.ok) throw new Error(`${id} should fail`);
  expect(r.error.code).toBe("bad_params");
  if (field) expect(r.error.detail?.issues?.[0]?.path).toBe(field);
  return r.error.message;
}

const WRITE_IDS = ["reservation.add", "reservation.update", "reservation.remove", "forward.add", "forward.update", "forward.remove", "pinhole.add", "pinhole.remove"];

describe("routing writes: specs", () => {
  it("are plain writes gated on settings and off in bridge mode, refreshing routing and devices", () => {
    const { engine } = demo();
    for (const id of WRITE_IDS) {
      expect(engine.commands().find((c) => c.id === id), id).toMatchObject({ effect: "write", gate: { area: "settings", op: "update", bridgeOff: true, capability: null } });
    }
    expect(engine.commands().find((c) => c.id === "forward.validate")).toMatchObject({ effect: "query", gate: null });
  });

  it("refuses every write in bridge mode with the reason, before touching eero", async () => {
    const { engine } = demo();
    const params: Record<string, Record<string, unknown>> = {
      "reservation.add": { mac: "0a:00:00:00:00:01", ip: "192.168.4.50" },
      "reservation.update": { reservation: "x", ip: "192.168.4.50" },
      "reservation.remove": { reservation: "x" },
      "forward.add": { device: "x", externalPort: "80", protocol: "tcp", description: "Web" },
      "forward.update": { forward: "x", enabled: false },
      "forward.remove": { forward: "x" },
      "pinhole.add": { device: "x", port: "443", protocol: "tcp" },
      "pinhole.remove": { pinhole: "x" },
    };
    for (const id of WRITE_IDS) {
      const r = await engine.execute(id, { networkId: KIM, ...params[id] });
      expect(r, id).toEqual({ ok: false, error: { code: "eero_error", message: BRIDGED } });
    }
    expect(await engine.execute("forward.validate", { networkId: KIM, device: "x", externalPort: "80", protocol: "tcp" })).toEqual({ ok: false, error: { code: "eero_error", message: BRIDGED } });
  });
});

describe("reservation writes (demo)", () => {
  it("reserves a device's current address and shows it in the next read", async () => {
    const { engine } = demo();
    const r = await ok<M.Reservation>(engine, "reservation.add", { device: "Desk Lamp" });
    expect(r).toMatchObject({ name: "Desk Lamp", ip: "192.168.4.190", deviceId: "024d55100019" });
    const list = await ok<ReservationList>(engine, "reservation.list");
    expect(list.reservations.find((x) => x.id === r.id)).toMatchObject({ ip: "192.168.4.190" });
    // No longer a lease: the address map moves it to Reserved.
    expect(list.leases).not.toContain("192.168.4.190");
    expect((await ok<M.Device>(engine, "device.get", { device: "Desk Lamp" })).reservation).toEqual({ id: r.id, ip: "192.168.4.190" });
  });

  it("takes a MAC and an address, normalising the MAC", async () => {
    const { engine } = demo();
    const r = await ok<M.Reservation>(engine, "reservation.add", { mac: "0A-00-00-00-00-01", ip: "192.168.4.50", description: "Printer to come" });
    expect(r).toMatchObject({ mac: "0a:00:00:00:00:01", ip: "192.168.4.50", name: "Printer to come", deviceId: null });
  });

  it("checks the device, MAC and address", async () => {
    const { engine } = demo();
    await fails(engine, "reservation.add", { ip: "192.168.4.50" }, "device");
    await fails(engine, "reservation.add", { device: "Desk Lamp", mac: "0a:00:00:00:00:01" }, "device");
    await fails(engine, "reservation.add", { mac: "nope", ip: "192.168.4.50" }, "mac");
    expect(await fails(engine, "reservation.add", { device: "Synology NAS" }, "device")).toBe("Synology NAS already has a reservation (192.168.4.10). Edit that one instead.");
    expect(await fails(engine, "reservation.add", { device: "Grandma's iPad" }, "device")).toMatch(/guest network/);
    expect(await fails(engine, "reservation.add", { device: "Desk Lamp", ip: "10.0.0.5" }, "ip")).toBe("That address is outside your network (192.168.4.0/22).");
    expect(await fails(engine, "reservation.add", { device: "Desk Lamp", ip: "192.168.4.300" }, "ip")).toMatch(/IPv4 address/);
    expect(await fails(engine, "reservation.add", { device: "Desk Lamp", ip: "192.168.4.1" }, "ip")).toMatch(/gateway/);
    expect(await fails(engine, "reservation.add", { device: "Desk Lamp", ip: "192.168.7.255" }, "ip")).toMatch(/network itself/);
    expect(await fails(engine, "reservation.add", { device: "Desk Lamp", ip: "192.168.4.10" }, "ip")).toBe("That address is already reserved for Synology NAS.");
    // In use now by another device (a pool lease).
    expect(await fails(engine, "reservation.add", { device: "Desk Lamp", ip: "192.168.4.131" }, "ip")).toBe("Alex's iPhone is using that address now.");
    expect(await engine.execute("reservation.add", { device: "Desk Lamp", ip: 5 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("suggests the first free static address when the device's current one is taken", async () => {
    const { backend } = demo();
    const devices = await backend.device.list("4821907");
    // Desk Lamp reports Synology's reserved address: not free, so the static range's first free one (.4.2) is used.
    const list = devices.map((d) => (d.name === "Desk Lamp" ? { ...d, ipv4: "192.168.4.10" } : d));
    const engine = createEngine({ backend: { ...backend, device: { ...backend.device, list: async () => list } }, clock: () => NOW });
    expect(await ok<M.Reservation>(engine, "reservation.add", { device: "Desk Lamp" })).toMatchObject({ ip: "192.168.4.2" });
  });

  it("edits the address (forwards follow) and the description", async () => {
    const { engine } = demo();
    const r = await ok<M.Reservation>(engine, "reservation.update", { reservation: "Alex's MacBook Pro", ip: "192.168.4.40", description: "Alex's Mac" });
    expect(r).toMatchObject({ ip: "192.168.4.40", name: "Alex's Mac" });
    const forwards = await ok<ForwardList>(engine, "forward.list", { device: "Alex's MacBook Pro" });
    expect(forwards.forwards.map((f) => f.ip)).toEqual(["192.168.4.40", "192.168.4.40", "192.168.4.40"]);
    // By IP or MAC too; its own address is fine, another reservation's is not.
    expect(await ok<M.Reservation>(engine, "reservation.update", { reservation: "192.168.4.40", ip: "192.168.4.40" })).toMatchObject({ id: r.id });
    await fails(engine, "reservation.update", { reservation: "192.168.4.40", ip: "192.168.4.10" }, "ip");
    await fails(engine, "reservation.update", { reservation: "Nothing" });
  });

  it("removes a reservation, with or without its forwards", async () => {
    const { engine } = demo();
    const kept = await ok<{ reservation: M.Reservation; removedForwards: M.Forward[] }>(engine, "reservation.remove", { reservation: "PlayStation 5" });
    expect(kept).toMatchObject({ reservation: { ip: "192.168.4.14" }, removedForwards: [] });
    expect((await ok<ForwardList>(engine, "forward.list")).forwards.some((f) => f.name === "PSN party chat")).toBe(true);
    const gone = await ok<{ reservation: M.Reservation; removedForwards: M.Forward[] }>(engine, "reservation.remove", { reservation: "Alex's MacBook Pro", removeForwards: true });
    expect(gone.removedForwards.map((f) => f.name)).toEqual(["Web dev server", "Syncthing", "Game server"]);
    const after = await ok<ReservationList>(engine, "reservation.list");
    expect(after.reservations.some((x) => x.name === "Alex's MacBook Pro" || x.name === "PlayStation 5")).toBe(false);
    expect((await ok<ForwardList>(engine, "forward.list")).forwards.some((f) => f.ip === "192.168.4.23")).toBe(false);
  });
});

describe("forward writes (demo)", () => {
  it("validates ports, ranges, overlap and the reservation", async () => {
    const { engine } = demo();
    const check = (p: Record<string, unknown>) => ok<{ ok: boolean; issues: { field: string; message: string }[]; needsReservation: boolean }>(engine, "forward.validate", { device: "Office iMac", protocol: "tcp", ...p });
    expect(await check({ externalPort: "443" })).toEqual({ ok: true, issues: [], needsReservation: false });
    expect(await check({ externalPort: "70000" })).toMatchObject({ ok: false, issues: [{ field: "externalPort", message: "Ports run from 1 to 65535." }] });
    expect(await check({ externalPort: "0" })).toMatchObject({ ok: false, issues: [{ field: "externalPort" }] });
    expect(await check({ externalPort: "90-80" })).toMatchObject({ ok: false, issues: [{ field: "externalPort", message: "A range starts with the lower port." }] });
    expect(await check({ externalPort: "http" })).toMatchObject({ ok: false, issues: [{ field: "externalPort" }] });
    expect(await check({ externalPort: "5000-5010", internalPort: "6000-6005" })).toMatchObject({ ok: false, issues: [{ field: "internalPort", message: "The internal range must be as long as the external range." }] });
    expect(await check({ externalPort: "5000-5010", internalPort: "6000-6010" })).toMatchObject({ ok: true });
    expect(await check({ externalPort: "5000-5010", internalPort: "5000" })).toMatchObject({ ok: false, issues: [{ field: "internalPort" }] });
    // Overlap: 8080 TCP is Alex's web dev server; UDP on it is free; 27020 UDP sits inside the game server range.
    expect(await check({ externalPort: "8000-8100" })).toMatchObject({ ok: false, issues: [{ field: "externalPort", message: "Port 8080 is already forwarded to Alex's MacBook Pro (Web dev server)." }] });
    expect(await check({ externalPort: "8080", protocol: "udp" })).toMatchObject({ ok: true });
    expect(await check({ externalPort: "27020", protocol: "both" })).toMatchObject({ ok: false, issues: [{ field: "externalPort" }] });
    // Editing the forward itself is not an overlap.
    expect(await ok(engine, "forward.validate", { device: "Alex's MacBook Pro", externalPort: "8080", protocol: "tcp", forward: "Web dev server" })).toMatchObject({ ok: true });
    // A device without a reservation gets one on save.
    expect(await check({ device: "Desk Lamp", externalPort: "443" })).toEqual({ ok: true, issues: [], needsReservation: true });
    expect(await check({ device: "Grandma's iPad", externalPort: "443" })).toMatchObject({ ok: false, issues: [{ field: "device" }], needsReservation: true });
    await fails(engine, "forward.validate", { device: "Toaster", externalPort: "443", protocol: "tcp" });
  });

  it("takes single ports only without the port_forward_range capability", async () => {
    const { backend } = demo();
    const engine = createEngine({
      backend: { ...backend, network: { ...backend.network, get: async (id: string) => ({ ...(await backend.network.get(id)), capabilities: {} }) } },
      clock: () => NOW,
    });
    expect(await ok(engine, "forward.validate", { device: "Office iMac", externalPort: "5000-5010", protocol: "tcp" })).toMatchObject({ ok: false, issues: [{ field: "externalPort", message: "This network takes single ports only, not ranges." }] });
    await fails(engine, "forward.add", { device: "Office iMac", externalPort: "5000-5010", protocol: "tcp", description: "Range" }, "externalPort");
    expect(await ok(engine, "forward.validate", { device: "Office iMac", externalPort: "5000", protocol: "tcp" })).toMatchObject({ ok: true });
  });

  it("adds a forward, reserving the device's address first when it has none", async () => {
    const { engine } = demo();
    const added = await ok<{ forward: M.Forward; reservation: M.Reservation | null }>(engine, "forward.add", { device: "Desk Lamp", externalPort: 8443, internalPort: "443", protocol: "tcp", description: "Lamp UI" });
    expect(added.reservation).toMatchObject({ ip: "192.168.4.190", deviceId: "024d55100019" });
    expect(added.forward).toMatchObject({ name: "Lamp UI", ip: "192.168.4.190", externalPort: "8443", internalPort: "443", protocol: "tcp", enabled: true, deviceId: "024d55100019" });
    expect((await ok<ForwardList>(engine, "forward.list", { device: "Desk Lamp" })).forwards.map((f) => f.id)).toEqual([added.forward.id]);
    expect((await ok<ReservationList>(engine, "reservation.list")).reservations.find((r) => r.deviceId === "024d55100019")).toMatchObject({ forwards: 1 });
    // A reserved device keeps its reservation; internal defaults to external.
    const again = await ok<{ forward: M.Forward; reservation: M.Reservation | null }>(engine, "forward.add", { device: "Office iMac", externalPort: "5900", protocol: "both", description: "Screen sharing", enabled: false });
    expect(again).toMatchObject({ reservation: null, forward: { ip: "192.168.4.20", internalPort: "5900", enabled: false } });
    // The same checks as validate.
    expect(await fails(engine, "forward.add", { device: "Office iMac", externalPort: "8443", protocol: "both", description: "Dup" }, "externalPort")).toMatch(/already forwarded to Desk Lamp/);
    await fails(engine, "forward.add", { device: "Office iMac", externalPort: "99999", protocol: "tcp", description: "Big" }, "externalPort");
    await fails(engine, "forward.add", { device: "Office iMac", externalPort: "81", protocol: "tcp", description: "" }, "description");
    await fails(engine, "forward.add", { device: "Office iMac", externalPort: "81", protocol: "sctp", description: "x" }, "protocol");
  });

  it("edits a forward: the switch, ports and device, with the same checks", async () => {
    const { engine } = demo();
    expect(await ok<M.Forward>(engine, "forward.update", { forward: "Game server", enabled: true })).toMatchObject({ enabled: true, externalPort: "27015-27030" });
    expect((await ok<ForwardList>(engine, "forward.list")).forwards.find((f) => f.name === "Game server")?.enabled).toBe(true);
    // A new external port moves the internal one with it when they were the same.
    expect(await ok<M.Forward>(engine, "forward.update", { forward: "Web dev server", externalPort: "8081" })).toMatchObject({ externalPort: "8081", internalPort: "8081" });
    // Moving it to an unreserved device reserves that device's address.
    const moved = await ok<M.Forward>(engine, "forward.update", { forward: "Web dev server", device: "Jamie's ThinkPad" });
    expect(moved).toMatchObject({ ip: "192.168.4.127", deviceId: "024d55100008" });
    expect((await ok<ReservationList>(engine, "reservation.list")).reservations.some((r) => r.deviceId === "024d55100008")).toBe(true);
    await fails(engine, "forward.update", { forward: "Web dev server", externalPort: "32400" }, "externalPort");
    await fails(engine, "forward.update", { forward: "No such forward", enabled: true });
  });

  it("removes a forward and keeps the reservation", async () => {
    const { engine } = demo();
    const f = await ok<M.Forward>(engine, "forward.remove", { forward: "Plex Media Server" });
    expect(f).toMatchObject({ name: "Plex Media Server", externalPort: "32400" });
    expect((await ok<ForwardList>(engine, "forward.list")).forwards.some((x) => x.id === f.id)).toBe(false);
    expect((await ok<ReservationList>(engine, "reservation.list")).reservations.find((r) => r.name === "Synology NAS")).toMatchObject({ forwards: 0 });
  });
});

describe("pinhole writes (demo)", () => {
  it("adds and removes an IPv6 rule, shown in the next read", async () => {
    const { engine } = demo();
    const p = await ok<M.Pinhole>(engine, "pinhole.add", { device: "Office iMac", port: "22", protocol: "tcp" });
    expect(p).toMatchObject({ deviceId: "024d55100005", address: "2001:db8:4a1c:7e00::14", port: "22", protocol: "tcp" });
    expect((await ok<PinholeList>(engine, "pinhole.list")).pinholes.map((x) => x.port)).toContain("22");
    expect(await ok<M.Pinhole>(engine, "pinhole.remove", { pinhole: p.id })).toMatchObject({ id: p.id });
    expect((await ok<PinholeList>(engine, "pinhole.list")).pinholes.some((x) => x.id === p.id)).toBe(false);
    // By device name and port.
    expect(await ok<M.Pinhole>(engine, "pinhole.remove", { pinhole: "PlayStation 5:3074" })).toMatchObject({ port: "3074" });
  });

  it("checks the port, the device and overlap", async () => {
    const { engine } = demo();
    await fails(engine, "pinhole.add", { device: "Office iMac", port: "0", protocol: "tcp" }, "port");
    await fails(engine, "pinhole.add", { device: "Grandma's iPad", port: "22", protocol: "tcp" }, "device");
    expect(await fails(engine, "pinhole.add", { device: "Synology NAS", port: "400-500", protocol: "both" }, "port")).toBe("Port 443 is already open to Synology NAS.");
    expect(await ok<M.Pinhole>(engine, "pinhole.add", { device: "Synology NAS", port: "443", protocol: "udp" })).toMatchObject({ protocol: "udp" });
    await fails(engine, "pinhole.remove", { pinhole: "nothing" });
  });
});

describe("routing writes (fake eero server)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });
  const writes = (fake: ReturnType<typeof createFakeEero>) => fake.writes.map((w) => ({ method: w.method, path: w.path, body: w.body }));

  it("reservation add, edit and remove send eero's requests and refresh the routing read", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    await ok<ReservationList>(engine, "reservation.list");
    const routingReads = () => fake.log.filter((e) => e.method === "GET" && e.path.endsWith("/routing")).length;
    const r = await ok<M.Reservation>(engine, "reservation.add", { device: "Alex's Phone", ip: "192.168.4.40" });
    expect(r).toMatchObject({ mac: "0a:1b:2c:00:00:01", ip: "192.168.4.40", name: "Alex's Phone", deviceId: "0a1b2c000001" });
    expect(writes(fake)).toEqual([{ method: "POST", path: "/2.2/networks/100001/reservations", body: { description: "Alex's Phone", mac: "0a:1b:2c:00:00:01", ip: "192.168.4.40" } }]);
    // The write invalidated the routing topic: the next list reads routing again and shows the row.
    const before = routingReads();
    expect((await ok<ReservationList>(engine, "reservation.list")).reservations.find((x) => x.id === r.id)).toMatchObject({ ip: "192.168.4.40" });
    expect(routingReads()).toBe(before + 1);

    await ok(engine, "reservation.update", { reservation: r.id, description: "Phone" });
    expect(writes(fake).at(-1)).toEqual({ method: "PUT", path: `/2.2/networks/100001/reservations/${r.id}`, body: { description: "Phone", mac: "0a:1b:2c:00:00:01", ip: "192.168.4.40" } });

    await ok(engine, "reservation.remove", { reservation: "Living Room TV", removeForwards: true });
    const del = fake.writes.at(-1);
    expect(del).toMatchObject({ method: "DELETE", path: "/2.2/networks/100001/reservations/300" });
    expect(fake.log.at(-1)?.query).toContain("delete_forwards=true");
    expect((await ok<ForwardList>(engine, "forward.list")).forwards.map((f) => f.name)).toEqual(["Web dev server"]);
    await ok(engine, "reservation.remove", { reservation: "Alex's Laptop" });
    expect(fake.log.filter((e) => e.method === "DELETE").at(-1)?.query).toContain("delete_forwards=false");
    expect((await ok<ForwardList>(engine, "forward.list")).forwards.map((f) => f.name)).toEqual(["Web dev server"]);
  });

  it("forward add reserves first, then edit and remove send the whole row", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const added = await ok<{ forward: M.Forward; reservation: M.Reservation | null }>(engine, "forward.add", { device: "Jamie's Phone", externalPort: "5000-5005", protocol: "udp", description: "Game" });
    expect(writes(fake)).toEqual([
      { method: "POST", path: "/2.2/networks/100001/reservations", body: { description: "Jamie's Phone", mac: "0a:1b:2c:00:00:03", ip: "192.168.4.103" } },
      { method: "POST", path: "/2.2/networks/100001/forwards", body: { ip: "192.168.4.103", gateway_port: "5000-5005", client_port: "5000-5005", protocol: "udp", description: "Game", enabled: true } },
    ]);
    expect(added.forward).toMatchObject({ deviceId: "0a1b2c000003", externalPort: "5000-5005", protocol: "udp", enabled: true });
    expect(added.reservation).toMatchObject({ ip: "192.168.4.103" });

    await ok(engine, "forward.update", { forward: added.forward.id, enabled: false });
    expect(writes(fake).at(-1)).toEqual({ method: "PUT", path: `/2.2/networks/100001/forwards/${added.forward.id}`, body: { ip: "192.168.4.103", gateway_port: "5000-5005", client_port: "5000-5005", protocol: "udp", description: "Game", enabled: false } });
    expect((await ok<ForwardList>(engine, "forward.list")).forwards.find((f) => f.id === added.forward.id)?.enabled).toBe(false);

    await ok(engine, "forward.remove", { forward: "Media server" });
    expect(writes(fake).at(-1)).toEqual({ method: "DELETE", path: "/2.2/networks/100001/forwards/400", body: {} });
    expect((await ok<ForwardList>(engine, "forward.list")).forwards.some((f) => f.id === "400")).toBe(false);
  });

  it("pinhole add posts the device url and remove deletes the rule's own url", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const p = await ok<M.Pinhole>(engine, "pinhole.add", { device: "Living Room TV", port: "8443", protocol: "both" });
    expect(writes(fake)).toEqual([{ method: "POST", path: "/2.2/networks/100001/ipv6/pinholes", body: { device: "/2.2/networks/100001/devices/0a1b2c000006", protocol: "both", port: "8443" } }]);
    expect(p).toMatchObject({ deviceId: "0a1b2c000006", port: "8443", protocol: "both" });
    await ok(engine, "pinhole.remove", { pinhole: p.id });
    expect(writes(fake).at(-1)).toMatchObject({ method: "DELETE", path: `/2.2/networks/100001/ipv6/pinholes/${p.id}` });
    // The seeded rule lives at {net}/pinholes/500: its own url is used.
    await ok(engine, "pinhole.remove", { pinhole: "500" });
    expect(writes(fake).at(-1)).toMatchObject({ method: "DELETE", path: "/2.2/networks/100001/pinholes/500" });
    expect((await ok<PinholeList>(engine, "pinhole.list")).pinholes).toEqual([]);
  });

  it("maps eero's reservation errors to bad_params and refuses ranges without the capability", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const token = fake.signIn();
    const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
    const live = createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch });
    // Straight to eero, past core's checks: eero's own codes come back as bad_params.
    await expect(live.routing.addReservation("100001", { mac: "0a:1b:2c:00:00:01", ip: "192.168.4.22", description: "" })).rejects.toMatchObject({ code: "bad_params", detail: { eeroError: "error.assignment.ip.unavailable" } });
    await expect(live.routing.addReservation("100001", { mac: "0a:1b:2c:00:00:01", ip: "10.9.9.9", description: "" })).rejects.toMatchObject({ code: "bad_params", detail: { eeroError: "error.reservation.ip.invalid" } });
    // Lake Cabin has no port_forward_range: core refuses before any write.
    const lake = fake.state.networks.get("100002");
    if (!lake) throw new Error("fixture");
    const before = fake.writes.length;
    await fails(engine, "forward.add", { networkId: "100002", device: "x", externalPort: "1-2", protocol: "tcp", description: "r" });
    expect(fake.writes.length).toBe(before);
  });

  it("refuses writes in bridge mode without calling eero's routing", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const lake = fake.state.networks.get("100002");
    if (!lake) throw new Error("fixture");
    lake.network.connection = { mode: "bridged" };
    const before = fake.log.length;
    expect(await engine.execute("forward.add", { networkId: "100002", device: "x", externalPort: "80", protocol: "tcp", description: "Web" })).toEqual({ ok: false, error: { code: "eero_error", message: BRIDGED } });
    expect(fake.log.slice(before).some((e) => e.path.endsWith("/routing") || e.method !== "GET")).toBe(false);
  });

  it("reads forward ports sent as numbers, as {net}/forwards does", () => {
    const r = mapRouting({ forwards: { data: [{ url: "/2.2/networks/1/forwards/8", ip: "192.168.4.9", gateway_port: 8080, client_port: 80, protocol: "tcp", enabled: true }] } }, undefined);
    expect(r.forwards[0]).toMatchObject({ externalPort: "8080", internalPort: "80" });
  });
});
