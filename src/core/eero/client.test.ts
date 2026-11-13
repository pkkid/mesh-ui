import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeEero, type FakeEero, fail, ok, type Route } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { BackendError } from "../errors";
import { createEeroBackend } from "./backend";
import { EeroClient, type EeroClientOptions, type RequestLogEntry } from "./client";
import { RateLimiter } from "./ratelimit";
import { asList } from "./raw";
import { checkOrigin, deviceWritePath, idFromUrl, redactPath, resolveUrl } from "./urls";

// ---------------------------------------------------------------------------
// Harness

function memorySecrets(initial: string | null = null) {
  let token = initial;
  const saves: string[] = [];
  let clears = 0;
  const store: SecretStore = {
    load: async () => token,
    save: async (t) => {
      token = t;
      saves.push(t);
      return "keychain";
    },
    clear: async () => {
      token = null;
      clears++;
    },
    storage: async () => "keychain",
  };
  return { store, saves, clears: () => clears, current: () => token };
}

/** Test-only routes: a query, a write, and a device resource that ignores /2.2/ writes like eero does. */
const testRoutes: Route[] = [
  { method: "GET", path: "/test/echo", handle: ({ req }) => ok({ query: Object.fromEntries(req.query), encoding: req.encoding }) },
  { method: "GET", path: "/test/bare", handle: () => ok([{ id: 1 }, { id: 2 }]) },
  { method: "GET", path: "/test/wrapped", handle: () => ok({ data: [{ id: 1 }] }) },
  { method: "PUT", path: "/test/write", handle: ({ req }) => ok({ encoding: req.encoding, body: req.body }) },
  { method: "POST", path: "/test/empty", handle: ({ req }) => ok({ encoding: req.encoding, raw: req.rawBody }) },
  {
    method: "PUT",
    path: "/networks/:net/devices/:mac",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      const device = net.devices.find((d) => d.mac?.replace(/:/g, "") === params.mac);
      if (!device) return fail(404, "error.device.not.found");
      if (req.version !== "2.2" && typeof req.body.paused === "boolean") device.paused = req.body.paused;
      return ok(device);
    },
  },
];

type Setup = { fake: FakeEero; client: EeroClient; secrets: ReturnType<typeof memorySecrets>; logs: RequestLogEntry[]; token: string };

function setup(opts: { signedIn?: boolean; client?: Partial<EeroClientOptions> } = {}): Setup {
  const fake = createFakeEero({ routes: testRoutes });
  const token = fake.signIn();
  const secrets = memorySecrets(opts.signedIn === false ? null : token);
  const logs: RequestLogEntry[] = [];
  const client = new EeroClient({ secrets: secrets.store, origin: fake.origin, fetch: fake.fetch, onLog: (e) => logs.push(e), ...opts.client });
  return { fake, client, secrets, logs, token };
}

const echo = (client: EeroClient) => client.request<{ query: Record<string, string> }>({ method: "GET", path: "/2.2/test/echo" });
const write = (client: EeroClient, body: Record<string, unknown> = { a: 1 }) => client.request({ method: "PUT", path: "/2.2/test/write", body });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof BackendError ? err.code : `thrown: ${String(err)}`;
  }
}

function useFakeTimers() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

// ---------------------------------------------------------------------------

