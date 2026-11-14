import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { dayOf, mapProfile, type RawScheduleFull } from "../eero/map/profile";
import { createEngine } from "../engine";
import type * as M from "../model";
import { commands as profileCommands, nextChange, pausesToday, stateOf } from "./profile";

// Thursday Nov 12 2026, 2:41 PM in Los Angeles.
const NOW = Date.parse("2026-11-12T22:41:00Z");
const LAKE = "5130264";

function demo(clock: () => number = () => NOW) {
  const backend = createDemoBackend({ clock: () => NOW });
  return { backend, engine: createEngine({ backend, clock }) };
}

describe("profile.list (demo)", () => {
  it("lists profiles with state, devices, next change and the Unassigned summary", async () => {
    const { backend, engine } = demo();
    const r = await engine.execute<M.ProfileList>("profile.list");
    if (!r.ok) throw new Error(r.error.message);
    const { profiles, unassigned } = r.result;
    expect(profiles.map((p) => [p.name, p.state, p.paused, p.deviceIds.length])).toEqual([
      ["Alex", "active", false, 6],
      ["Jamie", "active", false, 5],
      ["Leo", "paused", true, 3],
      ["Mia", "scheduled", false, 4],
    ]);
    // Homework (weekdays 16:00 to 18:00) starts at 4 PM Los Angeles time.
    expect(profiles.find((p) => p.name === "Mia")?.nextChange).toEqual({ at: "2026-11-13T00:00:00.000Z", to: "paused", scheduleId: "9202" });
    expect(profiles.find((p) => p.name === "Leo")?.nextChange).toBeNull();
    expect(profiles.find((p) => p.name === "Alex")?.nextChange).toBeNull();
    const devices = await backend.device.list("4821907");
    const expected = devices.filter((d) => !d.profileId && !d.blocked);
    expect(unassigned.deviceIds.sort()).toEqual(expected.map((d) => d.id).sort());
    expect(unassigned.devicesOnline).toBe(expected.filter((d) => d.connected).length);
    expect(unassigned.paused).toBe(false);
  });

  it("lays out today's pauses per profile and Unassigned, in the network time zone", async () => {
    const r = await demo().engine.execute<M.ProfileList>("profile.list");
    if (!r.ok) throw new Error(r.error.message);
    const { today, profiles } = r.result;
    expect(today).toMatchObject({ date: "2026-11-12", timezone: "America/Los_Angeles", now: 14 * 60 + 41 });
    expect(today.lanes.map((l) => l.profileId)).toEqual([...profiles.map((p) => p.id), null]);
    const leo = today.lanes.find((l) => l.profileId === profiles.find((p) => p.name === "Leo")?.id);
    expect(leo?.segments).toEqual([{ kind: "manual", label: "Paused until resumed", scheduleId: null, start: 14 * 60 + 41, end: 1440 }]);
    const mia = today.lanes.find((l) => l.profileId === "9103");
    expect(mia?.segments.every((x) => x.kind === "scheduled" && x.start < x.end)).toBe(true);
  });

  it("answers an empty list for a network without profiles", async () => {
    const r = await demo().engine.execute<M.ProfileList>("profile.list", { networkId: "Lake Cabin" });
    expect(r.ok && r.result.profiles).toEqual([]);
    expect(r.ok && r.result.unassigned.deviceIds.length).toBe(3);
  });

  it("rejects params it does not take", async () => {
    expect(await demo().engine.execute("profile.list", { profile: "Mia" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await demo().engine.execute("profile.list", { networkId: "Nowhere" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});

describe("profile.get (demo)", () => {
  it("gets a profile by name or id", async () => {
    const { engine } = demo();
    const r = await engine.execute<M.Profile>("profile.get", { profile: "mia" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result).toMatchObject({ id: "9103", name: "Mia", schedules: [{ name: "Bedtime" }, { name: "Homework" }, { name: "Weekend lights out", enabled: false }] });
    expect(r.result.nextChange?.scheduleId).toBe("9202");
    expect((await engine.execute<M.Profile>("profile.get", { profile: "9104" })).ok).toBe(true);
  });

  it("fails bad_params for a missing or unknown profile", async () => {
    const { engine } = demo();
    expect(await engine.execute("profile.get", {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("profile.get", { profile: "Nobody" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("profile.get", { profile: "Mia", networkId: LAKE })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});

describe("nextChange", () => {
  const s = (over: Partial<M.Schedule>): M.Schedule => ({ id: "1", name: "S", days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], start: "21:00", end: "07:00", enabled: true, ...over });
  const tz = "America/Los_Angeles";
  const at = (iso: string) => Date.parse(iso);

  it("picks the next start or end, wrapping past midnight", () => {
    // 2:41 PM: next is the 9 PM start.
    expect(nextChange({ paused: false, schedules: [s({})] }, NOW, tz)).toEqual({ at: "2026-11-13T05:00:00.000Z", to: "paused", scheduleId: "1" });
    // 11 PM: inside the pause, it ends at 7 AM tomorrow.
    expect(nextChange({ paused: false, schedules: [s({})] }, at("2026-11-13T07:00:00Z"), tz)).toEqual({ at: "2026-11-13T15:00:00.000Z", to: "active", scheduleId: "1" });
    // 1 AM Friday from a Thursday-only schedule that started the evening before.
    expect(nextChange({ paused: false, schedules: [s({ days: ["THU"] })] }, at("2026-11-13T09:00:00Z"), tz)?.to).toBe("active");
  });

  it("skips disabled schedules, other days, manual pauses and unknown zones", () => {
    expect(nextChange({ paused: false, schedules: [s({ enabled: false })] }, NOW, tz)).toBeNull();
    expect(nextChange({ paused: true, schedules: [s({})] }, NOW, tz)).toBeNull();
    expect(nextChange({ paused: false, schedules: [s({})] }, NOW, null)).toBeNull();
    // Saturday only: the next start is Saturday 9 PM.
    expect(nextChange({ paused: false, schedules: [s({ days: ["SAT"] })] }, NOW, tz)?.at).toBe("2026-11-15T05:00:00.000Z");
  });

  it("follows daylight saving time", () => {
    // DST in Los Angeles ends Nov 1 2026: 9 PM is 04:00Z on Oct 31 and 05:00Z on Nov 1.
    expect(nextChange({ paused: false, schedules: [s({})] }, at("2026-10-31T20:00:00Z"), tz)?.at).toBe("2026-11-01T04:00:00.000Z");
    expect(nextChange({ paused: false, schedules: [s({})] }, at("2026-11-01T20:00:00Z"), tz)?.at).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("pausesToday and stateOf", () => {
  const s = (over: Partial<M.Schedule>): M.Schedule => ({ id: "1", name: "Bedtime", days: ["THU"], start: "21:00", end: "07:00", enabled: true, ...over });
  const tz = "America/Los_Angeles";
  const span = (segs: M.PauseSegment[]) => segs.map((x) => [x.kind, x.start, x.end]);

  it("splits an overnight schedule across midnight", () => {
    // Thursday: tonight's half. Friday 1 AM (09:00Z): Thursday's span carries on to 7 AM.
    expect(span(pausesToday({ paused: false, schedules: [s({})] }, NOW, tz))).toEqual([["scheduled", 1260, 1440]]);
    expect(span(pausesToday({ paused: false, schedules: [s({})] }, Date.parse("2026-11-13T09:00:00Z"), tz))).toEqual([["scheduled", 0, 420]]);
    // Disabled schedules and other days draw nothing.
    expect(pausesToday({ paused: false, schedules: [s({ enabled: false }), s({ days: ["SAT"] })] }, NOW, tz)).toEqual([]);
  });

  it("ends a manual pause at the next scheduled start", () => {
    const segs = pausesToday({ paused: true, schedules: [s({})] }, NOW, tz);
    expect(span(segs)).toEqual([
      ["scheduled", 1260, 1440],
      ["manual", 14 * 60 + 41, 1260],
    ]);
  });

  it("keeps wall-clock minutes on the day daylight saving time ends", () => {
    // Nov 1 2026 in Los Angeles: 10 AM PST is 18:00Z, and the 9 PM start is still minute 1260.
    const segs = pausesToday({ paused: false, schedules: [s({ days: ["SUN"] })] }, Date.parse("2026-11-01T18:00:00Z"), tz);
    expect(span(segs)).toEqual([["scheduled", 1260, 1440]]);
    // A day earlier (PDT), the same wall time is the same minute.
    expect(span(pausesToday({ paused: false, schedules: [s({ days: ["SAT"] })] }, Date.parse("2026-10-31T17:00:00Z"), tz))).toEqual([["scheduled", 1260, 1440]]);
  });

  it("computes state: manual pause, then schedules, then active", () => {
    expect(stateOf({ paused: true, state: "active", schedules: [] })).toBe("paused");
    expect(stateOf({ paused: false, state: "active", schedules: [s({})] })).toBe("scheduled");
    expect(stateOf({ paused: false, state: "active", schedules: [s({ enabled: false })] })).toBe("active");
    expect(stateOf({ paused: false, state: "scheduled", schedules: [] })).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// Against the fake eero server, through the real client and mappers.

function fakeEngine(options: Parameters<typeof createFakeEero>[0] = {}) {
  const fake = createFakeEero(options);
  const token = fake.signIn();
  const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
  const live = createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch });
  const auth: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
  const summary = (id: string, name: string) => ({ id, name, nickname: null, role: "owner", status: "online", eeroCount: null, devicesOnline: null, isp: null, updateAvailable: null, lastSeen: null, selected: false }) as M.NetworkSummary;
  // Stub auth (no eero auth area yet) and network (keeps these tests to their own routes).
  const backend = composeBackend("eero", {
    auth: { ...live.auth, status: async () => auth },
    network: {
      ...live.network,
      list: async () => [summary("100001", "Maple Street"), summary("100002", "Lake Cabin")],
      get: async (id) => ({ ...summary(id, "x"), timezone: "America/New_York" }) as M.Network,
    },
    eero: live.eero,
    device: live.device,
    profile: live.profile,
  });
  return { fake, engine: createEngine({ backend }) };
}

describe("profile commands (fake eero server)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    vi.useRealTimers();
    await close?.();
    close = null;
  });

  it("maps GET {net}/profiles with embedded schedules and devices", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.ProfileList>("profile.list");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result.profiles.map((p) => [p.id, p.name, p.state, p.deviceIds])).toEqual([
      ["700", "Alex", "active", ["0a1b2c000001", "0a1b2c000002"]],
      ["701", "Jamie", "active", ["0a1b2c000003"]],
      ["703", "Leo", "paused", ["0a1b2c000005"]],
      ["702", "Mia", "scheduled", ["0a1b2c000004"]],
    ]);
    const mia = r.result.profiles.find((p) => p.name === "Mia");
    expect(mia?.schedules).toEqual([
      { id: "1", name: "Bedtime", days: ["MON", "TUE", "WED", "THU", "SUN"], start: "21:00", end: "07:00", enabled: true },
      { id: "2", name: "Homework", days: ["MON", "FRI"], start: "16:00", end: "18:00", enabled: false },
    ]);
    // Thursday 5:41 PM in New York: Bedtime starts at 9 PM (02:00Z).
    expect(mia?.nextChange).toEqual({ at: "2026-11-13T02:00:00.000Z", to: "paused", scheduleId: "1" });
    expect(r.result.unassigned).toEqual({ deviceIds: ["0a1b2c000006", "0a1b2c000007", "0a1b2c000008"], devicesOnline: 2, paused: false });
    // Today's lanes in New York (Thursday 5:41 PM): the end of Wednesday's Bedtime, then tonight's; Leo is paused from now.
    expect(r.result.today).toMatchObject({ date: "2026-11-12", timezone: "America/New_York", now: 17 * 60 + 41 });
    const lane = (id: string | null) => r.result.today.lanes.find((l) => l.profileId === id)?.segments.map((x) => [x.kind, x.start, x.end]);
    expect(lane("702")).toEqual([
      ["scheduled", 0, 7 * 60],
      ["scheduled", 21 * 60, 1440],
    ]);
    expect(lane("703")).toEqual([["manual", 17 * 60 + 41, 1440]]);
    expect(lane(null)).toEqual([]);
    expect(fake.log.some((e) => e.path.includes("/schedules"))).toBe(false);
  });

  it("reads schedules from the profile object for profile.get, never {profile}/schedules (a 404 on eero)", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.Profile>("profile.get", { profile: "Mia" });
    expect(r.ok && r.result).toMatchObject({ id: "702", state: "scheduled", schedules: [{ name: "Bedtime" }, { name: "Homework", enabled: false }] });
    expect(fake.log.at(-1)?.path).toBe("/2.2/networks/100001/profiles/702");
    expect(fake.log.some((e) => e.path.endsWith("/schedules"))).toBe(false);
    expect(await engine.execute("profile.get", { profile: "Nobody" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("leaves eero's own Unassigned group (a default profile) out of the list and counts its devices as Unassigned", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const net = fake.state.networks.get("100001");
    if (!net) throw new Error("no fake network");
    // As on a real network (eeroOS 7.12.4+): a profile named Unassigned, flagged default, holding devices.
    const url = `${net.network.url}/profiles/799`;
    const device = net.devices.find((d) => d.url?.endsWith("/0a1b2c000006"));
    if (!device) throw new Error("no fake device");
    device.profile = { url, name: "Unassigned" } as typeof device.profile;
    net.profiles.push({ url, name: "Unassigned", default: true, paused: false, devices: [device], schedule: [], state: { value: "active" } });
    const r = await engine.execute<M.ProfileList>("profile.list");
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result.profiles.map((p) => p.name)).toEqual(["Alex", "Jamie", "Leo", "Mia"]);
    expect(r.result.unassigned.deviceIds).toContain("0a1b2c000006");
    expect(r.result.today.lanes.map((l) => l.profileId)).toEqual(["700", "701", "703", "702", null]);
  });

  it("loads the Profiles page within the request budget", async () => {
    // The whole eero backend, as the app runs it, with the shell's reads too.
    const fake = createFakeEero();
    close = fake.close;
    const token = fake.signIn();
    const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
    const engine = createEngine({ backend: createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch }) });
    // docs/ux/pages/profiles.md, Data: every read at once, as React mounts them.
    const page: [string, unknown?][] = [
      ["auth.status"],
      ["account.get"],
      ["network.list"],
      ["network.get"],
      ["profile.list"],
      ["usage.get", { scope: "profile", range: "day" }],
      ["usage.get", { scope: "profile", range: "week" }],
      ["device.list"],
    ];
    const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
    expect(results.flatMap((x, i) => (x.ok ? [] : [`${page[i]?.[0]}: ${x.error.message}`]))).toEqual([]);
    // Identical reads are shared: profile.list and both usage reads list profiles once. About 20 requests
    // (one usage read per profile per range), far under the 80 a minute budget, and no /schedules reads.
    expect(fake.log.filter((e) => e.path === "/2.2/networks/100001/profiles").length).toBe(1);
    expect(fake.log.some((e) => e.path.endsWith("/schedules"))).toBe(false);
    expect(fake.log.length).toBeLessThanOrEqual(24);
  });
});

describe("profile mapper", () => {
  it("normalises days, times and odd shapes", () => {
    expect(["MON", "monday", "Tue", "x", 3].map(dayOf)).toEqual(["MON", "MON", "TUE", null, null]);
    const schedules: RawScheduleFull[] = [{ day: "friday", start: "9:00", end: "17:30:00" }, { start: "bad", end: "07:00" }];
    const p = mapProfile({ url: "/2.2/networks/1/profiles/9", state: { value: "schedule" } }, schedules);
    expect(p).toMatchObject({ id: "9", name: "Profile", state: "scheduled", schedules: [{ id: "1", name: "Scheduled pause", days: ["FRI"], start: "09:00", end: "17:30", enabled: true }] });
    expect(() => mapProfile({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Writes (M4.5)

describe("profile writes (demo)", () => {
  const list = async (engine: ReturnType<typeof demo>["engine"]) => {
    const r = await engine.execute<M.ProfileList>("profile.list");
    if (!r.ok) throw new Error(r.error.message);
    return r.result;
  };
  const devices = async (engine: ReturnType<typeof demo>["engine"]) => {
    const r = await engine.execute<M.DeviceList>("device.list");
    if (!r.ok) throw new Error(r.error.message);
    return r.result.devices;
  };

  it("creates a profile with devices, moving them out of their old profiles", async () => {
    const { engine } = demo();
    await list(engine); // cached, so the next read proves the write invalidated it
    const loose = (await list(engine)).unassigned.deviceIds.slice(0, 2);
    const r = await engine.execute<M.Profile>("profile.create", { name: "  Guests  ", devices: loose });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result).toMatchObject({ name: "Guests", state: "active", paused: false });
    expect(r.result.deviceIds.sort()).toEqual([...loose].sort());
    const after = await list(engine);
    expect(after.profiles.map((p) => p.name)).toContain("Guests");
    expect(after.unassigned.deviceIds).not.toContain(loose[0]);
    expect((await devices(engine)).find((d) => d.id === loose[0])?.profileId).toBe(r.result.id);
  });

  it("refuses a bad or taken name, unknown devices and extra params", async () => {
    const { engine } = demo();
    for (const params of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(33) }, { name: "Ok", devices: ["Nobody's Phone"] }, { name: "Ok", extra: 1 }, { name: 5 }]) {
      expect(await engine.execute("profile.create", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
    const taken = await engine.execute("profile.create", { name: "mia" });
    expect(taken).toMatchObject({ ok: false, error: { code: "bad_params", detail: { issues: [{ path: "name" }] } } });
    expect((await list(engine)).profiles).toHaveLength(4);
  });

  it("renames, keeping its own name allowed and another's refused", async () => {
    const { engine } = demo();
    await list(engine);
    expect(await engine.execute<M.Profile>("profile.rename", { profile: "Leo", name: "Leo J" })).toMatchObject({ ok: true, result: { name: "Leo J", paused: true } });
    expect((await list(engine)).profiles.map((p) => p.name)).toContain("Leo J");
    expect((await engine.execute("profile.rename", { profile: "Leo J", name: "LEO J" })).ok).toBe(true);
    expect(await engine.execute("profile.rename", { profile: "Mia", name: "alex" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("profile.rename", { profile: "Nobody", name: "X" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("profile.rename", { profile: "Mia" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("pauses and resumes a profile and its devices, and draws today's manual pause", async () => {
    const { engine } = demo();
    await list(engine);
    const mia = (await list(engine)).profiles.find((p) => p.name === "Mia");
    const paused = await engine.execute<M.Profile>("profile.pause", { profile: "Mia" });
    expect(paused).toMatchObject({ ok: true, result: { paused: true, state: "paused", nextChange: null } });
    const after = await list(engine);
    expect(after.profiles.find((p) => p.name === "Mia")?.state).toBe("paused");
    const all = await devices(engine);
    expect(mia?.deviceIds.every((id) => all.find((d) => d.id === id)?.paused)).toBe(true);
    const lane = after.today.lanes.find((l) => l.profileId === mia?.id);
    expect(lane?.segments.some((x) => x.kind === "manual")).toBe(true);

    expect(await engine.execute<M.Profile>("profile.resume", { profile: "9103" })).toMatchObject({ ok: true, result: { paused: false, state: "scheduled" } });
    const back = await devices(engine);
    expect(mia?.deviceIds.some((id) => back.find((d) => d.id === id)?.paused)).toBe(false);
    for (const id of ["profile.pause", "profile.resume"]) {
      expect(await engine.execute(id, {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
      expect(await engine.execute(id, { profile: "Nobody" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });

  it("sets exactly a profile's devices; leavers become Unassigned", async () => {
    const { engine } = demo();
    const before = await list(engine);
    const alex = before.profiles.find((p) => p.name === "Alex");
    if (!alex) throw new Error("no Alex");
    const keep = alex.deviceIds.slice(0, 2);
    const extra = before.unassigned.deviceIds[0] ?? "";
    const r = await engine.execute<M.Profile>("profile.devices.set", { profile: "Alex", devices: [...keep, extra, keep[0]] });
    expect(r.ok && r.result.deviceIds.sort()).toEqual([...keep, extra].sort());
    const after = await list(engine);
    for (const gone of alex.deviceIds.slice(2)) expect(after.unassigned.deviceIds).toContain(gone);
    expect(after.unassigned.deviceIds).not.toContain(extra);
    expect((await engine.execute<M.Profile>("profile.devices.set", { profile: "Alex", devices: [] })).ok).toBe(true);
    expect(await engine.execute("profile.devices.set", { profile: "Alex" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("profile.devices.set", { profile: "Alex", devices: ["Nobody"] })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("deletes only with confirm, naming the profile and its devices", async () => {
    const { engine } = demo();
    const before = await list(engine);
    const leo = before.profiles.find((p) => p.name === "Leo");
    if (!leo) throw new Error("no Leo");
    const ask = await engine.execute("profile.delete", { profile: "Leo" });
    expect(ask).toMatchObject({ ok: false, error: { code: "needs_confirm" } });
    expect(!ask.ok && ask.error.message).toBe(`Leo's ${leo.deviceIds.length} devices move to Unassigned, its schedules are removed and any pause is lifted. This cannot be undone.`);
    expect((await list(engine)).profiles).toHaveLength(4);

    expect(await engine.execute("profile.delete", { profile: "Leo", confirm: true })).toEqual({ ok: true, result: { deleted: leo.id, name: "Leo" } });
    const after = await list(engine);
    expect(after.profiles.map((p) => p.name)).not.toContain("Leo");
    for (const id of leo.deviceIds) expect(after.unassigned.deviceIds).toContain(id);
    // Leo was paused: the pause lifts with the profile.
    const all = await devices(engine);
    expect(leo.deviceIds.some((id) => all.find((d) => d.id === id)?.paused)).toBe(false);
    expect(await engine.execute("profile.delete", { profile: "Leo", confirm: true })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("profile.delete", { confirm: true })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("pauses and resumes the Unassigned devices", async () => {
    const { engine } = demo();
    const before = await list(engine);
    expect(before.unassigned.paused).toBe(false);
    expect(await engine.execute("profile.unassigned.pause")).toEqual({ ok: true, result: { paused: true } });
    const after = await list(engine);
    expect(after.unassigned.paused).toBe(true);
    expect(after.today.lanes.find((l) => l.profileId === null)?.segments.map((x) => x.kind)).toEqual(["manual"]);
    // Profiles keep their own state.
    expect(after.profiles.find((p) => p.name === "Alex")?.paused).toBe(false);
    expect(await engine.execute("profile.unassigned.resume")).toEqual({ ok: true, result: { paused: false } });
    expect((await list(engine)).unassigned.paused).toBe(false);
    expect(await engine.execute("profile.unassigned.pause", { profile: "Alex" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("profile.get returns today's pauses: a manual pause from now, schedules in the zone", async () => {
    const { engine } = demo();
    const leo = await engine.execute<M.ProfileDetail>("profile.get", { profile: "Leo" });
    expect(leo.ok && leo.result.today).toEqual({
      date: "2026-11-12",
      timezone: "America/Los_Angeles",
      now: 14 * 60 + 41,
      segments: [{ kind: "manual", label: "Paused until resumed", scheduleId: null, start: 14 * 60 + 41, end: 1440 }],
    });
    const mia = await engine.execute<M.ProfileDetail>("profile.get", { profile: "Mia" });
    expect(mia.ok && mia.result.today.segments.every((x) => x.kind === "scheduled")).toBe(true);
    await engine.execute("profile.pause", { profile: "Mia" });
    const paused = await engine.execute<M.ProfileDetail>("profile.get", { profile: "Mia" });
    const manual = paused.ok ? paused.result.today.segments.filter((x) => x.kind === "manual") : [];
    // A manual pause runs from now to the next scheduled start (Homework at 4 PM is the first after 2:41 PM, if enabled today).
    expect(manual).toHaveLength(1);
    expect(manual[0]?.start).toBe(14 * 60 + 41);
  });

  it("are writes, delete destructive, and invalidate profiles, devices and network", () => {
    const specs = profileCommands.filter((c) => c.id.startsWith("profile.") && !c.id.startsWith("profile.schedule") && c.effect !== "query");
    expect(Object.fromEntries(specs.map((c) => [c.id, c.effect]))).toEqual({
      "profile.create": "write",
      "profile.rename": "write",
      "profile.pause": "write",
      "profile.resume": "write",
      "profile.devices.set": "write",
      "profile.delete": "destructive",
      "profile.unassigned.pause": "write",
      "profile.unassigned.resume": "write",
    });
    for (const c of specs) expect(c.invalidates).toEqual(["profiles", "devices", "network"]);
  });
});

describe("profile writes (fake eero server)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });
  const start = (options: Parameters<typeof createFakeEero>[0] = {}) => {
    const t = fakeEngine(options);
    close = t.fake.close;
    return t;
  };
  const DEV = (mac: string) => ({ url: `/2.2/networks/100001/devices/${mac}` });

  it("creates with POST {net}/profiles and a JSON body", async () => {
    const { fake, engine } = start();
    const r = await engine.execute<M.Profile>("profile.create", { name: "Guests", devices: ["0a1b2c000006"] });
    expect(r).toMatchObject({ ok: true, result: { name: "Guests", deviceIds: ["0a1b2c000006"] } });
    expect(fake.writes.at(-1)).toMatchObject({ method: "POST", version: "2.2", route: "/networks/100001/profiles", encoding: "json", body: { name: "Guests", paused: false, devices: [DEV("0a1b2c000006")] } });
    const after = await engine.execute<M.ProfileList>("profile.list");
    expect(after.ok && after.result.profiles.map((p) => p.name)).toContain("Guests");
    expect(after.ok && after.result.unassigned.deviceIds).not.toContain("0a1b2c000006");
  });

  it("renames, pauses, resumes and sets devices with PUT {profile} JSON", async () => {
    const { fake, engine } = start();
    await engine.execute("profile.list"); // cached; each write must invalidate it
    expect(await engine.execute("profile.rename", { profile: "Alex", name: "Alexis" })).toMatchObject({ ok: true, result: { id: "700", name: "Alexis" } });
    expect(fake.writes.at(-1)).toMatchObject({ method: "PUT", version: "2.2", route: "/networks/100001/profiles/700", encoding: "json", body: { name: "Alexis" } });
    const renamed = await engine.execute<M.ProfileList>("profile.list");
    expect(renamed.ok && renamed.result.profiles.map((p) => p.name)).toContain("Alexis");

    expect(await engine.execute("profile.pause", { profile: "Alexis" })).toMatchObject({ ok: true, result: { paused: true, state: "paused" } });
    expect(fake.writes.at(-1)).toMatchObject({ method: "PUT", route: "/networks/100001/profiles/700", body: { paused: true } });
    const devices = await engine.execute<M.DeviceList>("device.list", { profile: "Alexis" });
    expect(devices.ok && devices.result.devices.every((d) => d.paused)).toBe(true);
    expect(await engine.execute("profile.resume", { profile: "700" })).toMatchObject({ ok: true, result: { paused: false } });
    expect(fake.writes.at(-1)).toMatchObject({ body: { paused: false } });

    expect(await engine.execute("profile.devices.set", { profile: "700", devices: ["0a1b2c000001", "0a1b2c000006"] })).toMatchObject({ ok: true, result: { deviceIds: ["0a1b2c000001", "0a1b2c000006"] } });
    expect(fake.writes.at(-1)).toMatchObject({ method: "PUT", route: "/networks/100001/profiles/700", body: { devices: [DEV("0a1b2c000001"), DEV("0a1b2c000006")] } });
    const after = await engine.execute<M.ProfileList>("profile.list");
    // Alex's Laptop left to Unassigned (eero's default profile); the loose device joined.
    expect(after.ok && after.result.unassigned.deviceIds).toContain("0a1b2c000002");
    expect(after.ok && after.result.unassigned.deviceIds).not.toContain("0a1b2c000006");
  });

  it("deletes with DELETE {profile} only after confirm", async () => {
    const { fake, engine } = start();
    expect(await engine.execute("profile.delete", { profile: "Leo" })).toMatchObject({ ok: false, error: { code: "needs_confirm" } });
    expect(fake.writes).toHaveLength(0);
    expect(await engine.execute("profile.delete", { profile: "Leo", confirm: true })).toEqual({ ok: true, result: { deleted: "703", name: "Leo" } });
    expect(fake.writes.at(-1)).toMatchObject({ method: "DELETE", version: "2.2", route: "/networks/100001/profiles/703" });
    const after = await engine.execute<M.ProfileList>("profile.list");
    expect(after.ok && after.result.profiles.map((p) => p.name)).toEqual(["Alex", "Jamie", "Mia"]);
    expect(after.ok && after.result.unassigned.deviceIds).toContain("0a1b2c000005");
    const leoSwitch = await engine.execute<M.Device>("device.get", { device: "0a1b2c000005" });
    expect(leoSwitch.ok && leoSwitch.result.paused).toBe(false);
  });

  it("never offers eero's default profile as a profile, and pauses Unassigned through it", async () => {
    const { fake, engine } = start();
    // 790 is the fake's `default: true` Unassigned group: not a profile to any command.
    for (const [id, params] of [
      ["profile.get", { profile: "790" }],
      ["profile.get", { profile: "Unassigned" }],
      ["profile.pause", { profile: "790" }],
      ["profile.rename", { profile: "790", name: "X" }],
      ["profile.devices.set", { profile: "790", devices: [] }],
      ["profile.delete", { profile: "790", confirm: true }],
    ] as const) {
      expect(await engine.execute(id, params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
    expect(fake.writes).toHaveLength(0);
    const list = await engine.execute<M.ProfileList>("profile.list");
    expect(list.ok && list.result.profiles.map((p) => p.id)).not.toContain("790");

    expect(await engine.execute("profile.unassigned.pause")).toEqual({ ok: true, result: { paused: true } });
    expect(fake.writes.at(-1)).toMatchObject({ method: "PUT", version: "2.2", route: "/networks/100001/profiles/790", encoding: "json", body: { paused: true } });
    const after = await engine.execute<M.ProfileList>("profile.list");
    expect(after.ok && after.result.unassigned.paused).toBe(true);
    expect(after.ok && after.result.profiles.every((p) => p.name !== "Leo" || p.paused)).toBe(true);
    expect(await engine.execute("profile.unassigned.resume")).toEqual({ ok: true, result: { paused: false } });
    expect(fake.writes.at(-1)).toMatchObject({ route: "/networks/100001/profiles/790", body: { paused: false } });
    const back = await engine.execute<M.ProfileList>("profile.list");
    expect(back.ok && back.result.unassigned.paused).toBe(false);
  });

  it("pauses each unprofiled device on /2.3/ when the network has no default profile", async () => {
    // The device write route is M4.4's; this stands in for it (2.3 only, as eero saves device writes there).
    const { fake, engine } = start({
      routes: [{ method: "PUT", path: "/networks/:net/devices/:mac", versions: ["2.3"], handle: ({ req }) => ({ data: { paused: req.body.paused } }) }],
    });
    const net = fake.state.networks.get("100001");
    if (!net) throw new Error("no fake network");
    // eeroOS before 7.12.4: no default profile, unprofiled devices have `profile: null`.
    net.profiles = net.profiles.filter((p) => p.default !== true);
    for (const d of net.devices) if (d.profile?.url?.endsWith("/790")) d.profile = null;
    const r = await engine.execute("profile.unassigned.pause");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const puts = fake.writes.filter((w) => w.method === "PUT");
    expect(puts.map((w) => w.route)).toEqual(["/networks/100001/devices/0a1b2c000006", "/networks/100001/devices/0a1b2c000007", "/networks/100001/devices/0a1b2c000008"]);
    expect(puts.every((w) => w.version === "2.3" && (w.body as { paused?: unknown }).paused === true)).toBe(true);
  });
});
