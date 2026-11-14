import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapHasUnread, mapNotification, mapNotificationSettings } from "../eero/map/notifications";
import { createEngine, memorySettings } from "../engine";
import type * as M from "../model";
import { desktopEnabled, findNewNotifications, isOfflineAlert, MAX_ALERTS_PER_POLL, unreadCount } from "./notifications";

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

type Scenario = "signed_out" | "eero_offline" | "network_offline";
const demo = (scenario?: Scenario, settings?: Partial<M.AppSettings>) => {
  const backend = createDemoBackend({ clock: () => NOW, scenario });
  return { backend, engine: createEngine({ backend, clock: () => NOW, settings: memorySettings(settings) }) };
};

describe("notifications.list (demo)", () => {
  it("lists newest first with unread counts per network", async () => {
    const { engine } = demo();
    const maple = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: MAPLE }));
    expect(maple.unread).toBe(true);
    expect(unreadCount(maple)).toBe(3);
    expect(maple.notifications).toHaveLength(6);
    expect(maple.nextCursor).toBeNull();
    const times = maple.notifications.map((n) => n.at);
    expect(times).toEqual([...times].sort().reverse());
    expect(maple.notifications.find((n) => n.refs.deviceId)?.title).toBe("New device joined");

    const lake = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: LAKE }));
    expect([lake.unread, unreadCount(lake)]).toEqual([true, 1]);
    const mom = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: MOM }));
    expect([mom.unread, unreadCount(mom)]).toEqual([false, 0]);
  });

  it("puts an unread offline alert on top in the offline scenarios", async () => {
    const eero = await ok(demo("eero_offline").engine.execute<M.NotificationPage>("notifications.list", { networkId: MAPLE }));
    expect(eero.notifications[0]).toMatchObject({ title: "Garage is offline", category: "eero", read: false });
    expect(unreadCount(eero)).toBe(4);
    const net = await ok(demo("network_offline").engine.execute<M.NotificationPage>("notifications.list", { networkId: MAPLE }));
    expect(net.notifications[0]).toMatchObject({ title: "Maple Street is offline", category: "network", read: false });
  });

  it("marks every row read when nothing is unread", async () => {
    const { backend, engine } = demo();
    backend.notifications.unread = async () => false;
    const page = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: MAPLE }));
    expect(page.unread).toBe(false);
    expect(page.notifications.every((n) => n.read)).toBe(true);
    expect(unreadCount(page)).toBe(0);
  });

  it("rejects bad params and needs a session", async () => {
    const { engine } = demo();
    expect(await code(engine.execute("notifications.list", { extra: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("notifications.list", { cursor: "" }))).toBe("bad_params");
    expect(await code(engine.execute("notifications.list", { cursor: "not-a-cursor" }))).toBe("bad_params");
    expect(await code(engine.execute("notifications.list", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demo("signed_out").engine.execute("notifications.list"))).toBe("not_signed_in");
  });

  it("is a cached query on the notifications poll", () => {
    const info = demo().engine.commands().find((c) => c.id === "notifications.list");
    expect(info).toMatchObject({ effect: "query", scope: "network", poll: 60 });
  });
});

describe("notifications.settings.get (demo)", () => {
  it("returns eero keys, push choices and desktop on by default", async () => {
    const s = await ok(demo().engine.execute<M.NotificationSettings>("notifications.settings.get", { networkId: MAPLE }));
    expect(s.eero["device.new"]).toBe(true);
    expect(s.eero["network.dataUsageReport"]).toBe(false);
    expect(Object.keys(s.eero).some((k) => k.startsWith("premium.") || k.startsWith("backup."))).toBe(false);
    expect(s.push).toEqual({ networkOffline: true, nodeOffline: true });
    expect(s.desktop).toEqual({ enabled: true });
    expect(desktopEnabled(s.desktop)).toBe(true);
  });

  it("takes the desktop choice from app settings", async () => {
    const s = await ok(demo(undefined, { desktopNotifications: { enabled: false } }).engine.execute<M.NotificationSettings>("notifications.settings.get"));
    expect(s.desktop).toEqual({ enabled: false });
    expect(desktopEnabled(s.desktop)).toBe(false);
  });

  it("rejects bad params", async () => {
    expect(await code(demo().engine.execute("notifications.settings.get", { device: "x" }))).toBe("bad_params");
    expect(await code(demo("signed_out").engine.execute("notifications.settings.get"))).toBe("not_signed_in");
  });
});

// ---------------------------------------------------------------------------
// New-item detection (shared by every desktop alert surface)

const note = (id: string, min: number, extra: Partial<M.Notification> = {}): M.Notification => ({
  id,
  at: new Date(NOW - min * 60_000).toISOString(),
  title: id,
  body: "",
  read: true,
  category: "device",
  refs: {},
  ...extra,
});
const page = (...notifications: M.Notification[]): M.NotificationPage => ({ notifications, unread: true, nextCursor: null });

describe("findNewNotifications", () => {
  it("alerts nothing on the first load, then each id not seen before", () => {
    const first = findNewNotifications(null, page(note("a", 10), note("b", 20)));
    expect(first.alerts).toEqual([]);
    expect([...first.seen]).toEqual(["a", "b"]);

    const second = findNewNotifications(first.seen, page(note("c", 1), note("a", 10), note("b", 20)));
    expect(second.alerts.map((n) => n.id)).toEqual(["c"]);
    // Same page again: nothing new, read flags do not matter.
    expect(findNewNotifications(second.seen, page(note("c", 1, { read: false }), note("a", 10))).alerts).toEqual([]);
  });

  it("alerts offline network and eero first, then newest first, capped per poll", () => {
    const seen = new Set(["old"]);
    const next = findNewNotifications(
      seen,
      page(
        note("device", 1),
        note("eero", 5, { category: "eero", title: "Garage is offline" }),
        note("update", 3, { category: "network", title: "Update tonight" }),
        note("net", 8, { category: "network", title: "Maple Street is offline" }),
      ),
    );
    expect(next.alerts.map((n) => n.id)).toEqual(["eero", "net", "device", "update"]);
    expect(isOfflineAlert(next.alerts[0] as M.Notification)).toBe(true);

    const burst = findNewNotifications(seen, page(...Array.from({ length: 9 }, (_, i) => note(`n${i}`, i))));
    expect(burst.alerts).toHaveLength(MAX_ALERTS_PER_POLL);
    expect(burst.seen.size).toBe(10);
  });

  it("finds the demo eero_offline alert after a scenario switch", async () => {
    const { engine } = demo();
    const before = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: MAPLE }));
    const first = findNewNotifications(null, before);
    await ok(engine.execute("demo.scenario.set", { scenario: "eero_offline" }));
    const after = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: MAPLE }));
    const next = findNewNotifications(first.seen, after);
    expect(next.alerts.map((n) => n.title)).toEqual(["Garage is offline"]);
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

