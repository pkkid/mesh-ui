import { describe, expect, it } from "vitest";
import { allCommands, createRegistry } from "./registry";
import { OWNER_ONLY, ownerOnly, permissionFor } from "./spec";

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

describe("permissionFor", () => {
  const p = (read: boolean, create: boolean, update: boolean, del: boolean) => ({ read, create, update, delete: del });
  // The real shape (M5.1-fix capture): network and eeros areas plus dotted keys; network.create is false for the owner.
  const owner = { can: { network: p(true, false, true, true), eeros: p(true, true, true, true), "network.subnets": p(true, false, false, false), "network.proxied_nodes": p(true, false, true, false) } };
  const admin = { can: { network: p(true, false, true, false), eeros: p(true, false, false, false) } };
  const readOnly = { can: { network: p(true, false, false, false) } };

  it("uses a key eero sends as sent", () => {
    expect(permissionFor(owner, "eeros")).toEqual(p(true, true, true, true));
    expect(permissionFor(owner, "network.proxied_nodes")).toEqual(p(true, false, true, false));
    expect(permissionFor(admin, "eeros")?.update).toBe(false);
  });

  it("gives an area eero does not send network's update for every op", () => {
    for (const area of ["devices", "profiles", "settings", "updates"]) {
      expect(permissionFor(owner, area), area).toEqual(p(true, true, true, true));
      expect(permissionFor(admin, area), area).toEqual(p(true, true, true, true));
      expect(permissionFor(readOnly, area), area).toEqual(p(true, false, false, false));
    }
  });

  it("gives a dotted key it does not send its nearest sent parent, then network", () => {
    expect(permissionFor(owner, "network.subnets.main.password")).toEqual(p(true, false, false, false));
    expect(permissionFor(owner, "network.radio_settings")).toEqual(p(true, true, true, true));
    expect(permissionFor(owner, "amazon.account")).toEqual(p(true, true, true, true));
  });

  it("is null when nothing covers the area", () => {
    expect(permissionFor({ can: {} }, "devices")).toBeNull();
    expect(permissionFor({ can: { eeros: p(true, true, true, true) } }, "settings")).toBeNull();
  });
});

describe("ownerOnly", () => {
  it("refuses a known admin only; the owner and an unknown role are not refused", () => {
    expect(ownerOnly("admin")).toBe(OWNER_ONLY);
    expect(ownerOnly("owner")).toBeNull();
    expect(ownerOnly(null)).toBeNull();
    expect(ownerOnly(undefined)).toBeNull();
  });
});
