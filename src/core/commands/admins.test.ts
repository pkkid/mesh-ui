import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapInvites, mapMembers } from "../eero/map/admins";
import { createEngine } from "../engine";
import type * as M from "../model";
import { commands as adminCommands, markYou, sortAdmins } from "./admins";

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

// ---------------------------------------------------------------------------
// Writes: invites, admin.remove and network.transfer (M5.6)

type Created = { invite: M.Invite; inviteUrl: string; expiresAt: string | null };
const errorOf = async (p: Promise<{ ok: boolean; error?: { code: string; message: string } }>) => (await p).error;

describe("admin.invite.create and admin.invite.cancel (demo)", () => {
  it("creates an invite with a link; the next admin.list shows it pending with its nickname", async () => {
    const engine = demoEngine();
    const created = await ok(engine.execute<Created>("admin.invite.create", { networkId: MAPLE, nickname: " Robin " }));
    expect(created.inviteUrl).toMatch(/^https:\/\//);
    expect(created.invite).toMatchObject({ nickname: "Robin" });
    expect(created.expiresAt).toBe(new Date(NOW + 48 * 3_600_000).toISOString());
    const list = await ok(engine.execute<M.AdminList>("admin.list", { networkId: MAPLE }));
    expect(list.invites.map((i) => i.nickname)).toEqual(["Robin", "Sam"]);
  });

  it("cancels by nickname or id; the next admin.list no longer shows it", async () => {
    const engine = demoEngine();
    expect(await ok(engine.execute("admin.invite.cancel", { networkId: MAPLE, invite: "sam" }))).toEqual({ inviteId: "7101" });
    expect((await ok(engine.execute<M.AdminList>("admin.list", { networkId: MAPLE }))).invites).toEqual([]);
    expect(await code(engine.execute("admin.invite.cancel", { networkId: MAPLE, invite: "7101" }))).toBe("bad_params");
  });

  it("refuses when every seat is used or pending", async () => {
    const engine = demoEngine();
    // 2 members and 1 invite: 7 more fill the 10 seats.
    for (let i = 0; i < 7; i++) await ok(engine.execute("admin.invite.create", { networkId: MAPLE }));
    expect(await errorOf(engine.execute("admin.invite.create", { networkId: MAPLE }))).toEqual({ code: "bad_params", message: "All admin seats are in use." });
  });

  it("owner only: an admin's invite is refused (403), and the gate says so", async () => {
    const engine = demoEngine();
    expect(await errorOf(engine.execute("admin.invite.create", { networkId: MOM, nickname: "Kim" }))).toMatchObject({ code: "eero_error" });
    const info = Object.fromEntries(engine.commands().map((c) => [c.id, c]));
    expect(info["admin.invite.create"]).toMatchObject({ effect: "write", gate: { area: "network.admin_invites", op: "create" } });
    expect(info["admin.invite.cancel"]).toMatchObject({ effect: "write", gate: { area: "network.admin_invites", op: "delete" } });
    // The admin's permissions do not allow it, so pages and the palette dim it as "Owner only".
    const perms = await ok(engine.execute<M.Permissions>("network.permissions", { networkId: MOM }));
    expect(perms.can["network.admin_invites"]?.create).toBe(false);
  });

  it("rejects bad params", async () => {
    const engine = demoEngine();
    for (const nickname of ["", "   ", "x".repeat(33), 7]) expect(await code(engine.execute("admin.invite.create", { networkId: MAPLE, nickname })), String(nickname)).toBe("bad_params");
    expect(await code(engine.execute("admin.invite.create", { networkId: MAPLE, email: "a@example.com" }))).toBe("bad_params");
    expect(await code(engine.execute("admin.invite.cancel", { networkId: MAPLE }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("admin.invite.create"))).toBe("not_signed_in");
  });

  it("the invite link is sensitive: never cached and masked by the CLI", () => {
    expect(demoEngine().commands().find((c) => c.id === "admin.invite.create")).toMatchObject({ sensitive: true });
  });
});

describe("admin.remove (demo)", () => {
  it("needs confirm naming the person, then removes them; the next admin.list agrees", async () => {
    const engine = demoEngine();
    expect(await errorOf(engine.execute("admin.remove", { networkId: MAPLE, admin: "Jamie Kim" }))).toEqual({
      code: "needs_confirm",
      message: "Jamie Kim loses access to the network at once and needs a new invite to come back.",
    });
    expect(await ok(engine.execute("admin.remove", { networkId: MAPLE, admin: "jamie kim", confirm: true }))).toEqual({ adminId: "7002" });
    const list = await ok(engine.execute<M.AdminList>("admin.list", { networkId: MAPLE }));
    expect(list.admins.map((a) => a.name)).toEqual(["Alex Kim"]);
    expect(list.seatsUsed).toBe(1);
  });

  it("never removes the owner, and an admin cannot remove anyone (owner only)", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("admin.remove", { networkId: MAPLE, admin: "Alex Kim", confirm: true }))).toBe("bad_params");
    expect(await code(engine.execute("admin.remove", { networkId: MOM, admin: "Rose Kim", confirm: true }))).toBe("bad_params");
    expect(await errorOf(engine.execute("admin.remove", { networkId: MOM, admin: "Alex Kim", confirm: true }))).toMatchObject({ code: "eero_error", message: "Only the network owner can do that." });
    expect(engine.commands().find((c) => c.id === "admin.remove")).toMatchObject({ effect: "destructive", gate: { area: "network.standard_admins", op: "delete" } });
  });

  it("rejects bad params", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("admin.remove", { networkId: MAPLE, confirm: true }))).toBe("bad_params");
    expect(await code(engine.execute("admin.remove", { networkId: MAPLE, admin: "Nobody", confirm: true }))).toBe("bad_params");
  });
});

