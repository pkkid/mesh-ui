import { describe, expect, it } from "vitest";

import { qrLogoHole, qrModules, qrPath } from "./qr";

describe("QR logo hole", () => {
  it("is odd, centred and under 8% of the modules for every size", () => {
    for (let n = 21; n <= 177; n += 4) {
      const { start, size } = qrLogoHole(n);
      expect(size % 2).toBe(1);
      expect(start * 2 + size).toBe(n);
      expect((size * size) / (n * n)).toBeLessThan(0.08);
    }
  });

  it("leaves the hole empty in the drawn path", () => {
    const modules = qrModules("WIFI:T:WPA;S:Maple Street Guest;P:correct-horse;;");
    expect(modules).not.toBeNull();
    const m = modules as boolean[][];
    const { start, size } = qrLogoHole(m.length);
    const drawn = new Set(qrPath(m).match(/M\d+ \d+/g));
    for (let y = start; y < start + size; y++) {
      for (let x = start; x < start + size; x++) expect(drawn.has(`M${x} ${y}`)).toBe(false);
    }
    // Modules outside the hole are still drawn (the top-left finder corner).
    expect(drawn.has("M0 0")).toBe(true);
  });

  it("plain codes use level L with no glyph hole: about half the modules of the logo code", () => {
    const payload = "WIFI:T:WPA;S:Maple Street Guest;P:lemon-harbor-42;;";
    const logo = qrModules(payload);
    const plain = qrModules(payload, true);
    expect(logo?.length).toBe(41);
    expect(plain?.length).toBe(29);
    // Every dark module is drawn: nothing is cleared for a glyph.
    const dark = plain!.flat().filter(Boolean).length;
    expect(qrPath(plain!, 0, true).match(/M\d+ \d+/g)?.length).toBe(dark);
  });
});
