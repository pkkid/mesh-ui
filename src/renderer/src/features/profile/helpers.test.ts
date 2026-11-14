import { afterEach, describe, expect, it } from "vitest";

import { createFakeEero, type FakeEero } from "../../../../../test/fake-eero/server";
import type { SecretStore } from "../../../../core/backend";
import { nextChange, stateOf } from "../../../../core/commands/profile";
import { createEeroBackend } from "../../../../core/eero/backend";
import { createEngine } from "../../../../core/engine";
import type { Device, Profile, Schedule } from "../../../../core/model";
import {
  connectionLine,
  dayChips,
  deviceRows,
  heroLine,
  hoursLine,
  inScheduledPause,
  neighbour,
  scheduledHoursPerWeek,
  scheduleIcon,
  spanMinutes,
  timeRange,
  todayIn,
  untilText,
  usageMarkers,
  weekInput,
} from "./helpers";

const TZ = "America/Los_Angeles";
/** Wednesday Nov 11 2026, 2:05 PM Pacific. */
const NOW = Date.parse("2026-11-11T22:05:00Z");

const BEDTIME: Schedule = { id: "1", name: "Bedtime", days: ["SUN", "MON", "TUE", "WED", "THU"], start: "21:00", end: "07:00", enabled: true };
const HOMEWORK: Schedule = { id: "2", name: "Homework", days: ["MON", "TUE", "WED", "THU", "FRI"], start: "16:00", end: "18:00", enabled: true };
const LIGHTS: Schedule = { id: "3", name: "Weekend lights out", days: ["FRI", "SAT"], start: "23:00", end: "09:00", enabled: false };

/** A profile as `profile.get` returns it: state and next change from core. */
function profile(over: Partial<Profile> = {}, now = NOW): Profile {
  const p: Profile = { id: "9", name: "Mia", state: "active", paused: false, deviceIds: [], devicesOnline: 0, schedules: [BEDTIME, HOMEWORK, LIGHTS], nextChange: null, ...over };
  return { ...p, state: stateOf(p), nextChange: nextChange(p, now, TZ) };
}

/** An invented device; only the fields a test names matter. */
const device = (over: Partial<Device> & Pick<Device, "id" | "name">) =>
  ({ connected: true, paused: false, band: "5", eeroId: "e1", lastActive: null, ...over }) as Device;

describe("schedules", () => {
  it("measures spans, wrapping past midnight, and the hours a week", () => {
    expect(spanMinutes(HOMEWORK)).toBe(120);
    expect(spanMinutes(BEDTIME)).toBe(600);
    expect(spanMinutes({ start: "07:00", end: "07:00" })).toBe(1440);
    // Bedtime 10 h x 5 + Homework 2 h x 5; the disabled one does not count.
    expect(scheduledHoursPerWeek([BEDTIME, HOMEWORK, LIGHTS])).toBe(60);
    expect(hoursLine([BEDTIME, HOMEWORK, LIGHTS])).toBe("60 h / week");
    expect(hoursLine([LIGHTS])).toBeNull();
  });

  it("words times, picks icons from the name and lays out days", () => {
    expect(timeRange(BEDTIME)).toBe("9:00 PM to 7:00 AM");
    expect(["Bedtime", "Homework", "Dinner", "Lights out", "Chores"].map(scheduleIcon)).toEqual(["moon", "book", "utensils", "moon", "calendar-clock"]);
    expect(dayChips(HOMEWORK.days).map((c) => `${c.letter}${c.on ? "+" : ""}`).join(" ")).toBe("S M+ T+ W+ T+ F+ S");
    expect(weekInput(BEDTIME)).toEqual({ id: "1", label: "Bedtime", days: [6, 0, 1, 2, 3], start: 1260, end: 420, enabled: true });
  });
});

describe("hero line", () => {
  it("counts down to the next scheduled pause from core's next change", () => {
    const p = profile();
    expect(p.state).toBe("scheduled");
    expect(heroLine(p, TZ, NOW)).toBe("Homework pause starts at 4:00 PM, in 1h 55m");
    expect(inScheduledPause(p)).toBe(false);
  });

  it("names the schedule pausing now and when it ends", () => {
    const at = Date.parse("2026-11-12T01:00:00Z"); // Wed 5:00 PM, inside Homework
    const p = profile({}, at);
    expect(inScheduledPause(p)).toBe(true);
    expect(heroLine(p, TZ, at)).toBe("Homework until 6:00 PM");
  });

  it("says a manual pause lasts until resumed and an unscheduled profile has none", () => {
    expect(heroLine(profile({ paused: true }), TZ, NOW)).toBe("Paused until resumed");
    expect(heroLine(profile({ schedules: [] }), TZ, NOW)).toBe("No scheduled pauses");
    expect(heroLine(profile({ schedules: [LIGHTS] }), TZ, NOW)).toBe("No scheduled pauses");
  });

  it("adds the weekday when the change is on another day", () => {
    const fri = Date.parse("2026-11-14T02:30:00Z"); // Fri 6:30 PM; next is Bedtime Sun 9:00 PM
    expect(heroLine(profile({ schedules: [BEDTIME] }, fri), TZ, fri)).toBe("Bedtime pause starts Sun 9:00 PM, in 2d 2h");
  });

  it("words durations", () => {
    expect([0, 12, 60, 115, 1440, 1500].map((m) => untilText(m * 60_000))).toEqual(["1m", "12m", "1h", "1h 55m", "1d", "1d 1h"]);
  });
});

