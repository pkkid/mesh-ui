import { describe, expect, it } from "vitest";

import type { Eero, EeroPort, Radio } from "../../../../core/model";
import { autoChannelLine, ethernet, ipText, ledState, portName, portsLine, radioBadge, restartLine, updateWindow, uplinkOf } from "./helpers";

/** An invented eero; only the fields a test names matter. */
function eero(over: Partial<Eero> & Pick<Eero, "id" | "location">): Eero {
  return {
    serial: null,
    model: null,
    modelNumber: null,
    isGateway: false,
    status: "online",
    firmware: null,
    updateAvailable: null,
    endOfLife: null,
    backhaul: "wireless",
    meshBars: null,
    upstream: null,
    hop: null,
    meshQuality: null,
    clients: { total: null, wired: null, wireless: null },
    bands: [],
    radios: [],
    led: { on: null, brightness: null },
    nightlight: null,
    ipv4: null,
    ipv6: [],
    subnet: null,
    gatewayIp: null,
    mac: null,
    bssids: [],
    joined: null,
    uptimeSec: null,
    lastHeartbeat: null,
    powerSource: null,
    messages: [],
    ...over,
  };
}

const port = (number: number, supportedMbps: number | null, name: string | null = null): EeroPort => ({
  number,
  name,
  status: "down",
  speedMbps: null,
  supportedMbps,
  isWan: name === "WAN",
  poe: null,
  mac: null,
  attached: null,
  actions: [],
});

const radio = (band: Radio["band"], autoChannel: boolean | null): Radio => ({ band, channel: null, widthMhz: null, utilization: null, clients: null, txPowerDbm: null, autoChannel });

describe("radioBadge", () => {
  it("names the band count and the Wi-Fi generation from the model", () => {
    expect(radioBadge({ bands: ["2.4", "5", "6"], model: "eero Pro 7" })).toBe("Tri-band Wi-Fi 7");
    expect(radioBadge({ bands: ["2.4", "5", "6", "wired"], model: "eero Pro 6E" })).toBe("Tri-band Wi-Fi 6E");
    expect(radioBadge({ bands: ["2.4", "5"], model: "eero 6+" })).toBe("Dual-band");
    expect(radioBadge({ bands: ["2.4", "5"], model: "eero Beacon" })).toBe("Dual-band");
  });

  it("is null when there is nothing to say", () => {
    expect(radioBadge({ bands: ["wired"], model: null })).toBeNull();
    expect(radioBadge({ bands: [], model: "eero" })).toBeNull();
    expect(radioBadge({ bands: ["2.4"], model: "eero 6" })).toBe("Wi-Fi 6");
  });
});

describe("ledState", () => {
  it("reads on, dimmed, off and unknown", () => {
    expect(ledState(eero({ id: "1", location: "A", led: { on: true, brightness: 100 } }), false)).toBe("on");
    expect(ledState(eero({ id: "1", location: "A", led: { on: true, brightness: null } }), false)).toBe("on");
    expect(ledState(eero({ id: "1", location: "A", led: { on: true, brightness: 40 } }), false)).toBe("dim");
    expect(ledState(eero({ id: "1", location: "A", led: { on: false, brightness: 100 } }), false)).toBe("off");
    expect(ledState(eero({ id: "1", location: "A" }), false)).toBe("unknown");
  });

  it("is unknown for an offline or missing eero", () => {
    expect(ledState(eero({ id: "1", location: "A", led: { on: true, brightness: 100 } }), true)).toBe("unknown");
    expect(ledState(null, false)).toBe("unknown");
  });
});

describe("autoChannelLine", () => {
  it("says on, off or which bands are fixed, and nothing when eero does not say", () => {
    expect(autoChannelLine([radio("2.4", true), radio("5", true)])).toBe("Auto channel selection on");
    expect(autoChannelLine([radio("2.4", false), radio("5", false)])).toBe("Auto channel selection off");
    expect(autoChannelLine([radio("2.4", true), radio("5", false), radio("6", null)])).toBe("Fixed channel on 5 GHz");
    expect(autoChannelLine([radio("2.4", null)])).toBeNull();
    expect(autoChannelLine([])).toBeNull();
  });
});

