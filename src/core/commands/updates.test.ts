import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapReleaseNotes, releaseKey } from "../eero/backend/updates";
import { EeroClient, MAX_PUBLIC_BYTES, READ_SHARE_MS } from "../eero/client";
import { RateLimiter } from "../eero/ratelimit";
import { mapUpdates, updateStatus } from "../eero/map/updates";
import { createEngine, type Engine } from "../engine";
import type * as M from "../model";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";
const LAKE = "5130264";
const MOM = "6092118";

type Result<R> = { ok: true; result: R } | { ok: false; error: { code: string; message: string } };
async function ok<R>(p: Promise<Result<R>>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}
const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

const demoEngine = (scenario?: "signed_out") =>
  createEngine({ backend: createDemoBackend({ clock: () => NOW, scenario }), clock: () => NOW });

describe("updates.get (demo)", () => {
  it("returns the current, target and per-eero versions", async () => {
    const engine = demoEngine();
    const maple = await ok(engine.execute<M.Updates>("updates.get", { networkId: MAPLE }));
    expect(maple).toMatchObject({ status: "scheduled", current: "7.12.1", target: "7.13.0", canUpdateNow: true, preferredHour: 2, stuckEeros: [] });
    expect(maple.eeros.map((e) => e.location)).toEqual(["Living Room", "Office", "Upstairs Hall", "Garage"]);
    expect(maple.eeros.every((e) => e.firmware === "7.12.1")).toBe(true);
    expect(await ok(engine.execute<M.Updates>("updates.get", { networkId: LAKE }))).toMatchObject({ status: "up_to_date", target: null });
    expect(await ok(engine.execute<M.Updates>("updates.get", { networkId: MOM }))).toMatchObject({ status: "available", target: "7.13.0" });
  });

  it("rejects bad params and needs a session", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("updates.get", { extra: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("updates.get", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("updates.get"))).toBe("not_signed_in");
  });

  it("is a cached query on the updates poll", () => {
    const info = demoEngine().commands().find((c) => c.id === "updates.get");
    expect(info).toMatchObject({ effect: "query", scope: "network", poll: 900 });
  });
});

