import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { dayOf, mapProfile, type RawScheduleFull } from "../eero/map/profile";
import { createEngine } from "../engine";
import type * as M from "../model";
import { nextChange } from "./profile";

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
      ["702", "Mia", "active", ["0a1b2c000004"]],
    ]);
    const mia = r.result.profiles.find((p) => p.name === "Mia");
    expect(mia?.schedules).toEqual([{ id: "1", name: "Bedtime", days: ["MON", "TUE", "WED", "THU", "SUN"], start: "21:00", end: "07:00", enabled: true }]);
    // Thursday 5:41 PM in New York: Bedtime starts at 9 PM (02:00Z).
    expect(mia?.nextChange).toEqual({ at: "2026-11-13T02:00:00.000Z", to: "paused", scheduleId: "1" });
    expect(r.result.unassigned).toEqual({ deviceIds: ["0a1b2c000006", "0a1b2c000007", "0a1b2c000008"], devicesOnline: 2, paused: false });
    expect(fake.log.some((e) => e.path.includes("/schedules"))).toBe(false);
  });

  it("reads {profile}/schedules for profile.get, falling back to the profile's own list", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.Profile>("profile.get", { profile: "Mia" });
    expect(r.ok && r.result).toMatchObject({ id: "702", schedules: [{ name: "Bedtime" }] });
    expect(fake.log.at(-1)?.path).toBe("/2.2/networks/100001/profiles/702/schedules");
    fake.scenarios.fail(404, "error.not.found", { path: "/schedules" });
    const fallback = await engine.backend.profile.get("100001", "702");
    expect(fallback.schedules.map((s) => s.name)).toEqual(["Bedtime"]);
    fake.scenarios.fail(403, "error.forbidden", { path: "/schedules" });
    expect(await engine.backend.profile.get("100001", "702").catch((e: { code: string }) => e.code)).toBe("eero_error");
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