describe("notifications (fake eero server)", () => {
  it("maps notifications_history and has_unread", async () => {
    const { engine } = fakeEngine();
    const maple = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: "100001" }));
    expect(maple.unread).toBe(true);
    expect(maple.nextCursor).toBeNull();
    expect(maple.notifications.map((n) => [n.id, n.category, n.title])).toEqual([
      ["fake-nt-2", "device", "New device joined"],
      ["fake-nt-1", "eero", "Garage is offline"],
    ]);
    expect(maple.notifications[0]?.refs.deviceId).toMatch(/^[0-9a-f]{12}$/);
    expect(maple.notifications[1]?.refs).toEqual({});
    // eero sends no per-row read flag.
    expect(maple.notifications.every((n) => n.read)).toBe(true);

    const lake = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: "100002" }));
    expect(lake.unread).toBe(false);
    expect(lake.notifications.map((n) => n.title)).toEqual(["Lake Cabin is offline"]);
  });

  it("pages by the created_at of the last row", async () => {
    const { engine } = fakeEngine((fake) => {
      const net = fake.state.networks.get("100001");
      if (!net) throw new Error("no fake network");
      net.notificationsHistory = Array.from({ length: 60 }, (_, i) => ({
        uuid: `fake-p-${i}`,
        category: "device",
        title: `Row ${i}`,
        body: "",
        created_at: new Date(NOW - (i + 1) * 60_000).toISOString(),
        meta: {},
      }));
    });
    const first = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: "100001" }));
    expect(first.notifications).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await ok(engine.execute<M.NotificationPage>("notifications.list", { networkId: "100001", cursor: first.nextCursor }));
    expect(second.notifications.map((n) => n.id)).toEqual(Array.from({ length: 10 }, (_, i) => `fake-p-${50 + i}`));
    expect(second.nextCursor).toBeNull();
  });

  it("maps the switches without eero Plus keys, with push from the account", async () => {
    const { engine } = fakeEngine();
    const s = await ok(engine.execute<M.NotificationSettings>("notifications.settings.get", { networkId: "100001" }));
    expect(s.eero).toEqual({
      "device.new": true,
      "device.restrict.new.private": false,
      "network.updated": true,
      "network.dataUsageReport": false,
      "permissions.updates": true,
      "port.security.blocked": true,
      "network.scheduledUpdate.earlyNotification": true,
      "network.scheduledUpdate.lateNotification": false,
    });
    expect(s.desktop).toEqual({ enabled: true });
  });
});

describe("notification mapping", () => {
  it("handles odd rows and both has_unread shapes", () => {
    expect(mapNotification({ uuid: "x" })).toBeNull();
    expect(mapNotification({ created_at: "2026-11-12T10:00:00Z", body: "Only a body" })).toMatchObject({ title: "Only a body", body: "", category: null, read: true });
    expect(mapHasUnread(true)).toBe(true);
    expect(mapHasUnread({ has_unread: true })).toBe(true);
    expect(mapHasUnread({})).toBe(false);
    expect(mapHasUnread(null)).toBe(false);
    expect(mapNotificationSettings({ "device.new": true, "premium.x": true, bad: "yes" as unknown as boolean })).toEqual({ "device.new": true });
  });
});
