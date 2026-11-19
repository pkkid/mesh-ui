import { describe, expect, it } from "vitest";

import { deviceSearchQuery, deviceSearchUrl } from "./deviceLookup";

const base = { name: "Thing", manufacturer: null, model: null, hostname: null, mac: "3c:0a:f3:12:34:56", privateMac: false };

describe("deviceSearchQuery", () => {
  it("uses maker, model, a useful hostname and the vendor prefix, never the full MAC", () => {
    const q = deviceSearchQuery({ ...base, manufacturer: "Espressif", model: "ESP32", hostname: "ESP_3A9F21" });
    expect(q).toBe("Espressif ESP32 ESP_3A9F21 3c:0a:f3 OUI");
    expect(q).not.toContain("12:34:56");
  });

  it("drops a model that repeats the maker, a hostname equal to the name, and a MAC-looking hostname", () => {
    expect(deviceSearchQuery({ ...base, manufacturer: "Amazon", model: "Amazon Echo Dot", hostname: "thing" })).toBe("Amazon Echo Dot 3c:0a:f3 OUI");
    expect(deviceSearchQuery({ ...base, hostname: "3C0AF3123456" })).toBe("3c:0a:f3 OUI");
  });

  it("leaves out the prefix of a private MAC, and gives null with nothing to search", () => {
    expect(deviceSearchQuery({ ...base, privateMac: true, hostname: "brw3c0af3a181c7" })).toBe("brw3c0af3a181c7");
    expect(deviceSearchQuery({ ...base, privateMac: true })).toBeNull();
    expect(deviceSearchUrl({ ...base, privateMac: true })).toBeNull();
    // Locally administered (0x02 bit set) even when eero does not flag it private.
    expect(deviceSearchQuery({ ...base, mac: "02:4d:55:10:00:04", manufacturer: "Apple" })).toBe("Apple");
  });

  it("builds a Google search URL", () => {
    expect(deviceSearchUrl({ ...base, manufacturer: "HP", model: "LaserJet Pro M404" })).toBe(
      "https://www.google.com/search?q=HP%20LaserJet%20Pro%20M404%203c%3A0a%3Af3%20OUI",
    );
  });
});
