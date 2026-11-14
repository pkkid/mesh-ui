/**
 * Switchable demo states, so tests and screenshots can reach the empty,
 * offline and signed-out states of every page. Each scenario starts from
 * pristine fixtures and changes them. `demo.scenario.set` (M1.9) calls
 * `DemoBackend.setScenario`.
 */

import type { DemoFixtures } from "./fixtures";

export const SCENARIOS = {
  default: "Maple Street, Lake Cabin and Mom's House as in the mockups.",
  signed_out: "No session: every read fails with not_signed_in until auth.login.verify.",
  no_networks: "Signed in to an account that has no networks.",
  network_offline: "Maple Street is offline: internet down, every eero offline, devices disconnected.",
  eero_offline: "The Garage eero on Maple Street is offline and its devices have dropped.",
  empty_network: "Maple Street has its eeros but no devices and no profiles yet.",
  slow: "The default fixtures, but every read takes a moment (about 1.5 s), to show loading states.",
  errors: "The default fixtures, but every read fails with eero_error, to show error states. Sign-in still works.",
} as const;

export type ScenarioName = keyof typeof SCENARIOS;

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];

export const isScenarioName = (name: string): name is ScenarioName => Object.hasOwn(SCENARIOS, name);

/** How reads behave: normal, delayed (`slow`) or failing with eero_error (`errors`). Sign-in is never affected. */
export type ReadMode = "normal" | "slow" | "errors";

/** What a scenario sets outside the fixtures. */
export type ScenarioEffect = { signedIn: boolean; reads: ReadMode };

/** Changes `fx` in place for the scenario. `now` is epoch ms. */
export function applyScenario(fx: DemoFixtures, name: ScenarioName, now: number): ScenarioEffect {
  const maple = fx.networks[0];
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

  switch (name) {
    case "default":
      return { signedIn: true, reads: "normal" };

    case "signed_out":
      return { signedIn: false, reads: "normal" };

    case "no_networks":
      fx.networks = [];
      fx.account.networkCount = 0;
      fx.account.canTransfer = false;
      return { signedIn: true, reads: "normal" };

    case "network_offline":
      if (maple) {
        maple.network.status = "offline";
        maple.network.lastSeen = at(12);
        maple.network.gatewayUptimeSec = null;
        maple.network.messages = ["Your network is offline."];
        maple.health = { internet: { status: "offline", ispUp: false }, mesh: { status: "offline" }, messages: ["Maple Street is offline. Check the modem and the Living Room eero."] };
        maple.internet.status = "offline";
        for (const e of maple.eeros) {
          e.status = "offline";
          e.uptimeSec = null;
          e.lastHeartbeat = at(12);
        }
        for (const d of maple.devices) dropDevice(d, at(12));
      }
      return { signedIn: true, reads: "normal" };

    case "eero_offline":
      if (maple) {
        const garage = maple.eeros.find((e) => e.location === "Garage");
        if (garage) {
          garage.status = "offline";
          garage.uptimeSec = null;
          garage.lastHeartbeat = at(9);
          garage.messages = ["Garage is offline. It last checked in 9 minutes ago."];
          for (const d of maple.devices) if (d.eeroId === garage.id && d.connected) dropDevice(d, at(9));
        }
      }
      return { signedIn: true, reads: "normal" };

    case "slow":
      return { signedIn: true, reads: "slow" };

    case "errors":
      return { signedIn: true, reads: "errors" };

    case "empty_network":
      if (maple) {
        maple.devices = [];
        maple.profiles = [];
        maple.reservations = [];
        maple.usage = {};
        maple.events = maple.events.filter((e) => e.category !== "devices" && e.category !== "pause_block" && e.category !== "schedules");
        maple.wifi.wpa2OnlyDevices = [];
        maple.notifications = maple.notifications.filter((n) => !n.refs.deviceId);
      }
      return { signedIn: true, reads: "normal" };
  }
}

function dropDevice(d: DemoFixtures["networks"][number]["devices"][number], lastActive: string) {
  if (!d.connected) return;
  d.connected = false;
  d.lastActive = lastActive;
  d.band = null;
  d.channel = null;
  d.signal = null;
  d.link = null;
  d.wiredPort = null;
  d.rates = null;
}
