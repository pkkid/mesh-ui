import { describe, expect, it } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { createEngine } from "../engine";
import type { AuthStatus, HostEvent } from "../model";
import { normaliseLogin, RESEND_INTERVAL_MS } from "./auth";

function demo(scenario: "default" | "signed_out" = "signed_out") {
  let now = Date.parse("2026-11-12T18:00:00Z");
  const engine = createEngine({ backend: createDemoBackend({ scenario, clock: () => now }), clock: () => now });
  const events: HostEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return { engine, events, advance: (ms: number) => (now += ms) };
}

function memorySecrets() {
  let token: string | null = null;
  const store: SecretStore = {
    load: async () => token,
    save: async (t) => {
      token = t;
      return "keychain";
    },
    clear: async () => {
      token = null;
    },
    storage: async () => "keychain",
  };
  return { store, current: () => token };
}

function fake() {
  const server = createFakeEero();
  const secrets = memorySecrets();
  const backend = createEeroBackend({ secrets: secrets.store, origin: server.origin, fetch: server.fetch });
  let now = Date.now();
  const engine = createEngine({ backend, clock: () => now });
  const events: HostEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return { server, secrets, engine, events, advance: (ms: number) => (now += ms) };
}

describe("normaliseLogin", () => {
  it("keeps emails and turns phone numbers into E.164", () => {
    expect(normaliseLogin("  alex@example.com ")).toBe("alex@example.com");
    expect(normaliseLogin("+1 (555) 010-0142")).toBe("+15550100142");
    expect(normaliseLogin("0044 20 7946 0000")).toBe("+442079460000");
  });

  it("refuses bad emails and numbers without a country code", () => {
    expect(() => normaliseLogin("alex@")).toThrow(/email/);
    expect(() => normaliseLogin("555 010 0142")).toThrow(/country code/);
    expect(() => normaliseLogin("hello")).toThrow();
  });
});

