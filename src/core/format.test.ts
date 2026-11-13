import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatMbps, formatPercent, formatRelative, MISSING, networkClock, toCsv } from "./format";

describe("formatters", () => {
  it("show '-' for a missing value, never 0 or blank", () => {
    for (const f of [formatMbps, formatBytes, formatPercent, formatDuration]) {
      expect(f(null)).toBe(MISSING);
      expect(f(undefined)).toBe(MISSING);
      expect(f(Number.NaN)).toBe(MISSING);
    }
    expect(formatRelative(null, 0)).toBe(MISSING);
  });

  it("format rates in Mbps", () => {
    expect(formatMbps(186.4)).toBe("186 Mbps");
    expect(formatMbps(4.25)).toBe("4.3 Mbps");
    expect(formatMbps(0)).toBe("0 Mbps");
    expect(formatMbps(2500)).toBe("2,500 Mbps");
  });

  it("format volumes in decimal units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(4_120_000)).toBe("4.1 MB");
    expect(formatBytes(41_200_000_000)).toBe("41.2 GB");
    expect(formatBytes(412_000_000_000)).toBe("412 GB");
    expect(formatBytes(1_500_000_000_000)).toBe("1.5 TB");
  });

  it("format percents", () => {
    expect(formatPercent(42.4)).toBe("42%");
    expect(formatPercent(0.3)).toBe("<1%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(12.345, 1)).toBe("12.3%");
  });

  it("format durations", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(12 * 60)).toBe("12 min");
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(formatDuration(5 * 86400 + 3 * 3600)).toBe("5 d 3 h");
  });

  it("format relative time", () => {
    const now = Date.parse("2026-11-12T22:41:00Z");
    expect(formatRelative("2026-11-12T22:40:30Z", now)).toBe("just now");
    expect(formatRelative("2026-11-12T22:36:00Z", now)).toBe("5 min ago");
    expect(formatRelative("2026-11-12T19:41:00Z", now)).toBe("3 h ago");
    expect(formatRelative("2026-11-10T22:41:00Z", now)).toBe("2 d ago");
    expect(formatRelative("2026-11-12T22:46:00Z", now)).toBe("in 5 min");
    expect(formatRelative("2026-11-01T12:00:00Z", now)).toBe("Nov 1");
    expect(formatRelative("not a date", now)).toBe(MISSING);
  });

  it("build RFC 4180 CSV and defuse formulas", () => {
    const rows = [
      { name: 'Leo\'s "Switch", 2', down: 1200, note: null },
      { name: "=HYPERLINK(1)", down: -5, note: "a\nb" },
    ];
    const csv = toCsv(rows, [
      { header: "Name", value: (r) => r.name },
      { header: "Down", value: (r) => r.down },
      { header: "Note", value: (r) => r.note },
    ]);
    expect(csv).toBe('Name,Down,Note\r\n"Leo\'s ""Switch"", 2",1200,\r\n\'=HYPERLINK(1),-5,"a\nb"\r\n');
  });
});

describe("networkClock", () => {
  const ny = networkClock("America/New_York");
  const tokyo = networkClock("Asia/Tokyo");

  it("formats the same instant in two zones", () => {
    const at = "2026-10-20T13:41:00Z";
    expect(ny.time(at)).toBe("9:41 AM");
    expect(tokyo.time(at)).toBe("10:41 PM");
    expect(ny.dateTime(at)).toBe("Oct 20, 9:41 AM");
    expect(tokyo.dateTime(at)).toBe("Oct 20, 10:41 PM");
    expect(ny.hour(at)).toBe("9 AM");
    expect(tokyo.hour(at)).toBe("10 PM");
    expect(ny.day("2026-11-08T15:00:00Z")).toBe("Sun Nov 8");
    expect(tokyo.day("2026-11-08T15:00:00Z")).toBe("Mon Nov 9");
    expect(ny.longDate("2026-11-08T15:00:00Z")).toBe("Sunday, Nov 8");
    expect(ny.weekday(Date.parse("2026-11-07T15:00:00Z"))).toBe("Sat");
    expect(ny.longWeekday("2026-11-07T15:00:00Z")).toBe("Saturday");
  });

  it("follows a DST change", () => {
    // US clocks fall back at 2:00 AM EDT on Sun Nov 1 2026 (06:00 UTC).
    expect(ny.time("2026-11-01T05:30:00Z")).toBe("1:30 AM"); // EDT, UTC-4
    expect(ny.time("2026-11-01T06:30:00Z")).toBe("1:30 AM"); // EST, UTC-5: the hour repeats
    expect(ny.time("2026-11-01T07:30:00Z")).toBe("2:30 AM");
    expect(ny.dateTime("2026-10-31T13:41:00Z")).toBe("Oct 31, 9:41 AM");
    expect(ny.dateTime("2026-11-02T14:41:00Z")).toBe("Nov 2, 9:41 AM");
    // Tokyo has no DST: the same UTC hour keeps its local hour.
    expect(tokyo.time("2026-10-31T13:41:00Z")).toBe("10:41 PM");
    expect(tokyo.time("2026-11-02T13:41:00Z")).toBe("10:41 PM");
    // Day-by-hour grid cells across the change.
    expect(ny.parts("2026-11-01T05:30:00Z")).toEqual({ weekday: 6, hour: 1 });
    expect(ny.parts("2026-11-01T06:30:00Z")).toEqual({ weekday: 6, hour: 1 });
    expect(ny.parts("2026-11-02T14:00:00Z")).toEqual({ weekday: 0, hour: 9 });
  });

  it("reads a missing or unknown zone as UTC, a bad time as '-'", () => {
    expect(networkClock(null).time("2026-10-20T13:41:00Z")).toBe("1:41 PM");
    expect(networkClock("Not/AZone").time("2026-10-20T13:41:00Z")).toBe("1:41 PM");
    expect(ny.time("not a date")).toBe(MISSING);
    expect(ny.day("not a date")).toBe(MISSING);
    expect(ny.parts("not a date")).toEqual({ weekday: -1, hour: -1 });
    expect(networkClock("America/New_York")).toBe(ny);
  });
});
