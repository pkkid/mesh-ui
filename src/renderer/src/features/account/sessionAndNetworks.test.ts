import { describe, expect, it } from "vitest";

import type { AppInfo, AuthStatus, NetworkSummary } from "../../../../core/model";
import { deletePlan, offlineFor, sessionText } from "./sessionAndNetworks";

const auth = (over: Partial<AuthStatus>): AuthStatus => ({ signedIn: true, pending: false, login: null, storage: "keychain", backend: "eero", ...over });
const info = (keychainName: string | null) => ({ keychainName }) as AppInfo;
const net = (name: string, role: NetworkSummary["role"], nickname: string | null = null) => ({ id: name, name, nickname, role }) as NetworkSummary;

describe("sessionText", () => {
  it("names the keychain, or says the system keychain when the host cannot", () => {
    expect(sessionText(auth({}), info("GNOME Keyring"))).toMatch(/^Your session is saved in GNOME Keyring and refreshes on its own\./);
    expect(sessionText(auth({}), info(null))).toMatch(/^Your session is saved in the system keychain/);
  });
  it("says memory only without a keychain", () => {
    expect(sessionText(auth({ storage: "memory" }), info(null))).toMatch(/^Your session is kept in memory only on this computer; you will sign in again next time\./);
  });
  it("says demo mode in demo, and nothing before auth.status answers", () => {
    expect(sessionText(auth({ backend: "demo", storage: "memory" }), undefined)).toMatch(/^You are in demo mode/);
    expect(sessionText(undefined, undefined)).toBeNull();
  });
});

describe("deletePlan", () => {
  it("counts a null role as owned and lists shared networks", () => {
    const p = deletePlan([net("Maple Street", "owner"), net("Lake Cabin", null), net("Kim Home", "admin", "Mom's House")]);
    expect(p.owned).toEqual(["Maple Street", "Lake Cabin"]);
    expect(p.shared).toEqual(["Mom's House"]);
    expect(p.text).toBe("Closes your eero account and deletes your personal data. Transfer or delete Maple Street and Lake Cabin first. You will lose admin access to Mom's House.");
  });
  it("owns nothing when every network is shared", () => {
    expect(deletePlan([net("A", "admin")]).owned).toEqual([]);
    expect(deletePlan([]).text).toBe("Closes your eero account and deletes your personal data.");
  });
});

describe("offlineFor", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  it("reads Offline 2d, 3h, 5m, or just Offline", () => {
    expect(offlineFor("2026-11-12T10:00:00Z", now)).toBe("Offline 2d");
    expect(offlineFor("2026-11-14T09:00:00Z", now)).toBe("Offline 3h");
    expect(offlineFor("2026-11-14T11:55:00Z", now)).toBe("Offline 5m");
    expect(offlineFor("2026-11-14T12:00:00Z", now)).toBe("Offline 1m");
    expect(offlineFor(null, now)).toBe("Offline");
  });
});
