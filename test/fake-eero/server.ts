/**
 * The fake eero server: answers like api-user.e2ro.com from in-memory state
 * so the real EeroClient and EeroBackend can be tested without eero. See
 * docs/testing.md#fake-eero-server.
 *
 *   const fake = createFakeEero();
 *   const client = new EeroClient({ secrets, origin: fake.origin, fetch: fake.fetch }); // in-process
 *   const origin = await fake.listen();                                               // or a real port
 *
 * Routes come from ./routes (one file per area, registered in routes/index.ts).
 * Paths in a route omit the version prefix: "/networks/:net/devices" answers
 * /2.2/, /2.3/ and /2.4/ unless `versions` says otherwise. Each route gets the
 * parsed request, its path params, the state and the caller's session.
 *
 * Writes (PUT, POST, DELETE) are parsed like reads (form, JSON or the
 * empty-JSON `""` body) and also recorded in `fake.writes`, so a test can
 * assert the exact request a write sent:
 *
 *   expect(fake.writes.at(-1)).toMatchObject({ method: "PUT", version: "2.3", route: "/networks/1/devices/0a1b2c000001", encoding: "json", body: { paused: true } });
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import * as areas from "./routes";
import { type Method, Scenarios } from "./scenarios";
import { addSession, createState, type FakeNetwork, type FakeSession, type FakeState, type StateOptions } from "./state";

export type ApiVersion = "2.2" | "2.3" | "2.4";

export type FakeRequest = {
  method: Method;
  /** Full path including the version, e.g. "/2.2/networks/100001". */
  path: string;
  version: ApiVersion;
  /** Path without the version, e.g. "/networks/100001". */
  route: string;
  query: URLSearchParams;
  /** Lower-case names. */
  headers: Record<string, string>;
  rawBody: string;
  /** JSON object, form fields, or {} for empty and `""` bodies. */
  body: Record<string, unknown>;
  /** "json" | "form" | "empty" | "none", from Content-Type and body. */
  encoding: "json" | "form" | "empty" | "none";
  /** Value of the `s` cookie (or X-User-Token). */
  token: string | null;
};

export type RouteContext = {
  req: FakeRequest;
  params: Record<string, string>;
  state: FakeState;
  /** The caller's session (pending or signed in), when the route needs one. */
  session: FakeSession | null;
  /** The network by id, or throws a 404 answer. */
  network(id: string): FakeNetwork;
};

/** What a route returns: `data` (wrapped in the envelope) with an optional status, error and headers. */
export type RouteResult = { status?: number; data?: unknown; error?: string; headers?: Record<string, string> };

export type Route = {
  method: Method;
  /** Without version; `:name` segments become params. */
  path: string;
  /** Default "session": a signed-in token is required. */
  auth?: "session" | "pending" | "none";
  /** Default: all. */
  versions?: ApiVersion[];
  handle(ctx: RouteContext): RouteResult | Promise<RouteResult>;
};

export const ok = (data: unknown = null, status = 200): RouteResult => ({ status, data });
export const fail = (status: number, error: string): RouteResult => ({ status, error, data: null });

/** Thrown inside a route to answer with an error. */
export class FakeAnswer extends Error {
  constructor(readonly result: RouteResult) {
    super(result.error ?? `status ${result.status}`);
  }
}

export type FakeLogEntry = {
  method: Method;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string;
  token: string | null;
  status: number;
  /** state.now() when the request arrived. */
  at: number;
};

/** One write request as the server parsed it, whatever route answered it (404 included). */
export type FakeWrite = {
  method: Exclude<Method, "GET">;
  /** Full path including the version. */
  path: string;
  version: ApiVersion | "";
  /** Path without the version. */
  route: string;
  /** Lower-case, without parameters ("application/json"); "" when none was sent. */
  contentType: string;
  encoding: FakeRequest["encoding"];
  /** Parsed body: JSON object or form fields. */
  body: Record<string, unknown>;
  rawBody: string;
  status: number;
  at: number;
};

export type FakeEeroOptions = StateOptions & {
  /** Extra routes for one test, checked before the registered ones. */
  routes?: Route[];
};

