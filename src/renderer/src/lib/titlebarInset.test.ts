import { describe, expect, it } from "vitest";

import { rightInset } from "./titlebarInset";

describe("rightInset", () => {
  it("is the width the overlay covers at the right", () => {
    expect(rightInset({ x: 0, width: 1080 }, 1200)).toBe(120);
    expect(rightInset({ x: 0, width: 1130.4 }, 1200)).toBe(70);
  });

  it("is 0 when the controls take no space", () => {
    expect(rightInset({ x: 0, width: 1200 }, 1200)).toBe(0);
  });

  it("is null for an empty or impossible rect, so the CSS fallback stays", () => {
    expect(rightInset({ x: 0, width: 0 }, 1200)).toBeNull();
    expect(rightInset({ x: 0, width: 1300 }, 1200)).toBeNull();
    expect(rightInset({ x: 0, width: 800 }, 0)).toBeNull();
  });
});
