import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { saveVariantFor } from "./sheet";

describe("saveVariantFor", () => {
  it("is the primary colour for writes, queries or nothing named", () => {
    expect(saveVariantFor([])).toBe("default");
    expect(saveVariantFor(["write", "query"])).toBe("default");
    // The registry is still loading.
    expect(saveVariantFor([undefined])).toBe("default");
  });
  it("is yellow when any command is disruptive", () => {
    expect(saveVariantFor(["write", "disruptive"])).toBe("warning");
  });
  it("is red when any command is destructive, even beside a disruptive one", () => {
    expect(saveVariantFor(["disruptive", "destructive"])).toBe("destructive");
  });
});

describe("hand-made dialogs", () => {
  // Every feature dialog goes through Sheet or ConfirmDialog (design-system.md#modals-and-popups).
  // The command palette is its own kind.
  const ALLOWED = new Set(["palette/CommandPalette.tsx"]);

  it("no feature imports DialogPopup directly", () => {
    const root = fileURLToPath(new URL("../../features/", import.meta.url));
    const offenders = readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f) && !ALLOWED.has(f.split(sep).join("/")))
      .filter((f) => /\bDialogPopup\b/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
