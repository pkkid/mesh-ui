import { describe, expect, it } from "vitest";
import { allCommands, createRegistry } from "./registry";

describe("write gates", () => {
  it("every write, disruptive and destructive command declares a gate in its spec", () => {
    const missing = allCommands()
      .filter((c) => c.effect !== "query" && !c.gate)
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it("the registry lists each write's gate with defaults filled in, and none for queries", () => {
    const info = createRegistry(allCommands(), { backend: "demo" }).describe();
    for (const c of info) {
      if (c.effect === "query") expect(c.gate).toBeNull();
      else expect(c.gate).toMatchObject({ op: expect.any(String), bridgeOff: expect.any(Boolean) });
    }
    expect(info.find((c) => c.id === "device.block")?.gate).toEqual({ area: "devices", op: "update", bridgeOff: true, capability: "device_blacklist" });
    expect(info.find((c) => c.id === "auth.logout")?.gate).toEqual({ area: null, op: "update", bridgeOff: false, capability: null });
  });
});