export type FakeEero = {
  state: FakeState;
  scenarios: Scenarios;
  /** Every request, in arrival order. */
  log: FakeLogEntry[];
  /** Every PUT, POST and DELETE, parsed, in arrival order. */
  writes: FakeWrite[];
  /** Requests in flight now and the most seen at once. */
  stats: { inFlight: number; maxInFlight: number };
  /** "http://127.0.0.1" for in-process use; the real origin after listen(). */
  origin: string;
  /** In-process fetch: no sockets, honours AbortSignal. Pass to EeroClient as `fetch`. */
  fetch: typeof fetch;
  /** A new signed-in session token. */
  signIn(login?: string): string;
  /** Starts listening on a random 127.0.0.1 port and returns the origin. */
  listen(): Promise<string>;
  close(): Promise<void>;
};

type Answer = { status: number; headers: [string, string][]; body: string; hang?: boolean; delayMs?: number };

/** Read lazily: area files import helpers from this module, so the barrel may still be loading at import time. */
const registeredRoutes = (): Route[] => Object.values(areas as Record<string, Route[]>).flat();

export function createFakeEero(options: FakeEeroOptions = {}): FakeEero {
  const state = createState(options);
  const scenarios = new Scenarios();
  const log: FakeLogEntry[] = [];
  const writes: FakeWrite[] = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  const routes = [...(options.routes ?? []), ...registeredRoutes()].map(compile);
  let server: Server | null = null;
  const sockets = new Set<Socket>();
  const hanging = new Set<() => void>();

  async function answer(req: FakeRequest): Promise<Answer> {
    const effect = scenarios.take({ method: req.method, path: req.path });
    const headers: [string, string][] = [["content-type", "application/json"]];
    let result: RouteResult;
    if (effect.replace) {
      for (const [k, v] of Object.entries(effect.replace.headers ?? {})) headers.push([k, v]);
      if (effect.replace.body !== undefined) return { status: effect.replace.status, headers, body: effect.replace.body, hang: effect.hang, delayMs: effect.delayMs };
      result = { status: effect.replace.status, error: effect.replace.error, data: effect.replace.data ?? null };
    } else {
      result = await route(req);
    }
    for (const [k, v] of Object.entries(result.headers ?? {})) headers.push([k, v]);
    if (effect.rotateToken && req.token) {
      const old = state.sessions.get(req.token);
      if (old?.kind === "session") {
        const token = state.nextToken("session");
        state.sessions.set(token, { ...old, token });
        headers.push(["set-cookie", `s=${token}; Path=/; HttpOnly; Secure`]);
      }
    }
    const status = result.status ?? 200;
    const meta: Record<string, unknown> = { code: status, server_time: new Date(state.now()).toISOString() };
    if (result.error) meta.error = result.error;
    return { status, headers, body: JSON.stringify({ meta, data: result.data ?? null }), hang: effect.hang, delayMs: effect.delayMs };
  }

  async function route(req: FakeRequest): Promise<RouteResult> {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      if (r.versions && !r.versions.includes(req.version)) continue;
      const params = r.match(req.route);
      if (!params) continue;
      const auth = r.auth ?? "session";
      const session = req.token ? (state.sessions.get(req.token) ?? null) : null;
      if (auth === "session" && session?.kind !== "session") return fail(401, "error.session.invalid");
      if (auth === "pending" && session?.kind !== "pending") return fail(401, "error.session.invalid");
      const ctx: RouteContext = {
        req,
        params,
        state,
        session,
        network(id) {
          const net = state.networks.get(id);
          if (!net) throw new FakeAnswer(fail(404, "error.network.not.found"));
          return net;
        },
      };
      try {
        return await r.handle(ctx);
      } catch (err) {
        if (err instanceof FakeAnswer) return err.result;
        throw err;
      }
    }
    return fail(404, "error.not.found");
  }

  /** Shared by the in-process fetch and the HTTP listener. */
  async function dispatch(method: string, href: string, headers: Record<string, string>, rawBody: string, signal?: AbortSignal | null): Promise<Answer> {
    const url = new URL(href, "http://127.0.0.1");
    const req = parse(method, url, headers, rawBody);
    const entry: FakeLogEntry = { method: req.method, path: req.path, query: url.search, headers, body: rawBody, token: req.token, status: 0, at: state.now() };
    log.push(entry);
    const write: FakeWrite | null =
      req.method === "GET"
        ? null
        : { method: req.method, path: req.path, version: req.version, route: req.route, contentType: (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "", encoding: req.encoding, body: req.body, rawBody, status: 0, at: entry.at };
    if (write) writes.push(write);
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      const out = req.version ? await answer(req) : { status: 404, headers: [["content-type", "application/json"]] as [string, string][], body: JSON.stringify({ meta: { code: 404, error: "error.not.found" }, data: null }) };
      if (out.delayMs) await wait(out.delayMs, signal);
      if (out.hang) await wait(Infinity, signal);
      entry.status = out.status;
      if (write) write.status = out.status;
      return out;
    } finally {
      stats.inFlight--;
    }
  }

  function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        cleanup();
        reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
      };
      const timer = Number.isFinite(ms) ? setTimeout(() => (cleanup(), resolve()), ms) : null;
      const closeHang = () => (cleanup(), reject(new Error("fake eero server closed")));
      function cleanup() {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        hanging.delete(closeHang);
      }
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort);
      hanging.add(closeHang);
    });
  }

  const inProcessFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = typeof init.body === "string" ? init.body : init.body ? String(init.body) : "";
    const out = await dispatch(init.method ?? "GET", href, headers, body, init.signal);
    const h = new Headers();
    for (const [k, v] of out.headers) h.append(k, v);
    return new Response(out.body || null, { status: out.status, headers: h });
  }) as typeof fetch;

  const fake: FakeEero = {
    state,
    scenarios,
    log,
    writes,
    stats,
    origin: "http://127.0.0.1",
    fetch: inProcessFetch,
    signIn: (login) => addSession(state, login),
    async listen() {
      server = createServer((req, res) => {
        void readAll(req).then(async (body) => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
          try {
            const out = await dispatch(req.method ?? "GET", req.url ?? "/", headers, body);
            const grouped: Record<string, string[]> = {};
            for (const [k, v] of out.headers) (grouped[k] ??= []).push(v);
            res.writeHead(out.status, grouped);
            res.end(out.body);
          } catch {
            res.destroy();
          }
        });
      });
      server.on("connection", (s) => {
        sockets.add(s);
        s.on("close", () => sockets.delete(s));
      });
      await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
      fake.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return fake.origin;
    },
    async close() {
      for (const h of [...hanging]) h();
      if (!server) return;
      const s = server;
      server = null;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => s.close(() => resolve()));
    },
  };
  return fake;
}