describe("uplinkOf", () => {
  const gateway = eero({ id: "g", location: "Living Room", isGateway: true, backhaul: "wired" });
  const office = eero({ id: "o", location: "Office", upstream: "g" });
  const garage = eero({ id: "a", location: "Garage", upstream: "o" });
  const hall = eero({ id: "h", location: "Hall", upstream: null });
  const all = [gateway, office, garage, hall];

  it("gives the gateway no upstream and every eero that hangs off it, by name", () => {
    expect(uplinkOf(gateway, all)).toEqual({ upstream: null, downstream: [hall, office] });
  });

  it("follows upstream for a leaf, and lists its own children", () => {
    expect(uplinkOf(office, all)).toEqual({ upstream: gateway, downstream: [garage] });
    expect(uplinkOf(garage, all)).toEqual({ upstream: office, downstream: [] });
  });

  it("falls back to the gateway when eero reports no upstream, or one that is not listed", () => {
    expect(uplinkOf(hall, all).upstream).toBe(gateway);
    expect(uplinkOf(eero({ id: "x", location: "X", upstream: "gone" }), all).upstream).toBe(gateway);
    expect(uplinkOf(office, [office]).upstream).toBeNull();
  });
});

describe("ports", () => {
  it("words ethernet speeds", () => {
    expect([ethernet(10_000), ethernet(5000), ethernet(2500), ethernet(1000), ethernet(100)]).toEqual(["10 GbE", "5 GbE", "2.5 GbE", "1 GbE", "100 Mb"]);
  });

  it("counts ports by speed, fastest first", () => {
    expect(portsLine([port(1, 5000), port(2, 5000)])).toBe("2 x 5 GbE, numbered left to right");
    expect(portsLine([port(0, 10_000, "WAN"), port(1, 2500), port(2, 10_000), port(3, 2500)])).toBe("2 x 10 GbE, 2 x 2.5 GbE, numbered left to right");
  });

  it("falls back to a port count when no speed is known, and is null with no ports", () => {
    expect(portsLine([port(1, null), port(2, null)])).toBe("2 ports, numbered left to right");
    expect(portsLine([])).toBeNull();
  });

  it("names a port by eero's name or its number", () => {
    expect(portName({ number: 0, name: "WAN" })).toBe("WAN");
    expect(portName({ number: 2, name: null })).toBe("Port 2");
  });
});

describe("updateWindow", () => {
  it("is three hours from the preferred hour", () => {
    expect(updateWindow(2)).toBe("2 to 5 AM");
    expect(updateWindow(0)).toBe("12 to 3 AM");
    expect(updateWindow(13)).toBe("1 to 4 PM");
  });

  it("names both halves of the day when the window crosses noon or midnight", () => {
    expect(updateWindow(10)).toBe("10 AM to 1 PM");
    expect(updateWindow(9)).toBe("9 AM to 12 PM");
    expect(updateWindow(22)).toBe("10 PM to 1 AM");
  });

  it("is null when eero does not say", () => {
    expect(updateWindow(null)).toBeNull();
  });
});

describe("ipText", () => {
  it("lists every known address, one per line", () => {
    expect(ipText({ ipv4: "192.168.4.22", ipv6: ["fd00::22", "fd00::23"], subnet: "192.168.4.0/22", gatewayIp: "192.168.4.1" })).toBe(
      "IPv4 192.168.4.22\nIPv6 fd00::22\nIPv6 fd00::23\nSubnet 192.168.4.0/22\nGateway 192.168.4.1",
    );
    expect(ipText({ ipv4: null, ipv6: [], subnet: null, gatewayIp: "192.168.4.1" })).toBe("Gateway 192.168.4.1");
    expect(ipText({ ipv4: null, ipv6: [], subnet: null, gatewayIp: null })).toBe("");
  });
});

describe("restartLine", () => {
  const gateway = eero({ id: "g", location: "Living Room", isGateway: true });
  const office = eero({ id: "o", location: "Office", upstream: "g" });
  const garage = eero({ id: "a", location: "Garage", upstream: "o" });

  it("warns that the whole network drops for the gateway", () => {
    expect(restartLine(gateway, [gateway, office, garage], "Maple Street")).toBe("Everyone on Maple Street loses internet for about 2 to 3 minutes");
  });

  it("names downstream eeros for a leaf", () => {
    expect(restartLine(office, [gateway, office, garage], "Maple Street")).toBe("Its devices and Garage (downstream) drop for about 1 minute");
    expect(restartLine(garage, [gateway, office, garage], "Maple Street")).toBe("Its devices drop for about 1 minute");
  });
});