describe("timeline and usage", () => {
  it("finds today's lane and minute in the network time zone", () => {
    expect(todayIn(NOW, TZ)).toEqual({ lane: 2, minute: 14 * 60 + 5 });
    expect(todayIn(NOW, null)).toEqual({ lane: 2, minute: 22 * 60 + 5 });
  });

  it("marks where enabled schedules start and end on hourly points", () => {
    // Wed 3 PM to Thu 8 AM Pacific, hourly.
    const start = Date.parse("2026-11-11T23:00:00Z");
    const points = Array.from({ length: 18 }, (_, i) => ({ at: new Date(start + i * 3_600_000).toISOString(), down: 1, up: 1 }));
    const marks = usageMarkers(points, [BEDTIME, HOMEWORK, LIGHTS], TZ).map((m) => `${m.index} ${m.label}`);
    expect(marks).toEqual(["1 Homework starts", "3 Homework ends", "6 Bedtime starts", "16 Bedtime ends"]);
  });
});

describe("devices", () => {
  it("lists online first, then by data, with each device's share", () => {
    const rows = deviceRows(
      [device({ id: "a", name: "Tablet", connected: false }), device({ id: "b", name: "Phone" }), device({ id: "c", name: "Laptop" })],
      [
        { id: "a", name: "Tablet", down: 50, up: 0, share: 0 },
        { id: "b", name: "Phone", down: 20, up: 5, share: 0 },
        { id: "c", name: "Laptop", down: 20, up: 5, share: 0 },
      ],
    );
    expect(rows.map((r) => [r.device.name, r.share])).toEqual([
      ["Laptop", 25],
      ["Phone", 25],
      ["Tablet", 50],
    ]);
    expect(deviceRows([device({ id: "a", name: "A" })], undefined)[0]).toMatchObject({ down: null, share: null });
  });

  it("words the connection", () => {
    expect(connectionLine(device({ id: "a", name: "A" }), "Upstairs Hall", NOW, TZ)).toBe("Upstairs Hall · 5 GHz");
    expect(connectionLine(device({ id: "a", name: "A", band: "wired", paused: true }), "Office", NOW, TZ)).toBe("Office · Wired");
    const gone = device({ id: "a", name: "A", connected: false, lastActive: new Date(NOW - 2 * 3_600_000).toISOString() });
    expect(connectionLine(gone, "Upstairs Hall", NOW, TZ)).toBe("Offline · last seen 2 h ago on Upstairs Hall");
    expect(connectionLine({ ...gone, lastActive: null }, null, NOW, TZ)).toBe("Offline");
  });

  it("moves between profiles with [ and ]", () => {
    expect(neighbour(["a", "b", "c"], "c", 1)).toBe("a");
    expect(neighbour(["a", "b", "c"], "a", -1)).toBe("c");
    expect(neighbour(["a"], "a", 1)).toBeNull();
    expect(neighbour(["a", "b"], "x", 1)).toBeNull();
  });
});

/** Every read ProfilePage and its sections mount, shell reads first. Keep in step with the page. */
const pageReads = (profile: string): [string, unknown?][] => [
  ["auth.status"],
  ["account.get"],
  ["network.list"],
  ["network.get"],
  ["profile.get", { profile }],
  ["profile.list"],
  ["eero.list"],
  ["usage.get", { scope: "profile", id: profile, range: "week" }],
  ["usage.get", { scope: "profile", id: profile, range: "day" }],
  ["usage.breakdown", { range: "day", by: "device", profile }],
  ["device.list", { profile }],
];

describe("page load against the fake eero server", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("loads a profile within the request budget", async () => {
    fake = createFakeEero();
    const token = fake.signIn();
    const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
    const engine = createEngine({ backend: createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch }) });
    // Every read at once, as React mounts the page (Mia, with schedules).
    const page = pageReads("702");
    const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
    expect(results.flatMap((r, i) => (r.ok ? [] : [`${page[i]?.[0]}: ${r.error.message}`]))).toEqual([]);
    const get = results[page.findIndex(([id]) => id === "profile.get")];
    expect(get?.ok && (get.result as Profile).schedules.length).toBeGreaterThan(0);
    // Identical reads are shared; no /schedules reads (a 404 on real eero); about 18 requests, well under the 80 a minute budget.
    expect(fake.log.some((e) => e.path.endsWith("/schedules"))).toBe(false);
    expect(fake.log.length).toBeLessThanOrEqual(20);
  });
});
