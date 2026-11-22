import { describe, expect, it } from "vitest";

import { saveVariantFor } from "./sheet";

describe("saveVariantFor", () => {
  it("is the primary colour for writes, queries or nothing named", () => {
    expect(saveVariantFor([])).toBe("default");
    expect(saveVariantFor(["write", "query"])).toBe("default");
    // The registry is still loading.
    expect(saveVariantFor([undefined])).toBe("default");
  });
  it("is yellow when any command is disruptive", () => {
    expect(saveVariantFor(["write", "disruptive"])).toBe("warning");
  });
  it("is red when any command is destructive, even beside a disruptive one", () => {
    expect(saveVariantFor(["disruptive", "destructive"])).toBe("destructive");
  });
});