// ---------------------------------------------------------------------------
// Real eero backend against the fake eero server

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
const secrets = (token: string): SecretStore => ({ load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" });

function fakeEngine(prepare?: (fake: FakeEero) => void) {
  const fake = createFakeEero({ now: () => NOW });
  prepare?.(fake);
  const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, engine: createEngine({ backend, clock: () => NOW }) };
}

describe("updates.get (fake eero server)", () => {
  it("maps GET {net}/updates with versions from GET {net}/eeros", async () => {
    const { engine, fake } = fakeEngine();
    const maple = await ok(engine.execute<M.Updates>("updates.get", { networkId: "100001" }));
    expect(maple).toEqual({
      status: "available",
      current: "7.10.1",
      target: "7.11.0",
      canUpdateNow: true,
      required: false,
      scheduledAt: null,
      preferredHour: 3,
      lastUpdatedAt: "2026-11-05T03:00:00.000Z",
      eeros: [
        { id: "500001", location: "Living Room", firmware: "7.10.1" },
        { id: "500002", location: "Office", firmware: "7.10.1" },
        { id: "500003", location: "Upstairs Hall", firmware: "7.10.1" },
        { id: "500004", location: "Garage", firmware: "7.10.1" },
      ],
      stuckEeros: [],
    });
    const paths = fake.log.map((l) => l.path);
    expect(paths).toContain("/2.2/networks/100001/updates");
    expect(paths).toContain("/2.2/networks/100001/eeros");
    const lake = await ok(engine.execute<M.Updates>("updates.get", { networkId: "100002" }));
    expect(lake).toMatchObject({ status: "up_to_date", target: null, canUpdateNow: false });
  });

  it("maps a scheduled update and stuck eeros", async () => {
    const { engine } = fakeEngine((fake) => {
      const u = fake.state.networks.get("100001")?.updates;
      if (!u) return;
      u.update_status = "scheduled";
      u.scheduled_update_time = "2026-11-14T07:00:00+0000";
      u.last_user_update = { unresponsive_eeros: [{ url: "/2.2/eeros/500004" }], incomplete_eeros: ["/2.2/eeros/500003", "/2.2/eeros/500004"] };
    });
    const u = await ok(engine.execute<M.Updates>("updates.get", { networkId: "100001" }));
    expect(u).toMatchObject({ status: "scheduled", scheduledAt: "2026-11-14T07:00:00.000Z", stuckEeros: ["500004", "500003"] });
  });
});

describe("updates mapping", () => {
  it("reads status words and falls back to has_update", () => {
    expect(["up_to_date", "available", "scheduled", "updating", "IN_PROGRESS"].map((w) => updateStatus({ update_status: w }))).toEqual(["up_to_date", "available", "scheduled", "installing", "installing"]);
    expect(updateStatus({})).toBe("up_to_date");
    expect(updateStatus({ has_update: true })).toBe("available");
    expect(updateStatus({ has_update: true, scheduled_update_time: "2026-11-14T07:00:00Z" })).toBe("scheduled");
  });

  it("treats missing fields as null, not zero", () => {
    expect(mapUpdates(null, [])).toEqual({
      status: "up_to_date",
      current: null,
      target: null,
      canUpdateNow: false,
      required: false,
      scheduledAt: null,
      preferredHour: null,
      lastUpdatedAt: null,
      eeros: [],
      stuckEeros: [],
    });
    expect(mapUpdates({ preferred_update_hour: 30, has_update: true, update_to_firmware: "7.13.0" }, []).preferredHour).toBeNull();
    expect(mapUpdates({ has_update: true, update_to_firmware: "7.13.0" }, []).target).toBe("7.13.0");
  });
});

// ---------------------------------------------------------------------------
// updates.notes

describe("updates.notes (demo)", () => {
  it("returns the target version's notes, else the current version's", async () => {
    const engine = demoEngine();
    const maple = await ok(engine.execute<M.ReleaseNotes | null>("updates.notes", { networkId: MAPLE }));
    expect(maple).toMatchObject({ version: "7.13.0", releasedAt: "2026-11-10T17:00:00.000Z", title: "eeroOS 7.13.0" });
    expect(maple?.features.length).toBeGreaterThan(0);
    // Lake Cabin is up to date on 7.11.4.
    expect(await ok(engine.execute<M.ReleaseNotes | null>("updates.notes", { networkId: LAKE }))).toMatchObject({ version: "7.11.4" });
  });

  it("rejects bad params, needs a session and is a cached query", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("updates.notes", { version: "7.13.0" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("updates.notes"))).toBe("not_signed_in");
    expect(engine.commands().find((c) => c.id === "updates.notes")).toMatchObject({ effect: "query", scope: "network" });
  });
});

/** The real manifest's shape (docs/eero-api/endpoints.md section 17), invented values. */
const MANIFEST = {
  target: { title: "Faster roaming", os_version: "v7.11.0", release_date: "2026-11-02T17:00:00Z", features: ["Faster roaming", "Security fixes"] },
  history: [
    { title: "Older", os_version: "v7.10.1", release_date: "2026-09-01T17:00:00Z", features: ["DHCP fixes"] },
    { title: "Oldest", os_version: "v7.9.0", release_date: "2026-07-01T17:00:00Z", features: [] },
  ],
};
const MANIFEST_PATH = "/2.2/fake-manifests/eeroos.json";

/** The fake network 100001 names a manifest on the fake server, served raw (no envelope) like eero's. */
function withManifest(body: string = JSON.stringify(MANIFEST), url?: string) {
  return (fake: FakeEero) => {
    const u = fake.state.networks.get("100001")?.updates;
    if (u) u.manifest_resource = url ?? `${fake.origin}${MANIFEST_PATH}`;
    fake.scenarios.add({ path: MANIFEST_PATH }, { replace: { status: 200, body } }, Infinity);
  };
}