describe("network.transfer (demo)", () => {
  const to = { name: "Pat Example", email: "pat@example.com", networkName: "Maple Street" };

  it("needs confirm, then hands the network over; you stay on as an admin", async () => {
    const engine = demoEngine();
    expect(await errorOf(engine.execute("network.transfer", { networkId: MAPLE, ...to }))).toEqual({
      code: "needs_confirm",
      message: "Pat Example becomes the owner of Maple Street once they accept. You stay on as an admin. This cannot be undone.",
    });
    expect(await ok(engine.execute("network.transfer", { networkId: MAPLE, ...to, confirm: true }))).toEqual({ recipient: "Pat Example", sentTo: "pat@example.com" });
    expect((await ok(engine.execute<M.Network>("network.get", { networkId: MAPLE }))).role).toBe("admin");
    const list = await ok(engine.execute<M.AdminList>("admin.list", { networkId: MAPLE }));
    expect(list.admins.find((a) => a.role === "owner")?.name).toBe("Pat Example");
  });

  it("the typed name must match, and exactly one of email or phone", async () => {
    const engine = demoEngine();
    expect(await errorOf(engine.execute("network.transfer", { networkId: MAPLE, ...to, networkName: "maple street", confirm: true }))).toEqual({
      code: "bad_params",
      message: 'Type the network name "Maple Street" exactly to confirm.',
    });
    expect(await code(engine.execute("network.transfer", { networkId: MAPLE, ...to, phone: "+1 555 010 0199", confirm: true }))).toBe("bad_params");
    expect(await code(engine.execute("network.transfer", { networkId: MAPLE, name: "Pat", networkName: "Maple Street", confirm: true }))).toBe("bad_params");
    expect(await code(engine.execute("network.transfer", { networkId: MAPLE, ...to, email: "not-an-email", confirm: true }))).toBe("bad_params");
    expect(await code(engine.execute("network.transfer", { networkId: MAPLE, ...to, name: " ", confirm: true }))).toBe("bad_params");
    // Nothing changed.
    expect((await ok(engine.execute<M.Network>("network.get", { networkId: MAPLE }))).role).toBe("owner");
    // A phone instead of an email is fine.
    expect(await ok(engine.execute("network.transfer", { networkId: MAPLE, name: "Pat", phone: "+1 555 010 0199", networkName: "Maple Street", confirm: true }))).toEqual({
      recipient: "Pat",
      sentTo: "+1 555 010 0199",
    });
  });

  it("owner only: an admin's transfer is refused; the gate needs the capability and the permission", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("network.transfer", { networkId: MOM, name: "Pat", email: "pat@example.com", networkName: "Kim Home", confirm: true }))).toBe("eero_error");
    expect(engine.commands().find((c) => c.id === "network.transfer")).toMatchObject({
      effect: "destructive",
      gate: { area: "network.ownership_transfer", op: "create", capability: "ownership_transfer" },
    });
  });
});

describe("admin write specs", () => {
  it("invalidate the topics they change", () => {
    const of = (id: string) => adminCommands.find((c) => c.id === id)?.invalidates;
    expect(of("admin.invite.create")).toEqual(["admins"]);
    expect(of("admin.invite.cancel")).toEqual(["admins"]);
    expect(of("admin.remove")).toEqual(["admins"]);
    expect(of("network.transfer")).toEqual(["admins", "permissions", "network"]);
    // No member nickname endpoint exists (M5.6), so there is no admin.nickname.set.
    expect(adminCommands.some((c) => c.id === "admin.nickname.set")).toBe(false);
  });
});

