import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { bandOf, eeroStatus, mapEero } from "../eero/map/eero";
import { createEngine } from "../engine";
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
    ]);
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
    expect(fake.log.map((l) => `${l.method} ${l.path}`)).toEqual(["GET /2.2/networks/100001/eeros"]);
  });

  it("gets one eero by location and refuses one from another network", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.Eero>("eero.get", { eero: "Office" });
    expect(r.ok && r.result).toMatchObject({ id: "500002", serial: "FAKE00OF0002", location: "Office" });
    expect(fake.log.at(-1)?.path).toBe("/2.2/eeros/500002");
    const other = await engine.execute("eero.get", { eero: "Cabin", networkId: "Maple Street" });
    expect(other).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.backend.eero.get("100001", "500010").catch((e: Error) => e.message)).toBe("That eero is not on this network.");
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
  });
});