describe("urls", () => {
  it("accepts only eero's origin or a loopback fake", () => {
    expect(checkOrigin("https://api-user.e2ro.com/")).toBe("https://api-user.e2ro.com");
    expect(checkOrigin("http://127.0.0.1:4321")).toBe("http://127.0.0.1:4321");
    expect(() => checkOrigin("https://evil.example")).toThrow();
    expect(() => checkOrigin("http://10.0.0.5")).toThrow();
    expect(() => checkOrigin("https://127.0.0.1")).toThrow();
  });

  it("refuses links to another host or outside the versioned API", () => {
    const origin = "https://api-user.e2ro.com";
    expect(resolveUrl("/2.2/networks/1", origin).href).toBe("https://api-user.e2ro.com/2.2/networks/1");
    expect(resolveUrl("https://api-user.e2ro.com/2.2/eeros/5", origin, "2.3").pathname).toBe("/2.3/eeros/5");
    for (const bad of ["https://evil.example/2.2/account", "//evil.example/2.2/account", "/3.0/account", "/account", "https://user:pw@api-user.e2ro.com/2.2/x"]) {
      expect(() => resolveUrl(bad, origin)).toThrow(BackendError);
    }
  });

  it("pins device writes to /2.3/ and redacts ids", () => {
    expect(deviceWritePath("100001", "0A:1B:2C:00:00:01")).toBe("/2.3/networks/100001/devices/0a1b2c000001");
    expect(idFromUrl("/2.2/networks/100001")).toBe("100001");
    expect(redactPath("/2.2/networks/100001/devices/0a1b2c000001?x=1")).toBe("/2.2/networks/:id/devices/:id");
    expect(redactPath("/2.2/eeros/FAKE00LR0001/led")).toBe("/2.2/eeros/:id/led");
  });

  it("parses lists leniently", () => {
    expect(asList([1, 2])).toEqual([1, 2]);
    expect(asList({ data: [1] })).toEqual([1]);
    expect(asList({ devices: [3] }, "devices")).toEqual([3]);
    expect(asList({ members: { data: [4] } }, "members")).toEqual([4]);
    expect(asList(null)).toEqual([]);
    expect(asList({ other: 1 })).toEqual([]);
  });
});

