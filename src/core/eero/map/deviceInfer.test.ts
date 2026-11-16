import { describe, expect, it } from "vitest";

import { classifyDevice } from "./device";
import { inferDevice } from "./deviceInfer";

const guess = (d: Parameters<typeof inferDevice>[0]) => {
  const g = inferDevice(d);
  return g ? ("type" in g ? g.type : `category:${g.category}`) : null;
};

describe("inferDevice", () => {
  it("reads the model name first", () => {
    expect(guess({ model: "Echo Dot (3rd Gen)", manufacturer: "Amazon Technologies Inc." })).toBe("digital_assistant");
    expect(guess({ model: "Fire TV Stick 4K", manufacturer: "Amazon Technologies Inc." })).toBe("media_streamer");
    expect(guess({ model: "Kindle Paperwhite" })).toBe("e_reader");
    expect(guess({ model: "Q6 Roku TV", manufacturer: "Roku, Inc." })).toBe("television");
    expect(guess({ model: "Roku Express" })).toBe("media_streamer");
    expect(guess({ model: "MacBook Pro 14" })).toBe("laptop_computer");
    expect(guess({ model: "Mac mini" })).toBe("desktop_computer");
    expect(guess({ model: "Nest Protect", manufacturer: "Nest Labs Inc." })).toBe("smoke_detector");
  });

  it("then the hostname", () => {
    expect(guess({ hostname: "android-7f3a" })).toBe("phone");
    expect(guess({ hostname: "Jamies-iPhone" })).toBe("phone");
    expect(guess({ hostname: "DESKTOP-4KQ2M1" })).toBe("desktop_computer");
    expect(guess({ hostname: "LAPTOP-9ZX1" })).toBe("laptop_computer");
    expect(guess({ hostname: "ESP_3A9F21" })).toBe("plug");
    expect(guess({ hostname: "BRN0080927AFBCE" })).toBe("printer");
    expect(guess({ hostname: "HP1A2B3C" })).toBe("printer");
  });

  it("then well-known manufacturers", () => {
    expect(guess({ manufacturer: "Sonos, Inc." })).toBe("audio");
    expect(guess({ manufacturer: "Ring LLC" })).toBe("door_bell");
    expect(guess({ manufacturer: "Espressif Inc." })).toBe("plug");
    expect(guess({ manufacturer: "Seiko Epson Corporation" })).toBe("printer");
    expect(guess({ manufacturer: "Nintendo Co.,Ltd" })).toBe("game_console");
    expect(guess({ manufacturer: "Sony Interactive Entertainment Inc." })).toBe("game_console");
    expect(guess({ manufacturer: "Roku, Inc" })).toBe("media_streamer");
    expect(guess({ manufacturer: "Nest Labs Inc." })).toBe("category:smart_home");
    expect(guess({ manufacturer: "Intel Corporate" })).toBe("category:computers");
  });

  it("leaves makers of many kinds of thing, and unknowns, alone", () => {
    for (const manufacturer of ["Apple, Inc.", "Amazon Technologies Inc.", "Google, Inc.", "Samsung Electronics Co.,Ltd", "Microsoft Corporation", "Unknown manufacturer"]) {
      expect(guess({ manufacturer, model: "Unknown", hostname: null }), manufacturer).toBeNull();
    }
    expect(guess({})).toBeNull();
  });
});

describe("classifyDevice", () => {
  it("guesses only for generic devices and keeps eero's type", () => {
    expect(classifyDevice("generic", { manufacturer: "Sonos, Inc." })).toEqual({ inferredType: "audio", category: "entertainment" });
    expect(classifyDevice("generic", { manufacturer: "Nest Labs Inc." })).toEqual({ inferredType: null, category: "smart_home" });
    expect(classifyDevice("generic", { manufacturer: "Apple, Inc." })).toEqual({ inferredType: null, category: "other" });
  });

  it("lets eero's or a person's type win over any guess", () => {
    expect(classifyDevice("television", { manufacturer: "Sonos, Inc." })).toEqual({ inferredType: null, category: "entertainment" });
  });
});
