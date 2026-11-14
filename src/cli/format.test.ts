import { describe, expect, it } from "vitest";
import { createDemoBackend } from "../core/demo";
import { createEngine } from "../core/engine";
import type * as M from "../core/model";
import { MASK, maskSensitive, renderTable } from "./format";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const plain = { color: false };

describe("maskSensitive", () => {
  // `mesh-ui run guest.share --format table` printed the `qr` field, password included (M3.8 review).
  it.each(["guest.share", "wifi.share"])("hides the password and the WIFI: payload of %s in table output", async (id) => {
    const engine = createEngine({ backend: createDemoBackend({ clock: () => NOW }), clock: () => NOW });
    const r = await engine.execute<M.WifiShare>(id);
    if (!r.ok) throw new Error(r.error.message);
    const { password, qr, ssid } = r.result;
    expect(password).toBeTruthy();
    expect(qr).toContain(`P:${password}`);

    const masked = maskSensitive(r.result) as M.WifiShare;
    expect(masked).toMatchObject({ ssid, password: MASK, qr: MASK });
    const table = renderTable(masked, plain, NOW);
    expect(table).not.toContain(password as string);
    expect(table).not.toContain("WIFI:");
    expect(table).toContain(ssid);

    // --reveal skips masking, so the unmasked result shows both.
    const revealed = renderTable(r.result, plain, NOW);
    expect(revealed).toContain(password as string);
    expect(revealed).toContain("WIFI:");
  });

  it("masks a WIFI: payload under any key, and leaves other strings alone", () => {
    expect(maskSensitive({ joinString: "WIFI:T:WPA;S:x;P:y;;", note: "Wi-Fi is on", nested: [{ code: "wifi:T:nopass;S:x;;" }] })).toEqual({
      joinString: MASK,
      note: "Wi-Fi is on",
      nested: [{ code: MASK }],
    });
  });
});
