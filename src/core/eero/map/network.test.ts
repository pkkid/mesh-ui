import { describe, expect, it } from "vitest";
import { mapPermissions, mapRole, roleFor } from "./network";

describe("mapRole", () => {
  it("maps the real owner role (network-owner) and admin roles; anything else is null", () => {
    expect(mapRole("network-owner")).toBe("owner");
    expect(mapRole("owner")).toBe("owner");
    expect(mapRole("standard-admin")).toBe("admin");
    expect(mapRole("network-admin")).toBe("admin");
    // The account's own `role` is `none` on the real network.
    expect(mapRole("none")).toBeNull();
    expect(mapRole(undefined)).toBeNull();
  });

  it("roleFor reads the permissions role first, then the account", () => {
    expect(roleFor({ role: "network-owner" }, { role: "none" })).toBe("owner");
    expect(roleFor(null, { role: "none" })).toBeNull();
    expect(roleFor(null, { role: "owner" })).toBe("owner");
  });
});

describe("mapPermissions", () => {
  it("keeps the real shape's areas and dotted keys as sent, without per_eero", () => {
    const flags = { create: false, read: true, update: true, delete: true };
    const perms = mapPermissions({ role: "network-owner", permissions: { network: flags, eeros: flags, "network.proxied_nodes": flags, per_eero: [] } } as never);
    expect(perms.role).toBe("owner");
    expect(Object.keys(perms.can).sort()).toEqual(["eeros", "network", "network.proxied_nodes"]);
    expect(perms.can.network).toEqual({ read: true, create: false, update: true, delete: true });
  });
});
