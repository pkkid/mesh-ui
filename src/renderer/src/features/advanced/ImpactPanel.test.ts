import { describe, expect, it } from "vitest";

import { eerosRestarting } from "./ImpactPanel";

describe("eerosRestarting", () => {
  it("is every eero when the change restarts the network", () => {
    expect(eerosRestarting({ restarts: true }, 4)).toBe(4);
  });
  it("is 0, not a word, when nothing restarts", () => {
    expect(eerosRestarting({ restarts: false }, 4)).toBe(0);
    expect(eerosRestarting({ restarts: false }, null)).toBe(0);
  });
  it("is null while the impact or the eero count loads", () => {
    expect(eerosRestarting(null, 4)).toBeNull();
    expect(eerosRestarting({ restarts: true }, null)).toBeNull();
  });
});
