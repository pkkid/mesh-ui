import { describe, expect, it } from "vitest";
import type { HealthReport } from "../../../../core/model";
import { newerReport } from "./helpers";

const report = (at: string): HealthReport => ({ overall: "good", score: 100, checks: [], at });

describe("newerReport", () => {
  it("keeps a fresh Run again result over an older polled (cached) report", () => {
    const polled = report("2026-11-12T22:41:00Z");
    const rerun = report("2026-11-12T22:41:05Z");
    expect(newerReport(polled, rerun)).toBe(rerun);
    expect(newerReport(rerun, polled)).toBe(rerun);
    expect(newerReport(undefined, rerun)).toBe(rerun);
    expect(newerReport(polled, undefined)).toBe(polled);
  });
});
