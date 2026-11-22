import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("hand-made switches", () => {
  // Every on/off switch is ui/switch.tsx (design-system.md, Switch), so they
  // share one size, colour, unknown state and disabled look.
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((f) => f.split(sep).join("/"))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "components/ui/switch.tsx");

  it("no file draws its own role=switch", () => {
    const offenders = files.filter((f) => /role=\{?["']switch["']/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no file imports the base-ui switch directly", () => {
    const offenders = files.filter((f) => /@base-ui\/react\/switch\b/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
