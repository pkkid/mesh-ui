/**
 * Fake network data for working on the UI without an eero account.
 * Enabled with MESH_UI_DEMO=1 (see `pnpm dev:demo`).
 */
import type { Device, Network } from "@shared/types";

export const isDemo = process.env.MESH_UI_DEMO === "1";

const device = (n: number, name: string, extra: Partial<Device> = {}): Device => ({
  id: `demo-device-${n}`,
  name,
  ip: `192.168.4.${20 + n}`,
  mac: `a4:83:e7:${(16 + n).toString(16).padStart(2, "0")}:3c:9f`,
  manufacturer: null,
  connected: true,
  wireless: true,
  frequency: "5",
  via: "Living Room",
  ...extra,
});

export const demoNetworks: Network[] = [
  {
    id: "demo-home",
    name: "Home",
    devices: [
      device(1, "Office MacBook Pro", { manufacturer: "Apple" }),
      device(2, "Pixel 9", { manufacturer: "Google", via: "Office" }),
      device(3, "Living Room TV", { manufacturer: "LG Electronics", wireless: false, frequency: null }),
      device(4, "NAS", { manufacturer: "Synology", wireless: false, frequency: null, via: "Office" }),
      device(5, "Thermostat", { manufacturer: "ecobee", frequency: "2.4", via: "Hallway" }),
      device(6, "Kitchen Speaker", { manufacturer: "Sonos", frequency: "2.4", via: "Kitchen" }),
      device(7, "iPad", { manufacturer: "Apple", connected: false, ip: null }),
      device(8, "Guest Laptop", { manufacturer: "Dell", connected: false, via: "Office" }),
      device(9, "Doorbell", { manufacturer: "Ring", frequency: "2.4", via: "Hallway" }),
    ],
  },
  {
    id: "demo-cabin",
    name: "Cabin",
    devices: [
      device(20, "Camera", { manufacturer: "Wyze", frequency: "2.4", via: "Porch" }),
      device(21, "Smart Plug", { manufacturer: "TP-Link", connected: false, frequency: "2.4", via: "Porch" }),
    ],
  },
];
