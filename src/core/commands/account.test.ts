import { describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapAccount } from "../eero/backend/account";
import { createEngine } from "../engine";
import type { Account } from "../model";

const secretsWith = (token: string | null): SecretStore => {
  let t = token;
  return {
    load: async () => t,
    save: async (v) => {
      t = v;
      return "keychain";
    },
    clear: async () => {
      t = null;
    },
    storage: async () => "keychain",
  };
};

describe("account.get on demo", () => {
  it("returns the account model", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    const res = await engine.execute<Account>("account.get");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result).toMatchObject({ id: expect.any(String), name: expect.any(String), canTransfer: expect.any(Boolean) });
    expect(res.result.networkCount).toBeGreaterThan(0);
  });

  it("needs a session and takes no params", async () => {
    const signedOut = createEngine({ backend: createDemoBackend({ scenario: "signed_out" }) });
    expect(await signedOut.execute("account.get")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    const engine = createEngine({ backend: createDemoBackend() });
    expect(await engine.execute("account.get", { networkId: "x" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("follows the no_networks scenario", async () => {
    const engine = createEngine({ backend: createDemoBackend({ scenario: "no_networks" }) });
    expect(await engine.execute("account.get")).toMatchObject({ ok: true, result: { networkCount: 0 } });
  });
});

describe("account.get on the fake eero server", () => {
  it("maps GET /2.2/account", async () => {
    const server = createFakeEero();
    const backend = createEeroBackend({ secrets: secretsWith(server.signIn()), origin: server.origin, fetch: server.fetch });
    const engine = createEngine({ backend });
    expect(await engine.execute("account.get")).toEqual({
      ok: true,
      result: {
        id: "FAKE0LOG01",
        name: "Alex Kim",
        email: { value: "alex@example.com", verified: true },
        phone: { value: "+15550100142", verified: true },
        authType: "email",
        marketingEmails: null,
        push: { networkOffline: true, nodeOffline: true },
        canTransfer: true,
        networkCount: 2,
      },
    });
    // Cached under the account topic: a second call does not reach eero.
    await engine.execute("account.get");
    expect(server.log.filter((l) => l.path === "/2.2/account")).toHaveLength(1);
  });

  it("a dead session is not_signed_in", async () => {
    const server = createFakeEero();
    const backend = createEeroBackend({ secrets: secretsWith("fake-session-unknown"), origin: server.origin, fetch: server.fetch });
    const engine = createEngine({ backend });
    expect(await engine.execute("account.get")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
  });

  it("maps sparse accounts without inventing values", () => {
    expect(mapAccount({})).toEqual({
      id: "",
      name: null,
      email: null,
      phone: null,
      authType: null,
      marketingEmails: null,
      push: null,
      canTransfer: false,
      networkCount: 0,
    });
    expect(mapAccount({ auth: { type: "google" }, networks: { data: [{}, {}] }, name: "  " })).toMatchObject({ authType: null, networkCount: 2, name: null });
  });
});
