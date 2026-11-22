import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("native checkboxes", () => {
  // Every checkbox is ui/checkbox.tsx (design-system.md, Checkbox), so they
  // share one size, color, mixed state and disabled look.
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((f) => f.split(sep).join("/"))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "components/ui/checkbox.tsx");

  it("no file renders a native type=checkbox", () => {
    const offenders = files.filter((f) => /type=\{?["']checkbox["']/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no file imports the base-ui checkbox directly", () => {
    const offenders = files.filter((f) => /@base-ui\/react\/checkbox\b/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
