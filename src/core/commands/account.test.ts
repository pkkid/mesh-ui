import { describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { renderTable } from "../../cli/format";
import type { AuditEntry, AuditLog } from "../audit";
import type { SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import type { RequestLogEntry } from "../eero/client";
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
        marketingEmails: false,
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
    // consents is unverified on a real account: only a bool maps.
    expect(mapAccount({ consents: { marketing_emails: true } }).marketingEmails).toBe(true);
    expect(mapAccount({ consents: { marketing_emails: "yes" as unknown as boolean } }).marketingEmails).toBeNull();
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

  it("refuses a network whose role is unknown, since it may be owned", async () => {
    const backend = createDemoBackend({ scenario: "no_networks" });
    const unknown = { id: "1", name: "Elm Road", nickname: null, role: null, status: "online", eeroCount: 1, devicesOnline: 0, isp: null, updateAvailable: false, lastSeen: null, selected: false } as const;
    backend.network.list = async () => [unknown];
    const res = await createEngine({ backend }).execute("account.delete", { acknowledge: true, confirm: true });
    expect(res).toMatchObject({ ok: false, error: { code: "bad_params" } });
    if (!res.ok) expect(res.error.message).toMatch(/may own a network \(Elm Road\)/);
    expect(await backend.account.get()).toMatchObject({ networkCount: 0 });
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

describe("account writes against the fake eero server", () => {
  const setup = (opts: { audit?: AuditEntry[]; log?: RequestLogEntry[] } = {}) => {
    const server = createFakeEero();
    const backend = createEeroBackend({ secrets: secretsWith(server.signIn()), origin: server.origin, fetch: server.fetch, onLog: (e) => opts.log?.push(e) });
    const audit: AuditLog | undefined = opts.audit ? { append: async (e) => void opts.audit?.push(e) } : undefined;
    const engine = createEngine({ backend, surface: "cli", ...(audit ? { audit } : {}) });
    const lastWrite = () => server.writes.at(-1);
    return { server, engine, lastWrite };
  };

  it("account.name.set sends PUT /2.2/account/name as a form and reads the account again", async () => {
    const { server, engine, lastWrite } = setup();
    await engine.execute("account.get");
    expect(await engine.execute("account.name.set", { name: " Sam Lee " })).toMatchObject({ ok: true, result: { name: "Sam Lee" } });
    expect(server.writes).toHaveLength(1);
    expect(lastWrite()).toMatchObject({ method: "PUT", version: "2.2", route: "/account/name", encoding: "form", body: { name: "Sam Lee" } });
    // The write invalidated the cached account: the next read shows the change.
    expect(await engine.execute("account.get")).toMatchObject({ ok: true, result: { name: "Sam Lee" } });
    for (const params of [{ name: "" }, { name: "x".repeat(65) }]) expect(await engine.execute("account.name.set", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(server.writes).toHaveLength(1);
  });

  it("account.email.set stays pending until the right code; a wrong code keeps it pending and the session alive", async () => {
    const { server, engine, lastWrite } = setup();
    expect(await engine.execute("account.email.set", { email: "sam@example.com" })).toMatchObject({ ok: true, result: { email: { value: "sam@example.com", verified: false } } });
    expect(lastWrite()).toMatchObject({ method: "PUT", version: "2.2", route: "/account/email", encoding: "form", body: { email: "sam@example.com" } });

    const wrong = await engine.execute("account.email.verify", { code: "111111" });
    expect(wrong).toMatchObject({ ok: false, error: { code: "eero_error" } });
    if (!wrong.ok) expect(wrong.error.message).toMatch(/code is not right/);
    expect(lastWrite()).toMatchObject({ method: "POST", version: "2.2", route: "/account/email/verify", encoding: "form", body: { code: "111111" } });
    expect(await engine.execute("account.get", {}, { fresh: true })).toMatchObject({ ok: true, result: { email: { value: "sam@example.com", verified: false } } });

    expect(await engine.execute("account.email.verify", { code: "123456" })).toMatchObject({ ok: true, result: { email: { value: "sam@example.com", verified: true } } });
    const writes = server.writes.length;
    for (const params of [{ email: "not-an-email" }]) expect(await engine.execute("account.email.set", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    for (const params of [{ code: "12345" }, { code: "12345a" }, { code: "1234567" }]) expect(await engine.execute("account.email.verify", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(server.writes).toHaveLength(writes);
  });

  it("account.phone.set takes E.164 only and account.phone.verify sends the code as a form", async () => {
    const { server, engine, lastWrite } = setup();
    expect(await engine.execute("account.phone.set", { phone: "+15550100199" })).toMatchObject({ ok: true, result: { phone: { value: "+15550100199", verified: false } } });
    expect(lastWrite()).toMatchObject({ method: "PUT", version: "2.2", route: "/account/phone", encoding: "form", body: { phone: "+15550100199" } });
    expect(await engine.execute("account.phone.verify", { code: "000000" })).toMatchObject({ ok: false, error: { code: "eero_error" } });
    expect(await engine.execute("account.phone.verify", { code: "123456" })).toMatchObject({ ok: true, result: { phone: { verified: true } } });
    expect(lastWrite()).toMatchObject({ method: "POST", version: "2.2", route: "/account/phone/verify", encoding: "form", body: { code: "123456" } });
    const writes = server.writes.length;
    for (const phone of ["5550100199", "+1 555 010 0199", "+0555010019"]) expect(await engine.execute("account.phone.set", { phone })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(server.writes).toHaveLength(writes);
  });

  it("account.consents.set sends marketing_emails as a form bool", async () => {
    const { engine, lastWrite } = setup();
    expect(await engine.execute("account.get")).toMatchObject({ ok: true, result: { marketingEmails: false } });
    expect(await engine.execute("account.consents.set", { marketingEmails: true })).toMatchObject({ ok: true, result: { marketingEmails: true } });
    expect(lastWrite()).toMatchObject({ method: "PUT", version: "2.2", route: "/account/consents", encoding: "form", body: { marketing_emails: "true" } });
  });

  it("account.push.set sends both keys as JSON, the one not given from the account", async () => {
    const { engine, lastWrite } = setup();
    expect(await engine.execute("account.push.set", { nodeOffline: false })).toMatchObject({ ok: true, result: { push: { networkOffline: true, nodeOffline: false } } });
    expect(lastWrite()).toMatchObject({ method: "PUT", version: "2.2", route: "/account/push_settings", encoding: "json", body: { networkOffline: true, nodeOffline: false } });
    expect(await engine.execute("account.push.set", { networkOffline: false })).toMatchObject({ ok: true, result: { push: { networkOffline: false, nodeOffline: false } } });
    expect(lastWrite()?.body).toEqual({ networkOffline: false, nodeOffline: false });
    // The push choices also show in the notification settings.
    expect(await engine.execute("notifications.settings.get", { networkId: "100001" })).toMatchObject({ ok: true, result: { push: { networkOffline: false, nodeOffline: false } } });
  });

  it("account.delete needs acknowledge and confirm, refuses owned networks, then sends DELETE /2.2/account and signs out", async () => {
    const { server, engine, lastWrite } = setup();
    const events: HostEvent[] = [];
    engine.onEvent((e) => events.push(e));
    expect(await engine.execute("account.delete", { acknowledge: true, confirm: true })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    // Leave the account with no networks (transferred or deleted first).
    server.state.networks.clear();
    server.state.account.networks = { count: 0, data: [] };
    const fresh = createEngine({ backend: createEeroBackend({ secrets: secretsWith([...server.state.sessions.keys()][0] ?? null), origin: server.origin, fetch: server.fetch }) });
    fresh.onEvent((e) => events.push(e));
    expect(await fresh.execute("account.delete", {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await fresh.execute("account.delete", { acknowledge: true })).toMatchObject({ ok: false, error: { code: "needs_confirm" } });
    expect(server.writes.filter((w) => w.method === "DELETE")).toEqual([]);
    expect(await fresh.execute("account.delete", { acknowledge: true, confirm: true })).toEqual({ ok: true, result: { deleted: true } });
    expect(server.writes.find((w) => w.method === "DELETE")).toMatchObject({ method: "DELETE", version: "2.2", route: "/account" });
    expect(lastWrite()?.route).not.toBe("/account/name");
    expect(events.at(-1)).toMatchObject({ type: "session.changed", state: "signed_out" });
    expect(await fresh.execute("account.get")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
  });

  it("a verification code never reaches the CLI table, the audit log or the request log", async () => {
    const audit: AuditEntry[] = [];
    const log: RequestLogEntry[] = [];
    const { engine } = setup({ audit, log });
    await engine.execute("account.email.set", { email: "sam@example.com" });
    const bad = await engine.execute("account.email.verify", { code: "987654" });
    const good = await engine.execute("account.email.verify", { code: "123456" });
    expect(good.ok).toBe(true);
    const table = good.ok ? renderTable(good.result, { color: false }, Date.now()) : "";
    expect(table).toContain("sam@example.com");
    const seen = JSON.stringify({ table, bad, audit, log });
    expect(seen).not.toContain("123456");
    expect(seen).not.toContain("987654");
    expect(audit.filter((e) => e.id === "account.email.verify")).toHaveLength(2);
  });
});

describe("account writes on the live eero backend", () => {
  it("answer not available yet until a live-tested source is found, without calling eero", async () => {
    const calls: string[] = [];
    const noEero: typeof fetch = async (input) => {
      calls.push(String(input));
      throw new Error("must not call eero");
    };
    // No injected origin: the live eero client. Tests never reach eero, so fetch refuses.
    const backend = createEeroBackend({ secrets: secretsWith("live-token"), fetch: noEero });
    const engine = createEngine({ backend });
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
    await expect(backend.account.setPush({ networkOffline: true, nodeOffline: true })).rejects.toThrow(/not available/);
    await expect(backend.account.remove()).rejects.toThrow(/not available/);
    expect(calls).toEqual([]);
  });
});
