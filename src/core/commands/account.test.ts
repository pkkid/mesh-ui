import { describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapAccount } from "../eero/backend/account";
import { createEngine } from "../engine";
import type { Account, HostEvent } from "../model";

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

describe("account writes on demo", () => {
  const engine = () => createEngine({ backend: createDemoBackend() });

  it("account.get polls every 5 minutes with a cache under that", () => {
    const spec = engine()
      .commands()
      .find((c) => c.id === "account.get");
    expect(spec?.poll).toBe(300);
  });

  it("account.name.set renames and answers with the account", async () => {
    const e = engine();
    expect(await e.execute<Account>("account.name.set", { name: "  Sam Lee " })).toMatchObject({ ok: true, result: { name: "Sam Lee" } });
    expect(await e.execute("account.get")).toMatchObject({ ok: true, result: { name: "Sam Lee" } });
    for (const params of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(65) }, { name: 1 }]) {
      expect(await e.execute("account.name.set", params), JSON.stringify(params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });

  it("account.email.set leaves the new address unverified until account.email.verify", async () => {
    const e = engine();
    expect(await e.execute("account.email.set", { email: "sam@example.com" })).toMatchObject({ ok: true, result: { email: { value: "sam@example.com", verified: false } } });
    expect(await e.execute("account.email.verify", { code: "111111" })).toMatchObject({ ok: false, error: { code: "eero_error" } });
    expect(await e.execute("account.email.verify", { code: "123456" })).toMatchObject({ ok: true, result: { email: { value: "sam@example.com", verified: true } } });
    // Nothing waits for a code any more.
    expect(await e.execute("account.email.verify", { code: "123456" })).toMatchObject({ ok: false, error: { code: "eero_error" } });
    for (const params of [{}, { email: "not-an-email" }]) expect(await e.execute("account.email.set", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    for (const params of [{}, { code: "12345" }, { code: "abcdef" }]) expect(await e.execute("account.email.verify", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("account.phone.verify verifies the demo's unverified number, and account.phone.set takes E.164 only", async () => {
    const e = engine();
    expect(await e.execute("account.get")).toMatchObject({ ok: true, result: { phone: { verified: false } } });
    expect(await e.execute("account.phone.verify", { code: "654321" })).toMatchObject({ ok: true, result: { phone: { verified: true } } });
    expect(await e.execute("account.phone.set", { phone: "+15550100199" })).toMatchObject({ ok: true, result: { phone: { value: "+15550100199", verified: false } } });
    for (const phone of ["5550100199", "+0555", "+1 555 010 0199", ""]) expect(await e.execute("account.phone.set", { phone })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await e.execute("account.phone.verify", {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("account.consents.set switches product news emails", async () => {
    const e = engine();
    expect(await e.execute("account.consents.set", { marketingEmails: true })).toMatchObject({ ok: true, result: { marketingEmails: true } });
    expect(await e.execute("account.consents.set", {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await e.execute("account.consents.set", { marketingEmails: "true" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("account.push.set merges the key not given with the account's", async () => {
    const e = engine();
    expect(await e.execute("account.push.set", { nodeOffline: false })).toMatchObject({ ok: true, result: { push: { networkOffline: true, nodeOffline: false } } });
    expect(await e.execute("account.push.set", { networkOffline: false })).toMatchObject({ ok: true, result: { push: { networkOffline: false, nodeOffline: false } } });
    for (const params of [{}, { nodeOffline: 1 }, { other: true }]) expect(await e.execute("account.push.set", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("every write needs a session", async () => {
    const e = createEngine({ backend: createDemoBackend({ scenario: "signed_out" }) });
    expect(await e.execute("account.name.set", { name: "Sam" })).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    expect(await e.execute("account.delete", { acknowledge: true, confirm: true })).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
  });
});

describe("account.delete on demo", () => {
  it("needs acknowledge: true, then confirm", async () => {
    const e = createEngine({ backend: createDemoBackend({ scenario: "no_networks" }) });
    for (const params of [{}, { acknowledge: false }, { acknowledge: "true" }, { confirm: true }]) {
      expect(await e.execute("account.delete", params), JSON.stringify(params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
    const res = await e.execute("account.delete", { acknowledge: true });
    expect(res).toMatchObject({ ok: false, error: { code: "needs_confirm" } });
    if (!res.ok) expect(res.error.message).toMatch(/cannot be undone/);
  });

  it("refuses while the account owns networks, before any confirm", async () => {
    const e = createEngine({ backend: createDemoBackend() });
    for (const params of [{ acknowledge: true }, { acknowledge: true, confirm: true }]) {
      const res = await e.execute("account.delete", params);
      expect(res).toMatchObject({ ok: false, error: { code: "bad_params" } });
      if (!res.ok) expect(res.error.message).toMatch(/Transfer or delete/);
    }
    expect(await e.execute("account.get")).toMatchObject({ ok: true });
  });

  it("deletes, signs out and announces it", async () => {
    const e = createEngine({ backend: createDemoBackend({ scenario: "no_networks" }) });
    const events: HostEvent[] = [];
    e.onEvent((ev) => events.push(ev));
    expect(await e.execute("account.delete", { acknowledge: true, confirm: true })).toEqual({ ok: true, result: { deleted: true } });
    expect(events).toEqual([{ type: "session.changed", state: "signed_out", storage: "memory" }]);
    expect(await e.execute("account.get")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
  });
});

describe("account writes on the eero backend", () => {
  it("answer not available yet until a live-tested source is found, without calling eero", async () => {
    const server = createFakeEero();
    const backend = createEeroBackend({ secrets: secretsWith(server.signIn()), origin: server.origin, fetch: server.fetch });
    const engine = createEngine({ backend });
    const before = server.log.length;
    for (const [id, params] of [
      ["account.name.set", { name: "Sam" }],
      ["account.email.set", { email: "sam@example.com" }],
      ["account.email.verify", { code: "123456" }],
      ["account.phone.set", { phone: "+15550100199" }],
      ["account.phone.verify", { code: "123456" }],
      ["account.consents.set", { marketingEmails: true }],
    ] as const) {
      const res = await engine.execute(id, params);
      expect(res, id).toMatchObject({ ok: false, error: { code: "eero_error" } });
      if (!res.ok) expect(res.error.message).toMatch(/not available/);
    }
    expect(server.log.slice(before).filter((l) => l.method !== "GET")).toEqual([]);
  });
});
