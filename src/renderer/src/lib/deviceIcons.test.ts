import { CircleHelp, Tv } from "lucide-react";
import { describe, expect, it } from "vitest";

import { DEVICE_TYPES, deviceCategory } from "../../../core/eero/map/device";
import { deviceIcon, TYPE_ICONS } from "./deviceIcons";

describe("deviceIcon", () => {
  it("gives every pickable eero type its own icon (remote and generic fall back)", () => {
    const pickable = DEVICE_TYPES.map((t) => t.type).filter((t) => t !== "generic" && t !== "remote");
    for (const t of pickable) expect(TYPE_ICONS[t], t).toBeDefined();
    expect(new Set(pickable.map((t) => TYPE_ICONS[t])).size).toBe(pickable.length);
  });

  it("uses the eero name, then the category, then a generic icon", () => {
    expect(deviceIcon({ type: "television", category: "entertainment" })).toBe(TYPE_ICONS.television);
    expect(deviceIcon({ type: "remote", category: deviceCategory("remote") })).toBe(Tv);
    expect(deviceIcon({ type: "generic", category: "other" })).toBe(CircleHelp);
    expect(deviceIcon(null)).toBe(CircleHelp);
  });
});