describe("admin writes (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("invite: POST {net}/invites {invite_role}, finds the new row, PUT its nickname; admin.list shows it", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const created = await ok(s.engine.execute<Created>("admin.invite.create", { networkId: "100001", nickname: "Robin" }));
    expect(s.fake.writes.map((w) => [w.method, w.route, w.encoding, w.body])).toEqual([
      ["POST", "/networks/100001/invites", "json", { invite_role: "admin" }],
      ["PUT", `/networks/100001/invites/${created.invite.id}`, "json", { invite_nickname: "Robin" }],
    ]);
    expect(created).toMatchObject({ inviteUrl: `https://invite.example.com/fake/${created.invite.id}`, invite: { nickname: "Robin" }, expiresAt: new Date(NOW + 48 * 3_600_000).toISOString() });
    const list = await ok(s.engine.execute<M.AdminList>("admin.list", { networkId: "100001" }));
    expect(list.invites.map((i) => i.nickname)).toEqual(["Robin", "Sam"]);
  });

  it("invite without a nickname sends no PUT", async () => {
    const s = fakeEngine();
    fake = s.fake;
    await ok(s.engine.execute("admin.invite.create", { networkId: "100001" }));
    expect(s.fake.writes.map((w) => w.method)).toEqual(["POST"]);
  });

  it("an admin's invite answers 403 from eero: eero_error", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const res = await s.engine.execute("admin.invite.create", { networkId: "100002", nickname: "Kim" });
    expect(res).toMatchObject({ ok: false, error: { code: "eero_error" } });
    // eero refuses the admin's invites read before the write, so no POST is sent.
    expect(s.fake.log.filter((e) => e.path === "/2.2/networks/100002/invites").map((e) => e.status)).toContain(403);
    expect(s.fake.writes).toEqual([]);
  });

  it("cancel: DELETE {net}/invites/{id}", async () => {
    const s = fakeEngine();
    fake = s.fake;
    await ok(s.engine.execute("admin.invite.cancel", { networkId: "100001", invite: "Sam" }));
    expect(s.fake.writes.map((w) => [w.method, w.route, w.encoding])).toEqual([["DELETE", "/networks/100001/invites/fake-inv-1", "none"]]);
    expect((await ok(s.engine.execute<M.AdminList>("admin.list", { networkId: "100001" }))).invites).toEqual([]);
  });

  it("remove: DELETE {net}/admins/{user_id}; an admin is refused with 403", async () => {
    const s = fakeEngine();
    fake = s.fake;
    expect(await code(s.engine.execute("admin.remove", { networkId: "100001", admin: "Jamie Kim" }))).toBe("needs_confirm");
    await ok(s.engine.execute("admin.remove", { networkId: "100001", admin: "Jamie Kim", confirm: true }));
    expect(s.fake.writes.map((w) => [w.method, w.route, w.encoding])).toEqual([["DELETE", "/networks/100001/admins/1002", "none"]]);
    expect((await ok(s.engine.execute<M.AdminList>("admin.list", { networkId: "100001" }))).admins.map((a) => a.name)).toEqual(["Alex Kim"]);
    expect(await code(s.engine.execute("admin.remove", { networkId: "100002", admin: "Alex Kim", confirm: true }))).toBe("eero_error");
  });

  it("transfer: POST {net}/transfer as a form with the name and one contact", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const p = { networkId: "100001", name: "Pat Example", email: "pat@example.com", networkName: "Maple Street" };
    expect(await code(s.engine.execute("network.transfer", p))).toBe("needs_confirm");
    expect(await code(s.engine.execute("network.transfer", { ...p, networkName: "Maple St", confirm: true }))).toBe("bad_params");
    expect(s.fake.writes).toEqual([]);
    await ok(s.engine.execute("network.transfer", { ...p, confirm: true }));
    expect(s.fake.writes.map((w) => [w.method, w.route, w.encoding, w.body])).toEqual([["POST", "/networks/100001/transfer", "form", { name: "Pat Example", email: "pat@example.com" }]]);
    expect(s.fake.state.networks.get("100001")?.transfer).toMatchObject({ recipient_name: "Pat Example", recipient_email_address: "pat@example.com", recipient_phone_number: null });
  });
});
