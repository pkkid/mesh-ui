import { describe, expect, it } from "vitest";

import { daySpans, hhmmMinutes, sameDays, timeOptions } from "./schedule-fields";

describe("hhmmMinutes", () => {
  it("reads HH:MM as minutes after midnight", () => {
    expect(hhmmMinutes("00:00")).toBe(0);
    expect(hhmmMinutes("09:30")).toBe(570);
    expect(hhmmMinutes("23:59")).toBe(1439);
  });
});

describe("daySpans", () => {
  it("is one span inside the day", () => {
    expect(daySpans("09:00", "17:00")).toEqual([{ from: 540, to: 1020 }]);
  });
  it("splits a span that wraps past midnight", () => {
    expect(daySpans("21:00", "07:00")).toEqual([
      { from: 0, to: 420 },
      { from: 1260, to: 1440 },
    ]);
  });
  it("has no morning piece when it ends at midnight", () => {
    expect(daySpans("22:00", "00:00")).toEqual([{ from: 1320, to: 1440 }]);
  });
  it("is empty for equal or missing times", () => {
    expect(daySpans("08:00", "08:00")).toEqual([]);
    expect(daySpans("", "08:00")).toEqual([]);
    expect(daySpans("08:00", "")).toEqual([]);
  });
});

describe("timeOptions", () => {
  it("lists every 15 minutes of the day in order, labelled in 12 hour time", () => {
    const opts = timeOptions("21:00");
    expect(opts).toHaveLength(96);
    expect(opts[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(opts[1]?.value).toBe("00:15");
    expect(opts.at(-1)).toEqual({ value: "23:45", label: "11:45 PM" });
    expect(opts.find((o) => o.value === "21:00")?.label).toBe("9:00 PM");
  });
  it("keeps a time that is off the grid, in its place", () => {
    const opts = timeOptions("21:05");
    expect(opts).toHaveLength(97);
    const i = opts.findIndex((o) => o.value === "21:05");
    expect(opts[i]?.label).toBe("9:05 PM");
    expect(opts[i - 1]?.value).toBe("21:00");
    expect(opts[i + 1]?.value).toBe("21:15");
  });
  it("is the plain grid when empty", () => {
    expect(timeOptions("")).toHaveLength(96);
  });
});

describe("sameDays", () => {
  it("ignores order", () => {
    expect(sameDays(["MON", "TUE"], ["TUE", "MON"])).toBe(true);
    expect(sameDays(["MON"], ["MON", "TUE"])).toBe(false);
  });
});
