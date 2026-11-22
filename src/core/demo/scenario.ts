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
  many_devices: "Maple Street with 120 more devices, to check long lists (Devices, the detail page switcher).",
  slow: "The default fixtures, but every read takes a moment (about 1.5 s), to show loading states.",
  errors: "The default fixtures, but every read fails with eero_error, to show error states. Sign-in still works.",
  admin: "Every network is shared with you as an admin and none is owned, so the account can be deleted.",
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
        alert(maple, { id: "ms-network-offline", at: at(12), title: "Maple Street is offline", body: "Maple Street stopped checking in. Check the modem and the Living Room eero.", category: "network" });
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
          alert(maple, { id: "ms-eero-offline", at: at(9), title: "Garage is offline", body: "Garage stopped checking in 9 minutes ago. Check its power.", category: "eero" });
        }
      }
      return { signedIn: true, reads: "normal" };

    case "slow":
      return { signedIn: true, reads: "slow" };

    case "errors":
      return { signedIn: true, reads: "errors" };

    case "admin": {
      const shared = fx.networks.find((n) => n.network.role === "admin")?.permissions;
      for (const n of fx.networks) {
        n.network.role = "admin";
        if (shared) n.permissions = structuredClone(shared);
        for (const a of n.admins) if (a.isYou) a.role = "admin";
        if (!n.admins.some((a) => a.role === "owner")) n.admins.unshift({ id: `demo-owner-${n.network.id}`, name: "Rose Kim", role: "owner", isYou: false });
      }
      fx.account.canTransfer = false;
      return { signedIn: true, reads: "normal" };
    }

    case "many_devices":
      if (maple) addDevices(maple, 120);
      return { signedIn: true, reads: "normal" };

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

/** Invented names for `many_devices`: a room and a thing, numbered past the first round. */
const ROOMS = ["Attic", "Back Porch", "Basement", "Den", "Garage", "Guest Room", "Hallway", "Kitchen", "Laundry", "Office", "Patio", "Studio"];
const THINGS = ["Camera", "Lamp", "Plug", "Sensor", "Speaker", "Switch", "Tablet", "Thermostat", "TV"];

/** Adds `count` copies of the network's devices with new invented names, MACs and addresses. */
function addDevices(net: DemoFixtures["networks"][number], count: number) {
  const base = [...net.devices];
  for (let i = 0; i < count && base.length > 0; i++) {
    const src = base[i % base.length]!;
    const mac = ["02", "4d", "55", "7f", (i >> 8).toString(16).padStart(2, "0"), (i & 0xff).toString(16).padStart(2, "0")].join(":");
    const id = mac.replace(/:/g, "");
    const round = Math.floor(i / (ROOMS.length * THINGS.length));
    const name = `${ROOMS[i % ROOMS.length]} ${THINGS[Math.floor(i / ROOMS.length) % THINGS.length]}${round > 0 ? ` ${round + 1}` : ""}`;
    const ipv4 = src.ipv4 ? src.ipv4.replace(/\.\d+$/, `.${100 + (i % 150)}`) : null;
    net.devices.push({ ...structuredClone(src), id, mac, name, nickname: name, hostname: null, ipv4, ipv6: [], privateMac: false });
    const usage = net.usage[src.id];
    if (usage) net.usage[id] = structuredClone(usage);
  }
}

/** Puts an unread notification on top of the network's list, as eero does when something goes offline. */
function alert(net: DemoFixtures["networks"][number], n: { id: string; at: string; title: string; body: string; category: string }) {
  net.notifications.unshift({ ...n, read: false, refs: {} });
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