// ---------------------------------------------------------------------------
// Helpers

type Compiled = Route & { match(path: string): Record<string, string> | null };

function compile(route: Route): Compiled {
  const names: string[] = [];
  const pattern = route.path.replace(/:([a-zA-Z_]+)/g, (_m, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  const re = new RegExp(`^${pattern}/?$`);
  return {
    ...route,
    match(path) {
      const m = re.exec(path);
      if (!m) return null;
      const params: Record<string, string> = {};
      names.forEach((n, i) => {
        params[n] = decodeURIComponent(m[i + 1] ?? "");
      });
      return params;
    },
  };
}

function parse(method: string, url: URL, headers: Record<string, string>, rawBody: string): FakeRequest {
  const vm = /^\/(2\.[234])(\/.*)$/.exec(url.pathname);
  const type = headers["content-type"] ?? "";
  let body: Record<string, unknown> = {};
  let encoding: FakeRequest["encoding"] = "none";
  if (rawBody === '""') encoding = "empty";
  else if (type.includes("application/x-www-form-urlencoded")) {
    encoding = "form";
    const form = new URLSearchParams(rawBody);
    for (const key of new Set(form.keys())) {
      const all = form.getAll(key);
      body[key] = all.length > 1 ? all : all[0];
    }
  } else if (rawBody) {
    encoding = "json";
    try {
      const parsed: unknown = JSON.parse(rawBody);
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
  }
  const cookie = /(?:^|;\s*)s=([^;]+)/.exec(headers.cookie ?? "")?.[1] ?? null;
  return {
    method: method.toUpperCase() as Method,
    path: url.pathname,
    version: (vm?.[1] ?? "") as ApiVersion,
    route: vm?.[2] ?? url.pathname,
    query: url.searchParams,
    headers,
    rawBody,
    body,
    encoding,
    token: cookie ?? headers["x-user-token"] ?? null,
  };
}

function readAll(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
