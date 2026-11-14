import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapLan, mapRouting } from "../eero/map/routing";
import { createEngine } from "../engine";
import type * as M from "../model";
import type { ForwardList, ReservationList } from "./routing";

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