describe("auth commands on demo", () => {
  it("auth.status reports the session without a token", async () => {
    const { engine } = demo("default");
    const res = await engine.execute<AuthStatus>("auth.status");
    expect(res).toEqual({ ok: true, result: { signedIn: true, pending: false, login: expect.any(String), storage: "memory", backend: "demo" } });
    expect(await engine.execute("auth.status", { extra: 1 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("signs in with start and verify, and emits session.changed", async () => {
    const { engine, events } = demo();
    expect(await engine.execute("account.get")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });

    const started = await engine.execute<AuthStatus>("auth.login.start", { login: "alex@example.com" });
    expect(started).toMatchObject({ ok: true, result: { signedIn: false, pending: true, login: "al***@example.com" } });

    const verified = await engine.execute<AuthStatus>("auth.login.verify", { code: "123456" });
    expect(verified).toMatchObject({ ok: true, result: { signedIn: true, pending: false, backend: "demo" } });
    expect(events).toContainEqual({ type: "session.changed", state: "signed_in", storage: "memory" });
    expect(await engine.execute("account.get")).toMatchObject({ ok: true });
  });

  it("auth.login.start rejects bad params", async () => {
    const { engine } = demo();
    for (const params of [{}, { login: "" }, { login: "  " }, { login: "alex@" }, { login: "5550100142" }, { login: 5 }, { login: "a@b.co", extra: 1 }]) {
      expect(await engine.execute("auth.login.start", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
    expect(await engine.execute("auth.status")).toMatchObject({ ok: true, result: { pending: false } });
  });

  it("accepts phone numbers and normalises them", async () => {
    const { engine } = demo();
    expect(await engine.execute("auth.login.start", { login: "+1 555-010-0142" })).toMatchObject({ ok: true, result: { pending: true, login: "+1******42" } });
  });

  it("auth.login.verify needs a pending sign-in and a 4 to 10 digit code", async () => {
    const { engine } = demo();
    expect(await engine.execute("auth.login.verify", { code: "123456" })).toMatchObject({ ok: false, error: { code: "bad_params", message: /auth.login.start/ } });
    await engine.execute("auth.login.start", { login: "alex@example.com" });
    for (const code of ["", "12", "12345678901", "12a456"]) {
      expect(await engine.execute("auth.login.verify", { code })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
    expect(await engine.execute("auth.login.verify", {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("a wrong code keeps the sign-in pending", async () => {
    const { engine, events } = demo();
    await engine.execute("auth.login.start", { login: "alex@example.com" });
    expect(await engine.execute("auth.login.verify", { code: "111111" })).toMatchObject({ ok: false, error: { code: "eero_error" } });
    expect(await engine.execute("auth.status")).toMatchObject({ ok: true, result: { signedIn: false, pending: true } });
    expect(events).toEqual([]);
    expect(await engine.execute("auth.login.verify", { code: "123456" })).toMatchObject({ ok: true, result: { signedIn: true } });
  });

  it("auth.login.resend waits 60 s after the last code", async () => {
    const { engine, advance } = demo();
    expect(await engine.execute("auth.login.resend")).toMatchObject({ ok: false, error: { code: "bad_params" } });
    await engine.execute("auth.login.start", { login: "alex@example.com" });
    advance(18_000);
    expect(await engine.execute("auth.login.resend")).toEqual({
      ok: false,
      error: { code: "rate_limited", message: "A new code can be sent in 42 s.", detail: { retryAfterSec: 42 } },
    });
    advance(RESEND_INTERVAL_MS);
    expect(await engine.execute("auth.login.resend")).toMatchObject({ ok: true, result: { pending: true } });
    expect(await engine.execute("auth.login.resend")).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(await engine.execute("auth.login.resend", { extra: 1 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("auth.logout signs out, drops cached data and emits session.changed", async () => {
    const { engine, events } = demo("default");
    expect(await engine.execute("account.get")).toMatchObject({ ok: true });
    expect(await engine.execute("auth.logout")).toMatchObject({ ok: true, result: { signedIn: false, pending: false, login: null } });
    expect(events).toEqual([{ type: "session.changed", state: "signed_out", storage: "memory" }]);
    // Cached account data must not outlive the session.
    expect(await engine.execute("account.get")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    expect(await engine.execute("auth.logout", { extra: 1 })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("no auth command needs confirm", () => {
    const { engine } = demo();
    const auth = engine.commands().filter((c) => c.id.startsWith("auth."));
    expect(auth.map((c) => c.id).sort()).toEqual(["auth.login.resend", "auth.login.start", "auth.login.verify", "auth.logout", "auth.status"]);
    for (const c of auth) {
      expect(c.scope).toBe("account");
      expect(["query", "write"]).toContain(c.effect);
      expect(JSON.stringify(c.params)).not.toContain("networkId");
    }
  });
});

describe("auth commands on the fake eero server", () => {
  it("signs in end to end, saves the session and never returns the token", async () => {
    const { server, secrets, engine, events } = fake();
    expect(await engine.execute("auth.status")).toEqual({
      ok: true,
      result: { signedIn: false, pending: false, login: null, storage: "keychain", backend: "eero" },
    });
    const started = await engine.execute("auth.login.start", { login: "alex@example.com" });
    expect(started).toMatchObject({ ok: true, result: { pending: true, login: "al***@example.com" } });

    const wrong = await engine.execute("auth.login.verify", { code: "654321" });
    expect(wrong).toMatchObject({ ok: false, error: { code: "eero_error", detail: { eeroError: "error.code.invalid" } } });
    expect(await engine.execute("auth.status")).toMatchObject({ ok: true, result: { pending: true, signedIn: false } });

    const verified = await engine.execute("auth.login.verify", { code: "123456" });
    expect(verified).toMatchObject({ ok: true, result: { signedIn: true, storage: "keychain", backend: "eero" } });
    expect(events).toEqual([{ type: "session.changed", state: "signed_in", storage: "keychain" }]);

    const token = secrets.current();
    expect(token).toBeTruthy();
    expect(server.state.sessions.get(token ?? "")?.kind).toBe("session");
    for (const r of [started, wrong, verified]) expect(JSON.stringify(r)).not.toContain(token);

    const verifyReq = server.log.filter((l) => l.path === "/2.2/login/verify").at(-1);
    expect(verifyReq?.body).toBe("code=123456");
  });

  it("sends the phone number to eero in E.164", async () => {
    const { server, engine } = fake();
    await engine.execute("auth.login.start", { login: "+1 (555) 010-0142" });
    expect(server.log.find((l) => l.path === "/2.2/login")?.body).toBe("login=%2B15550100142");
  });

  it("resend goes to eero after 60 s, and eero's own limit maps to rate_limited", async () => {
    const { server, engine, advance } = fake();
    await engine.execute("auth.login.start", { login: "alex@example.com" });
    expect(await engine.execute("auth.login.resend")).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(server.log.some((l) => l.path === "/2.2/login/resend")).toBe(false);
    advance(RESEND_INTERVAL_MS);
    expect(await engine.execute("auth.login.resend")).toMatchObject({ ok: true });
    expect(server.log.filter((l) => l.path === "/2.2/login/resend")).toHaveLength(1);

    server.scenarios.fail(429, "error.too.many.resends", { path: "/login/resend" });
    advance(RESEND_INTERVAL_MS);
    expect(await engine.execute("auth.login.resend")).toMatchObject({ ok: false, error: { code: "rate_limited", detail: { retryAfterSec: 60 } } });
  });

  it("logout clears the saved session and tells eero", async () => {
    const { server, secrets, engine, events } = fake();
    await engine.execute("auth.login.start", { login: "alex@example.com" });
    await engine.execute("auth.login.verify", { code: "123456" });
    const token = secrets.current() ?? "";
    expect(await engine.execute("auth.logout")).toMatchObject({ ok: true, result: { signedIn: false } });
    expect(secrets.current()).toBeNull();
    expect(server.state.sessions.has(token)).toBe(false);
    expect(server.log.at(-1)?.path).toBe("/2.2/logout");
    expect(events.at(-1)).toEqual({ type: "session.changed", state: "signed_out", storage: "keychain" });
  });

  it("logout still signs out locally when eero cannot be reached", async () => {
    const { server, secrets, engine } = fake();
    await engine.execute("auth.login.start", { login: "alex@example.com" });
    await engine.execute("auth.login.verify", { code: "123456" });
    server.scenarios.fail(503, undefined, { path: "/logout" });
    expect(await engine.execute("auth.logout")).toMatchObject({ ok: true, result: { signedIn: false } });
    expect(secrets.current()).toBeNull();
  });

  it("start maps a refused login to bad_params", async () => {
    const { server, engine } = fake();
    server.scenarios.fail(400, "error.login.invalid", { path: "/login" });
    expect(await engine.execute("auth.login.start", { login: "nobody@example.com" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});
