import { describe, expect, it } from "vitest";

import { createDemoBackend } from "../../../../core/demo";
import { createEngine } from "../../../../core/engine";
import type { NotificationPage } from "../../../../core/model";
import type { DesktopAlert } from "../../../../shared/types";
import { createAlerter, notificationPath } from "./useDesktopAlerts";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";
const LAKE = "5130264";

async function list(engine: ReturnType<typeof createEngine>, networkId: string): Promise<NotificationPage> {
  const r = await engine.execute<NotificationPage>("notifications.list", { networkId });
  if (!r.ok) throw new Error(r.error.message);
  return r.result;
}

describe("desktop alerts", () => {
  it("asks the host for one notification per new item and none on first load", async () => {
    const engine = createEngine({ backend: createDemoBackend({ clock: () => NOW }), clock: () => NOW });
    const shown: DesktopAlert[] = [];
    const alerter = createAlerter((a) => shown.push(a));

    // First load: six items, no alerts.
    expect(alerter.update(MAPLE, await list(engine, MAPLE), true)).toBe(0);
    // The same page polled again: still none.
    expect(alerter.update(MAPLE, await list(engine, MAPLE), true)).toBe(0);
    expect(shown).toEqual([]);

    // The Garage eero goes offline: exactly one alert, opening the eeros page.
    const set = await engine.execute("demo.scenario.set", { scenario: "eero_offline" });
    expect(set.ok).toBe(true);
    expect(alerter.update(MAPLE, await list(engine, MAPLE), true)).toBe(1);
    expect(shown).toEqual([{ title: "Garage is offline", body: "Garage stopped checking in 9 minutes ago. Check its power.", target: "/eeros" }]);

    // Polled again: nothing more.
    expect(alerter.update(MAPLE, await list(engine, MAPLE), true)).toBe(0);
    expect(shown).toHaveLength(1);
  });

  it("starts over without alerting on a network switch, and stays quiet while off", async () => {
    const engine = createEngine({ backend: createDemoBackend({ clock: () => NOW }), clock: () => NOW });
    const shown: DesktopAlert[] = [];
    const alerter = createAlerter((a) => shown.push(a));
    alerter.update(MAPLE, await list(engine, MAPLE), true);
    expect(alerter.update(LAKE, await list(engine, LAKE), true)).toBe(0);
    expect(alerter.update(MAPLE, await list(engine, MAPLE), true)).toBe(0);

    await engine.execute("demo.scenario.set", { scenario: "network_offline" });
    // Off: the new item is remembered, not shown, and not replayed when turned on.
    expect(alerter.update(MAPLE, await list(engine, MAPLE), false)).toBe(0);
    expect(alerter.update(MAPLE, await list(engine, MAPLE), true)).toBe(0);
    expect(shown).toEqual([]);
  });

  it("opens the page a notification is about", () => {
    const base = { id: "x", at: new Date(NOW).toISOString(), body: "", read: false, refs: {} };
    expect(notificationPath({ ...base, title: "New device joined", category: "device", refs: { deviceId: "0a1b2c3d4e5f" } })).toBe("/devices/0a1b2c3d4e5f");
    expect(notificationPath({ ...base, title: "Garage is offline", category: "eero" })).toBe("/eeros");
    expect(notificationPath({ ...base, title: "Maple Street is offline", category: "network" })).toBe("/overview");
    expect(notificationPath({ ...base, title: "Update tonight", category: "network" })).toBe("/settings/updates");
    expect(notificationPath({ ...base, title: "Leo is paused", category: "profile" })).toBe("/profiles");
    expect(notificationPath({ ...base, title: "Something", category: null })).toBe("/activity");
  });
});
