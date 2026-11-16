import { Laptop, MonitorSmartphone, Speaker, Tv } from "lucide-react";
import { describe, expect, it } from "vitest";

import { DEVICE_TYPES, deviceCategory } from "../../../core/eero/map/device";
import { deviceIcon, EERO_MODEL_ICONS, echoIcon, eeroIcon, TYPE_ICONS } from "./deviceIcons";
import * as P from "./productIcons";

describe("deviceIcon", () => {
  it("gives every pickable eero type its own icon (remote and generic fall back)", () => {
    const pickable = DEVICE_TYPES.map((t) => t.type).filter((t) => t !== "generic" && t !== "remote");
    for (const t of pickable) expect(TYPE_ICONS[t], t).toBeDefined();
    expect(new Set(pickable.map((t) => TYPE_ICONS[t])).size).toBe(pickable.length);
  });

  it("uses the eero name, then the category, then a generic icon", () => {
    expect(deviceIcon({ type: "television", category: "entertainment" })).toBe(TYPE_ICONS.television);
    expect(deviceIcon({ type: "remote", category: deviceCategory("remote") })).toBe(Tv);
    expect(deviceIcon({ type: "generic", category: "other" })).toBe(MonitorSmartphone);
    expect(deviceIcon(null)).toBe(MonitorSmartphone);
  });

  it("uses core's guess for a generic device, then its category", () => {
    expect(deviceIcon({ type: "generic", inferredType: "audio", category: "entertainment" })).toBe(TYPE_ICONS.audio);
    expect(deviceIcon({ type: "generic", inferredType: null, category: "computers" })).toBe(Laptop);
    // eero's (or a person's) own type wins over a guess.
    expect(deviceIcon({ type: "printer", inferredType: "audio", category: "computers" })).toBe(TYPE_ICONS.printer);
  });
});

describe("eeroIcon", () => {
  it("maps every known model number", () => {
    expect(eeroIcon({ modelNumber: "B010001", model: "eero Pro" })).toBe(P.EeroPuck);
    expect(eeroIcon({ modelNumber: "R010001", model: "eero 6+" })).toBe(P.EeroPuck);
    expect(eeroIcon({ modelNumber: "V010001", model: "eero Max 7" })).toBe(P.EeroUpright);
    expect(eeroIcon({ modelNumber: "ME10001", model: "eero Pro 7" })).toBe(P.EeroUpright);
    expect(eeroIcon({ modelNumber: "D010001", model: "eero Beacon" })).toBe(P.EeroBeacon);
    expect(eeroIcon({ modelNumber: "NV01", model: "eero PoE 7" })).toBe(P.EeroCeiling);
    expect(new Set(Object.values(EERO_MODEL_ICONS)).size).toBe(6);
  });

  it("falls back to the model name, then the puck", () => {
    expect(eeroIcon({ modelNumber: "ZZ0001", model: "eero Outdoor 7" })).toBe(P.EeroOutdoor);
    expect(eeroIcon({ modelNumber: null, model: "eero PoE Gateway" })).toBe(P.EeroGateway);
    expect(eeroIcon({ modelNumber: null, model: "eero PoE 6" })).toBe(P.EeroCeiling);
    expect(eeroIcon({ modelNumber: null, model: "eero 7" })).toBe(P.EeroUpright);
    expect(eeroIcon({ modelNumber: null, model: "eero Beacon" })).toBe(P.EeroBeacon);
    expect(eeroIcon({ modelNumber: null, model: "eero 9000" })).toBe(P.EeroPuck);
    expect(eeroIcon(null)).toBe(P.EeroPuck);
  });
});

describe("echoIcon", () => {
  it("copes with eero's varying wording", () => {
    expect(echoIcon("Echo Dot (2nd Gen)")).toBe(P.EchoPuck);
    expect(echoIcon("Echo Dot (3rd generation)")).toBe(P.EchoPuck);
    expect(echoIcon("Echo Dot (3rd Gen) with Clock")).toBe(P.EchoPuck);
    expect(echoIcon("Echo Dot (5th Gen) with Clock")).toBe(P.EchoSphere);
    expect(echoIcon("Echo Dot Max")).toBe(P.EchoSphere);
  });

  it("picks the family", () => {
    expect(echoIcon("Echo (2nd Gen)")).toBe(P.EchoCylinder);
    expect(echoIcon("Echo (4th Gen)")).toBe(P.EchoSphere);
    expect(echoIcon("Echo Studio")).toBe(P.EchoCylinder);
    expect(echoIcon("Echo Plus (2nd Gen)")).toBe(P.EchoCylinder);
    expect(echoIcon("Echo Pop")).toBe(P.EchoPop);
    expect(echoIcon("Echo Spot (2024)")).toBe(P.EchoSpot);
    expect(echoIcon("Echo Flex")).toBe(P.EchoFlex);
    expect(echoIcon("Echo Show 8 (3rd Gen)")).toBe(P.EchoDisplay);
    expect(echoIcon("Echo Hub")).toBe(P.EchoDisplay);
    expect(echoIcon("Echo Input")).toBe(P.EchoPuck);
    expect(echoIcon("Echo Link Amp")).toBe(Speaker);
    expect(echoIcon("Echo Something New")).toBe(P.EchoSphere);
  });

  it("leaves non-Echos alone", () => {
    expect(echoIcon("Fire TV Stick 4K")).toBeNull();
    expect(echoIcon("Kindle Paperwhite")).toBeNull();
    expect(echoIcon(null)).toBeNull();
  });

  it("wins over the device type in deviceIcon", () => {
    expect(deviceIcon({ type: "generic", category: "other", model: "Echo Dot (2nd Gen)" })).toBe(P.EchoPuck);
    expect(deviceIcon({ type: "digital_assistant", category: "smart_home", model: "Echo (4th Gen)" })).toBe(P.EchoSphere);
    expect(deviceIcon({ type: "generic", category: "other", model: null })).toBe(MonitorSmartphone);
  });
});
