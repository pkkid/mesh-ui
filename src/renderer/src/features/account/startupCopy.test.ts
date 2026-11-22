import { describe, expect, it } from "vitest";

import { startAtLoginDetail, startupSummary } from "./startupCopy";

describe("Startup and tray copy", () => {
  it("says a login launch starts hidden in the tray only while tray mode is on", () => {
    expect(startAtLoginDetail(true, true)).toMatch(/^Start Mesh UI hidden in the tray/);
    expect(startAtLoginDetail(true, false)).toMatch(/^Open the Mesh UI window .* Turn on Keep running in the tray/);
    expect(startAtLoginDetail(undefined, false)).toMatch(/^Open the Mesh UI window/);
    expect(startAtLoginDetail(false, true)).toMatch(/development build/);
  });

  it("sums up both settings in the section description", () => {
    expect(startupSummary(true, true)).toBe("Starts in the tray at login. Closing the window keeps it running in the tray.");
    expect(startupSummary(true, false)).toBe("Opens at login. Closing the window quits it.");
    expect(startupSummary(false, false)).toBe("Opens only when you start it. Closing the window quits it.");
  });
});