describe("requests", () => {
  it("sends app headers, the cookie, and no body on GET", async () => {
    const { fake, client, token } = setup();
    const res = await client.request<{ query: Record<string, string> }>({ method: "GET", path: "/2.2/test/echo", query: { start: "2026-11-05T00:00:00Z", skip: null } });
    expect(res.query).toEqual({ start: "2026-11-05T00:00:00Z" });
    const entry = fake.log[0];
    expect(entry?.headers["user-agent"]).toMatch(/^eero-ios\//);
    expect(entry?.headers.accept).toBe("application/json");
    expect(entry?.headers["x-accept-language"]).toBe("en-US");
    expect(entry?.headers.cookie).toBe(`s=${token}`);
    expect(entry?.headers["x-user-token"]).toBe(token);
    expect(entry?.body).toBe("");
    await expect(client.request({ method: "GET", path: "/2.2/test/echo", body: { a: 1 } })).rejects.toThrow(/never a body/);
  });

  it("uses a configured User-Agent", async () => {
    const { fake, client } = setup({ client: { userAgent: "eero-android/9.9.9" } });
    await echo(client);
    expect(fake.log[0]?.headers["user-agent"]).toBe("eero-android/9.9.9");
  });

  it("encodes JSON, form and empty-JSON bodies", async () => {
    const { client } = setup();
    expect(await client.request({ method: "PUT", path: "/2.2/test/write", body: { paused: true } })).toEqual({ encoding: "json", body: { paused: true } });
    expect(await client.request({ method: "PUT", path: "/2.2/test/write", body: { led_on: false, colors: ["blue", "white"] }, encoding: "form" })).toEqual({
      encoding: "form",
      body: { led_on: "false", colors: ["blue", "white"] },
    });
    expect(await client.request({ method: "POST", path: "/2.2/test/empty" })).toEqual({ encoding: "empty", raw: '""' });
  });

  it("writes devices on /2.3/; the same write on /2.2/ is ignored by the server", async () => {
    const { fake, client } = setup();
    const device = () => fake.state.networks.get("100001")?.devices.find((d) => d.nickname === "Alex's Phone");
    await client.request({ method: "PUT", path: "/2.2/networks/100001/devices/0a1b2c000001", body: { paused: true } });
    expect(device()?.paused).toBe(false);
    await client.request({ method: "PUT", path: deviceWritePath("100001", device()?.mac ?? ""), body: { paused: true } });
    expect(fake.log.at(-1)?.path).toBe("/2.3/networks/100001/devices/0a1b2c000001");
    expect(device()?.paused).toBe(true);
  });

  it("refuses a url pointing at another host before sending", async () => {
    const { fake, client, logs } = setup();
    await expect(client.request({ method: "GET", path: "https://evil.example/2.2/account" })).rejects.toMatchObject({ code: "eero_error" });
    await expect(client.request({ method: "GET", path: "https://api-user.e2ro.com/2.2/account" })).rejects.toMatchObject({ code: "eero_error" });
    expect(fake.log).toHaveLength(0);
    expect(logs.map((e) => [e.status, e.outcome])).toEqual([
      [null, "error"],
      [null, "error"],
    ]);
    expect(JSON.stringify(logs)).not.toContain("evil.example");
  });

  it("parses bare and wrapped lists", async () => {
    const { client } = setup();
    expect(asList(await client.request({ method: "GET", path: "/2.2/test/bare" }))).toHaveLength(2);
    expect(asList(await client.request({ method: "GET", path: "/2.2/test/wrapped" }))).toHaveLength(1);
  });

  it("treats a meta.code failure inside a 2xx as an error, and an empty body as null data", async () => {
    const { fake, client } = setup();
    fake.scenarios.add({ path: "/test/write" }, { replace: { status: 200, body: JSON.stringify({ meta: { code: 400, error: "error.something" }, data: null }) } });
    await expect(write(client)).rejects.toMatchObject({ code: "eero_error", detail: { status: 400, eeroError: "error.something" } });
    fake.scenarios.add({ path: "/test/write" }, { replace: { status: 204, body: "" } });
    expect(await write(client)).toBeNull();
  });

  it("needs a session for session requests and rejects retired web tokens", async () => {
    const { client, fake } = setup({ signedIn: false });
    await expect(echo(client)).rejects.toMatchObject({ code: "not_signed_in" });
    const secrets = memorySecrets("eero-web-old");
    const retired = new EeroClient({ secrets: secrets.store, origin: fake.origin, fetch: fake.fetch });
    expect((await retired.status()).signedIn).toBe(false);
    expect(secrets.clears()).toBe(1);
    expect(fake.log).toHaveLength(0);
  });
});

describe("auth", () => {
  it("signs in with two steps and keeps the pending token on a wrong code", async () => {
    const { fake, client, secrets } = setup({ signedIn: false });
    await client.startLogin("alex@example.com");
    expect(fake.log[0]?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(fake.log[0]?.body).toBe("login=alex%40example.com");
    expect(fake.log[0]?.headers.cookie).toBeUndefined();
    expect(await client.status()).toEqual({ signedIn: false, pending: true, login: "al***@example.com", storage: "keychain" });

    await expect(client.verifyLogin("000000")).rejects.toMatchObject({ code: "eero_error", detail: { eeroError: "error.code.invalid" } });
    expect((await client.status()).pending).toBe(true);

    await client.verifyLogin("123456");
    const pendingToken = fake.log[1]?.token;
    expect(fake.log[2]?.token).toBe(pendingToken);
    expect(await client.status()).toMatchObject({ signedIn: true, pending: false });
    expect(secrets.saves).toEqual([pendingToken]);
    await echo(client);
    expect(fake.log.at(-1)?.token).toBe(pendingToken);
  });

  it("rejects an empty login, and verify without a pending sign-in", async () => {
    const { client } = setup({ signedIn: false });
    await expect(client.startLogin("  ")).rejects.toMatchObject({ code: "bad_params" });
    await expect(client.verifyLogin("123456")).rejects.toMatchObject({ code: "not_signed_in" });
  });

  describe("resend", () => {
    useFakeTimers();
    it("is allowed once a minute; a second resend maps to rate_limited", async () => {
      const { client } = setup({ signedIn: false });
      await client.startLogin("+15550100142");
      expect((await client.status()).login).toBe("***0142");
      await client.resendLogin();
      await expect(client.resendLogin()).rejects.toMatchObject({ code: "rate_limited", detail: { retryAfterSec: 60 } });
      vi.advanceTimersByTime(61_000);
      await client.resendLogin();
      expect((await client.status()).pending).toBe(true);
    });
  });

  it("signs out locally first, even when eero's logout fails", async () => {
    const changes: boolean[] = [];
    const { fake, client, secrets, token } = setup({ client: { onSessionChange: (s) => changes.push(s) } });
    fake.scenarios.fail(500, undefined, { path: "/logout" });
    await client.logout();
    expect(secrets.current()).toBeNull();
    expect((await client.status()).signedIn).toBe(false);
    expect(fake.log.at(-1)?.token).toBe(token);
    expect(changes).toEqual([false]);
    await client.logout();
    expect(fake.log.filter((e) => e.path === "/2.2/logout")).toHaveLength(1);
  });
});

describe("session refresh", () => {
  it("refreshes once on error.session.refresh, replays, and saves the new token", async () => {
    const { fake, client, secrets, token } = setup();
    fake.scenarios.sessionRefresh();
    const res = await echo(client);
    expect(res.query).toEqual({});
    const paths = fake.log.map((e) => `${e.method} ${e.path} ${e.status}`);
    expect(paths).toEqual(["GET /2.2/test/echo 401", "POST /2.2/login/refresh 200", "GET /2.2/test/echo 200"]);
    expect(fake.log[1]?.token).toBe(token);
    expect(fake.log[1]?.body).toBe('""');
    const fresh = fake.log[2]?.token;
    expect(fresh).not.toBe(token);
    expect(secrets.saves).toEqual([fresh]);
  });

  it("replays a write once after a refresh", async () => {
    const { fake, client } = setup();
    fake.scenarios.sessionRefresh();
    await write(client);
    expect(fake.log.filter((e) => e.path === "/2.2/test/write").map((e) => e.status)).toEqual([401, 200]);
  });

  it("gives not_signed_in and clears the session when the refresh fails", async () => {
    const changes: boolean[] = [];
    const { fake, client, secrets } = setup({ client: { onSessionChange: (s) => changes.push(s) } });
    fake.scenarios.sessionRefresh().refreshFails();
    await expect(echo(client)).rejects.toMatchObject({ code: "not_signed_in" });
    expect(secrets.current()).toBeNull();
    expect((await client.status()).signedIn).toBe(false);
    expect(changes).toEqual([false]);
    expect(fake.log.filter((e) => e.path === "/2.2/test/echo")).toHaveLength(1);
  });

  it("does not loop when the replay is refused again", async () => {
    const { fake, client } = setup();
    fake.scenarios.sessionRefresh(2);
    await expect(echo(client)).rejects.toMatchObject({ code: "not_signed_in" });
    expect(fake.log.filter((e) => e.path === "/2.2/login/refresh")).toHaveLength(1);
    expect(fake.log.filter((e) => e.path === "/2.2/test/echo")).toHaveLength(2);
  });

  it("shares one refresh between concurrent 401s", async () => {
    const { fake, client } = setup();
    fake.scenarios.sessionRefresh(4);
    await Promise.all([echo(client), echo(client), echo(client), echo(client)]);
    expect(fake.log.filter((e) => e.path === "/2.2/login/refresh")).toHaveLength(1);
    expect(fake.log.filter((e) => e.path === "/2.2/test/echo" && e.status === 200)).toHaveLength(4);
  });

  it("maps dead-session codes to not_signed_in and clears the store", async () => {
    for (const error of ["error.session.expired", "error.session.revoked"]) {
      const { fake, client, secrets } = setup();
      fake.scenarios.fail(401, error);
      await expect(echo(client)).rejects.toMatchObject({ code: "not_signed_in" });
      expect(secrets.current()).toBeNull();
      expect(fake.log.filter((e) => e.path === "/2.2/login/refresh")).toHaveLength(0);
    }
  });
});

describe("token rotation", () => {
  it("adopts a Set-Cookie s= token from a normal response and saves it", async () => {
    const { fake, client, secrets, token } = setup();
    fake.scenarios.rotateToken();
    await echo(client);
    await echo(client);
    const rotated = fake.log[1]?.token;
    expect(fake.log[0]?.token).toBe(token);
    expect(rotated).not.toBe(token);
    expect(rotated).toMatch(/^fake-session-/);
    expect(secrets.saves).toEqual([rotated]);
  });
});

describe("rate limits", () => {
  useFakeTimers();

  it("retries a query after Retry-After", async () => {
    const { fake, client } = setup();
    fake.scenarios.rateLimit({ retryAfter: 2 });
    let done = false;
    const p = echo(client).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1_900);
    expect(done).toBe(false);
    expect(fake.log).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(fake.log.map((e) => e.status)).toEqual([429, 200]);
  });

  it("accepts Retry-After as an HTTP date", async () => {
    const { fake, client } = setup();
    fake.scenarios.rateLimit({ retryAfter: new Date(Date.now() + 3_000).toUTCString() });
    const p = echo(client);
    await vi.advanceTimersByTimeAsync(3_100);
    await p;
    expect(fake.log.map((e) => e.status)).toEqual([429, 200]);
  });

  it("does not retry a write on 429", async () => {
    const { fake, client } = setup();
    fake.scenarios.rateLimit({ retryAfter: 5 });
    await expect(write(client)).rejects.toMatchObject({ code: "rate_limited", detail: { retryAfterSec: 5 } });
    expect(fake.log).toHaveLength(1);
  });

  it("fails fast with rate_limited when the wait is over 20 s", async () => {
    const { fake, client } = setup();
    fake.scenarios.rateLimit();
    await expect(echo(client)).rejects.toMatchObject({ code: "rate_limited", detail: { retryAfterSec: 30 } });
    await expect(echo(client)).rejects.toMatchObject({ code: "rate_limited" });
    expect(fake.log).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await echo(client);
    expect(fake.log).toHaveLength(2);
  });

  it("lets no more than 80 of 120 queued requests through per minute, 4 at a time", async () => {
    const { fake, client } = setup();
    fake.scenarios.delay(100, {});
    const all = Promise.all(Array.from({ length: 120 }, () => echo(client)));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fake.log).toHaveLength(80);
    expect(fake.stats.maxInFlight).toBe(4);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await all;
    expect(fake.log).toHaveLength(120);
    expect(fake.stats.maxInFlight).toBe(4);
    const firstMinute = fake.log.filter((e) => e.at < (fake.log[0]?.at ?? 0) + 60_000);
    expect(firstMinute.length).toBeLessThanOrEqual(80);
  });

  it("serialises writes in order", async () => {
    const { fake, client } = setup();
    fake.scenarios.delay(500, { path: "/test/write" });
    const writes = Promise.all([write(client, { n: 1 }), write(client, { n: 2 }), write(client, { n: 3 })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.stats.inFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await writes;
    expect(fake.stats.maxInFlight).toBe(1);
    expect(fake.log.map((e) => JSON.parse(e.body).n)).toEqual([1, 2, 3]);
  });

  it("shares one budget between clients given the same limiter", async () => {
    const limiter = new RateLimiter({ perWindow: 2 });
    const a = setup({ client: { limiter } });
    const b = setup({ client: { limiter } });
    const p = Promise.all([echo(a.client), echo(b.client), echo(a.client)]);
    await vi.advanceTimersByTimeAsync(10);
    expect(a.fake.log.length + b.fake.log.length).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    await p;
  });
});

describe("errors", () => {
  useFakeTimers();

  it("maps 403, 404, error.eero.offline, version blocked and 5xx", async () => {
    const { fake, client } = setup();
    const cases: [number, string | undefined, string, RegExp][] = [
      [403, undefined, "eero_error", /role/],
      [404, undefined, "eero_error", /isn't available/],
      [400, "error.eero.offline", "eero_error", /offline/],
      [400, "error.eero.not.capable", "eero_error", /isn't available/],
      [400, "error.reservation.ip.invalid", "bad_params", /rejected/],
      [402, "error.premium.required", "eero_error", /eero Plus/],
      [400, "error.app.version.blocked", "eero_error", /User-Agent/],
      [503, "error.server", "eero_error", /503/],
    ];
    for (const [status, error, code, message] of cases) {
      fake.scenarios.fail(status, error);
      const err = await write(client).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BackendError);
      expect(err).toMatchObject({ code, detail: { status } });
      expect((err as BackendError).message).toMatch(message);
    }
  });

  it("retries a query on 5xx with 1 s and 4 s backoff, at most twice", async () => {
    const { fake, client } = setup();
    fake.scenarios.fail(502, undefined, { path: "/test/echo" }, 3);
    const p = codeOf(echo(client));
    await vi.advanceTimersByTimeAsync(999);
    expect(fake.log).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.log).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await p).toBe("eero_error");
    expect(fake.log).toHaveLength(3);
  });

  it("times out after 30 s as network_error and does not retry writes", async () => {
    const { fake, client } = setup();
    fake.scenarios.hang({ path: "/test/write" });
    const p = codeOf(write(client));
    await vi.advanceTimersByTimeAsync(29_999);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("network_error");
    expect(fake.log).toHaveLength(1);
  });

  it("retries a query that timed out", async () => {
    const { fake, client } = setup();
    fake.scenarios.hang({ path: "/test/echo" });
    const p = echo(client);
    await vi.advanceTimersByTimeAsync(31_000);
    await p;
    expect(fake.log).toHaveLength(2);
  });
});

describe("over real HTTP", () => {
  let fake: FakeEero;
  afterEach(async () => {
    await fake?.close();
  });

  it("signs in and reads through a socket on a random port", async () => {
    fake = createFakeEero({ routes: testRoutes });
    const origin = await fake.listen();
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const secrets = memorySecrets();
    const client = new EeroClient({ secrets: secrets.store, origin });
    await client.startLogin("alex@example.com");
    await client.verifyLogin("123456");
    fake.scenarios.rotateToken();
    expect((await echo(client)).query).toEqual({});
    expect(secrets.saves).toHaveLength(2);
    expect(fake.log.at(-1)?.headers.cookie).toMatch(/^s=fake-pending-/);
  });

  it("maps connection refused to network_error", async () => {
    fake = createFakeEero();
    const origin = await fake.listen();
    await fake.close();
    const client = new EeroClient({ secrets: memorySecrets("t").store, origin });
    expect(await codeOf(write(client))).toBe("network_error");
  });
});

describe("logs and errors never leak the session", () => {
  it("keeps the token and passwords out of every log entry and message", async () => {
    const { fake, client, logs, token } = setup({ signedIn: false });
    const messages: string[] = [];
    const collect = (p: Promise<unknown>) => p.catch((e: unknown) => messages.push(e instanceof Error ? e.message : String(e)));

    await client.startLogin("alex@example.com");
    await collect(client.verifyLogin("999999"));
    await client.verifyLogin("123456");
    const tokens = new Set([token, ...fake.log.map((e) => e.token).filter((t): t is string => !!t)]);
    fake.scenarios.sessionRefresh();
    await echo(client);
    fake.scenarios.rotateToken();
    await echo(client);
    await client.request({ method: "PUT", path: "/2.2/test/write", body: { password: "hunter2-secret" }, encoding: "form" });
    fake.scenarios.fail(400, "error.password.invalid");
    await collect(client.request({ method: "PUT", path: "/2.2/test/write", body: { password: "hunter2-secret" } }));
    fake.scenarios.fail(500, undefined);
    await collect(write(client));
    for (const e of fake.log) if (e.token) tokens.add(e.token);

    expect(logs.length).toBeGreaterThan(8);
    expect(messages.length).toBe(3);
    const text = JSON.stringify(logs) + JSON.stringify(messages) + JSON.stringify(await client.status());
    for (const t of tokens) expect(text).not.toContain(t);
    expect(text).not.toContain("hunter2");
    expect(text).not.toMatch(/cookie|s=/i);
  });
});

describe("eero backend", () => {
  it("gives every area the shared client", () => {
    const fake = createFakeEero();
    const backend = createEeroBackend({ secrets: memorySecrets().store, origin: fake.origin, fetch: fake.fetch });
    expect(backend.kind).toBe("eero");
  });
});
