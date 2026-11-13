import { describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { createEngine } from "../engine";
import type { AppInfo, HostEvent } from "../model";

const host = { version: "9.9.9", electron: "45.0.0", configDir: "/tmp/mesh-ui-test", keychainName: "Test Keychain" };

describe("app.info", () => {
  it("reports the host, the backend and the session storage", async () => {
    const engine = createEngine({ backend: createDemoBackend(), host });
    const res = await engine.execute<AppInfo>("app.info");
    expect(res).toEqual({
      ok: true,
      result: {
        version: "9.9.9",
        electron: "45.0.0",
        os: process.platform,
        arch: process.arch,
        backend: "demo",
        fakeServer: false,
        sessionStorage: "memory",
        keychainName: null,
        update: null,
        configDir: "/tmp/mesh-ui-test",
      },
    });
  });

  it("works signed out and rejects params", async () => {
    const engine = createEngine({ backend: createDemoBackend({ scenario: "signed_out" }) });
    expect(await engine.execute("app.info")).toMatchObject({ ok: true, result: { backend: "demo", configDir: "" } });
    expect(await engine.execute("app.info", { verbose: true })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("app.info", { networkId: "x" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("names the keychain when the eero session is kept there", async () => {
    const server = createFakeEero();
    const secrets: SecretStore = { load: async () => null, save: async () => "keychain", clear: async () => {}, storage: async () => "keychain" };
    const engine = createEngine({ backend: createEeroBackend({ secrets, origin: server.origin, fetch: server.fetch }), host });
    expect(await engine.execute("app.info")).toMatchObject({ ok: true, result: { backend: "eero", fakeServer: true, sessionStorage: "keychain", keychainName: "Test Keychain" } });
    expect(server.log).toHaveLength(0);
  });

  it("reports fakeServer false for the live eero backend", async () => {
    const secrets: SecretStore = { load: async () => null, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
    const engine = createEngine({ backend: createEeroBackend({ secrets }), host });
    expect(await engine.execute("app.info")).toMatchObject({ ok: true, result: { backend: "eero", fakeServer: false } });
  });
});

describe("demo.scenario.set", () => {
  it("switches scenarios and emits session.changed when the session flips", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    const events: HostEvent[] = [];
    engine.onEvent((e) => events.push(e));
    expect(await engine.execute("account.get")).toMatchObject({ ok: true, result: { networkCount: 3 } });

    expect(await engine.execute("demo.scenario.set", { scenario: "no_networks" })).toMatchObject({ ok: true, result: { scenario: "no_networks", signedIn: true } });
    // The cached account is dropped, so the new fixtures show.
    expect(await engine.execute("account.get")).toMatchObject({ ok: true, result: { networkCount: 0 } });
    expect(events).toEqual([]);

    expect(await engine.execute("demo.scenario.set", { scenario: "signed_out" })).toMatchObject({ ok: true, result: { signedIn: false } });
    expect(events).toEqual([{ type: "session.changed", state: "signed_out", storage: "memory" }]);
    expect(await engine.execute("account.get")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });

    // App scope: it runs while signed out, so tests can get back.
    expect(await engine.execute("demo.scenario.set", { scenario: "default" })).toMatchObject({ ok: true, result: { signedIn: true } });
    expect(events.at(-1)).toEqual({ type: "session.changed", state: "signed_in", storage: "memory" });
  });

  it("rejects unknown scenarios and missing params", async () => {
    const engine = createEngine({ backend: createDemoBackend() });
    for (const params of [{}, { scenario: "nope" }, { scenario: 1 }, { scenario: "default", extra: 1 }]) {
      expect(await engine.execute("demo.scenario.set", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });

  it("is registered only with the demo backend", () => {
    const secrets: SecretStore = { load: async () => null, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
    const live = createEngine({ backend: createEeroBackend({ secrets, origin: "http://127.0.0.1:1" }) });
    expect(live.commands().some((c) => c.id === "demo.scenario.set")).toBe(false);
    expect(createEngine({ backend: createDemoBackend() }).commands().some((c) => c.id === "demo.scenario.set")).toBe(true);
  });
});