describe("updates.notes (fake eero server)", () => {
  it("fetches the manifest without the session cookie or token and maps the target", async () => {
    const { engine, fake } = fakeEngine(withManifest());
    const notes = await ok(engine.execute<M.ReleaseNotes | null>("updates.notes", { networkId: "100001" }));
    expect(notes).toEqual({ version: "v7.11.0", releasedAt: "2026-11-02T17:00:00.000Z", title: "Faster roaming", features: ["Faster roaming", "Security fixes"] });
    const manifest = fake.log.filter((e) => e.path === MANIFEST_PATH);
    expect(manifest).toHaveLength(1);
    const headers = Object.keys(manifest[0]?.headers ?? {}).map((h) => h.toLowerCase());
    expect(headers).not.toContain("cookie");
    expect(headers).not.toContain("x-user-token");
    expect(manifest[0]?.token).toBeNull();
    // The updates read itself did carry the session.
    expect(fake.log.find((e) => e.path === "/2.2/networks/100001/updates")?.token).not.toBeNull();
  });

  it("shows the current release's notes when the network is up to date", async () => {
    const { engine } = fakeEngine((fake) => {
      withManifest()(fake);
      const u = fake.state.networks.get("100001")?.updates;
      if (!u) return;
      u.has_update = false;
      u.update_status = "up_to_date";
    });
    // Running 7.10.1 while the manifest's target is 7.11.0.
    expect(await ok(engine.execute<M.ReleaseNotes | null>("updates.notes", { networkId: "100001" }))).toMatchObject({ version: "v7.10.1", title: "Older" });
  });

  it("answers null when eero names no manifest", async () => {
    const { engine, fake } = fakeEngine();
    expect(await ok(engine.execute("updates.notes", { networkId: "100001" }))).toBeNull();
    expect(fake.log.some((e) => e.path.includes("manifest"))).toBe(false);
  });

  it("refuses an http manifest before sending anything", async () => {
    const { engine, fake } = fakeEngine(withManifest(undefined, "http://notes.example.com/eeroos.json"));
    const res = await engine.execute("updates.notes", { networkId: "100001" });
    expect(res).toMatchObject({ ok: false, error: { code: "eero_error" } });
    expect(fake.log.some((e) => e.path.includes("eeroos.json"))).toBe(false);
  });

  it("refuses a manifest over the size cap", async () => {
    const big = JSON.stringify({ target: { os_version: "v7.11.0", features: ["x".repeat(MAX_PUBLIC_BYTES)] } });
    const { engine } = fakeEngine(withManifest(big));
    const res = await engine.execute("updates.notes", { networkId: "100001" });
    expect(res).toMatchObject({ ok: false, error: { code: "eero_error", message: expect.stringContaining("too large") } });
  });
});

