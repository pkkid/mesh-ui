import { describe, expect, it } from "vitest";

import { nextReadings, type LiveReading } from "./liveReadings";

const rates = (at: string, downMbps: number, upMbps: number) => ({ at, downMbps, upMbps });

describe("live readings", () => {
  it("adds a point for a new burst or new figures, not for a repeat", () => {
    let list: readonly LiveReading[] = [];
    list = nextReadings(list, rates("t1", 4, 1), "a1");
    expect(nextReadings(list, rates("t1", 4, 1), "a2")).toBe(list);
    list = nextReadings(list, rates("t1", 5, 1), "a3");
    list = nextReadings(list, rates("t2", 5, 1), "a4");
    expect(list.map((r) => r.down)).toEqual([4, 5, 5]);
  });

  it("keeps the latest points up to the cap", () => {
    let list: readonly LiveReading[] = [];
    for (let i = 0; i < 5; i++) list = nextReadings(list, rates(`t${i}`, i, 0), `a${i}`, 3);
    expect(list.map((r) => r.down)).toEqual([2, 3, 4]);
  });
});
