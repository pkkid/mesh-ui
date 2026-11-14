import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapInvites, mapMembers } from "../eero/map/admins";
import { createEngine } from "../engine";
import type * as M from "../model";
import { markYou, sortAdmins } from "./admins";

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
const demoEngine = (scenario?: "signed_out") => createEngine({ backend: createDemoBackend({ clock: () => NOW, scenario }), clock: () => NOW });

describe("admin.list (demo)", () => {
  it("owner view: owner first, admins, pending invites and seats used of 10", async () => {
    const list = await ok(demoEngine().execute<M.AdminList>("admin.list", { networkId: MAPLE }));
    expect(list.admins.map((a) => [a.name, a.role, a.isYou])).toEqual([
      ["Alex Kim", "owner", true],
      ["Jamie Kim", "admin", false],
    ]);
    expect(list.invites).toEqual([expect.objectContaining({ id: "7101", nickname: "Sam" })]);
    expect(list).toMatchObject({ seatsUsed: 2, seatsMax: 10 });
    expect(await ok(demoEngine().execute<M.AdminList>("admin.list", { networkId: LAKE }))).toMatchObject({ seatsUsed: 1, invites: [] });
  });

  it("admin view: someone else owns the network, you are an admin and see no invites", async () => {
    const list = await ok(demoEngine().execute<M.AdminList>("admin.list", { networkId: MOM }));
    expect(list.admins.map((a) => [a.name, a.role, a.isYou])).toEqual([
      ["Rose Kim", "owner", false],
      ["Alex Kim", "admin", true],
    ]);
    expect(list.invites).toEqual([]);
  });

  it("rejects bad params, needs a session and is a cached query", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("admin.list", { role: "owner" }))).toBe("bad_params");
    expect(await code(engine.execute("admin.list", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("admin.list"))).toBe("not_signed_in");
    expect(engine.commands().find((c) => c.id === "admin.list")).toMatchObject({ effect: "query", scope: "network" });
  });
});

describe("admin mapping", () => {
  it("maps members: any non-owner role is admin, rows without an id dropped, no email (eero sends none)", () => {
    expect(
      mapMembers([
        { user_id: 1, user_role: "owner", user_name: "A", user_tags: [] },
        { user_id: 2, user_role: "standard-admin", user_name: " B " },
        { user_role: "admin", user_name: "No id" },
        { user_id: 3, user_name: "" },
      ]),
    ).toEqual([
      { id: "1", name: "A", role: "owner", isYou: false },
      { id: "2", name: "B", role: "admin", isYou: false },
      { id: "3", name: null, role: "admin", isYou: false },
    ]);
  });

  it("maps invites with null for missing dates", () => {
    expect(mapInvites([{ invite_id: 9, invite_nickname: "Sam", created: "2026-11-12T14:30:00Z" }, { invite_nickname: "no id" }])).toEqual([
      { id: "9", nickname: "Sam", createdAt: "2026-11-12T14:30:00.000Z", expiresAt: null },
    ]);
  });

  it("marks you by account name, narrowed by role, and leaves the flags when unsure", () => {
    const a = (id: string, name: string | null, role: M.Role): M.Admin => ({ id, name, role, isYou: false });
    const rows = [a("1", "Rose", "owner"), a("2", "Alex", "admin"), a("3", "alex", "owner")];
    expect(markYou(rows, "Alex", "admin").map((x) => x.isYou)).toEqual([false, true, false]);
    expect(markYou(rows, "Alex", null)).toBe(rows);
    expect(markYou(rows, "Nobody", "owner")).toBe(rows);
    expect(markYou(rows, null, "owner")).toBe(rows);
    expect(sortAdmins([a("1", "Zed", "admin"), a("2", "Amy", "admin"), a("3", "Owner", "owner")]).map((x) => x.id)).toEqual(["3", "2", "1"]);
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

describe("admin.list (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("owner view: maps members and invites", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const list = await ok(s.engine.execute<M.AdminList>("admin.list", { networkId: "100001" }));
    expect(list).toEqual({
      admins: [
        { id: "1001", name: "Alex Kim", role: "owner", isYou: true },
        { id: "1002", name: "Jamie Kim", role: "admin", isYou: false },
      ],
      invites: [{ id: "fake-inv-1", nickname: "Sam", createdAt: expect.any(String), expiresAt: null }],
      seatsUsed: 2,
      seatsMax: 10,
    });
    expect(s.fake.log.every((e) => e.method === "GET")).toBe(true);
  });

  it("admin view: invites answer 403 and come back empty, not as an error", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const list = await ok(s.engine.execute<M.AdminList>("admin.list", { networkId: "100002" }));
    expect(s.fake.log.find((e) => e.path === "/2.2/networks/100002/invites")?.status).toBe(403);
    expect(list.invites).toEqual([]);
    expect(list.admins.map((a) => [a.role, a.isYou])).toEqual([
      ["owner", false],
      ["admin", true],
    ]);
  });

  it("other failures on invites still fail the command", async () => {
    const s = fakeEngine((f) => f.scenarios.add({ path: "/2.2/networks/100001/invites" }, { replace: { status: 404, error: "error.not.found" } }));
    fake = s.fake;
    expect(await code(s.engine.execute("admin.list", { networkId: "100001" }))).toBe("eero_error");
  });
});