describe("EeroClient.fetchPublic", () => {
  const stubFetch = (body: BodyInit, headers: Record<string, string> = {}) =>
    vi.fn<typeof fetch>(async () => new Response(body, { status: 200, headers: { "content-type": "application/json", ...headers } }));
  const client = (fetchFn: typeof fetch) => new EeroClient({ secrets: secrets("fake-session-token"), fetch: fetchFn });

  it("sends no cookie or token to an https manifest, even when signed in", async () => {
    const f = stubFetch(JSON.stringify(MANIFEST));
    const c = client(f);
    expect((await c.status()).signedIn).toBe(true);
    expect(await c.fetchPublic("https://notes.example.com/eeroos.json")).toEqual(MANIFEST);
    const init = f.mock.calls[0]?.[1];
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    expect(headers.cookie).toBeUndefined();
    expect(headers["x-user-token"]).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain("fake-session-token");
    expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
  });

  it("refuses http, other schemes and credentials in the URL without fetching", async () => {
    const f = stubFetch("{}");
    const c = client(f);
    for (const url of ["http://notes.example.com/eeroos.json", "ftp://notes.example.com/x", "https://user:pw@notes.example.com/x", "not a url"]) {
      await expect(c.fetchPublic(url)).rejects.toMatchObject({ code: "eero_error" });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses a body over the cap, by declared length or while streaming", async () => {
    const declared = stubFetch("{}", { "content-length": String(MAX_PUBLIC_BYTES + 1) });
    await expect(client(declared).fetchPublic("https://notes.example.com/a.json")).rejects.toMatchObject({ code: "eero_error", message: expect.stringContaining("too large") });
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const streaming = stubFetch(endless);
    await expect(client(streaming).fetchPublic("https://notes.example.com/b.json")).rejects.toMatchObject({ message: expect.stringContaining("too large") });
    // Stopped soon after the cap instead of reading forever.
    expect(pulled).toBeLessThan(MAX_PUBLIC_BYTES / chunk.length + 4);
  });

  it("maps a failed or unreadable manifest to eero_error", async () => {
    const notFound = vi.fn<typeof fetch>(async () => new Response("nope", { status: 404 }));
    await expect(client(notFound).fetchPublic("https://notes.example.com/a.json")).rejects.toMatchObject({ code: "eero_error" });
    await expect(client(stubFetch("<html>")).fetchPublic("https://notes.example.com/a.json")).rejects.toMatchObject({ code: "eero_error" });
  });
});

describe("release notes mapping", () => {
  it("picks the entry of the wanted version ignoring v and the build suffix, else null", () => {
    expect(mapReleaseNotes(MANIFEST, null)?.version).toBe("v7.11.0");
    expect(mapReleaseNotes(MANIFEST, "v7.11.0-3120")?.title).toBe("Faster roaming");
    // Up to date on an older release: its history entry, never the manifest's target.
    expect(mapReleaseNotes(MANIFEST, "7.10.1")?.title).toBe("Older");
    expect(mapReleaseNotes(MANIFEST, "v7.8.0")).toBeNull();
    const { target: _t, ...historyOnly } = MANIFEST;
    expect(mapReleaseNotes(historyOnly, "v7.10.1-2045")).toEqual({ version: "v7.10.1", releasedAt: "2026-09-01T17:00:00.000Z", title: "Older", features: ["DHCP fixes"] });
    expect(releaseKey("v7.13.0-1234")).toBe(releaseKey("7.13.0"));
  });

  it("is lenient about feature shapes and junk", () => {
    expect(mapReleaseNotes({ os_version: "7.1.0", features: ["  A  ", { title: "B", description: "more" }, { name: "C" }, 3, null, ""] }, null)?.features).toEqual(["A", "B: more", "C"]);
    expect(mapReleaseNotes({ os_version: "7.1.0", release_date: 1_700_000_000 }, null)?.releasedAt).toBe("2023-11-14T22:13:20.000Z");
    expect(mapReleaseNotes(null, "7.1.0")).toBeNull();
    expect(mapReleaseNotes("text", null)).toBeNull();
    expect(mapReleaseNotes({}, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Page-load budget: the Updates & admins page's queries, run at once as React mounts them

const UPDATES_PAGE: [string, unknown?][] = [
  ["auth.status"],
  ["account.get"],
  ["network.list"],
  ["network.get"],
  ["updates.get"],
  ["updates.notes"],
  ["usage.quiet_hours", { range: "week", start: 3 }],
  ["admin.list"],
];

async function load(engine: Engine, page: [string, unknown?][]) {
  const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
  const failed = results.flatMap((r, i) => (r.ok ? [] : [`${page[i]?.[0]}: ${r.error.code} ${r.error.message}`]));
  expect(failed).toEqual([]);
}

describe("Updates page load against the fake eero server", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("stays well inside the request budget and reads each resource once, owner and admin", async () => {
    const f = createFakeEero();
    fake = f;
    withManifest()(f);
    const backend = createEeroBackend({ secrets: secrets(f.signIn()), origin: f.origin, fetch: f.fetch, readShareMs: READ_SHARE_MS, limiter: new RateLimiter() });
    const engine = createEngine({ backend });
    const started = Date.now();
    await load(engine, UPDATES_PAGE);
    expect(Date.now() - started).toBeLessThan(2_000);
    const reads = (path: string) => f.log.filter((e) => e.method === "GET" && e.path === path).length;
    for (const sub of ["", "/permissions", "/updates", "/eeros", "/members", "/invites"]) expect(reads(`/2.2/networks/100001${sub}`), sub).toBe(1);
    expect(reads("/2.2/account")).toBe(1);
    expect(reads(MANIFEST_PATH)).toBe(1);
    expect(f.log.filter((e) => e.path.includes("/data_usage")).length).toBe(1);
    expect(f.log.length).toBeLessThanOrEqual(14);

    // The admin view (Lake Cabin): invites answer 403 and the page still loads.
    await engine.execute("network.select", { network: "100002" });
    const before = f.log.length;
    await load(engine, UPDATES_PAGE);
    expect(f.log.length - before).toBeLessThanOrEqual(14);
  });
});
