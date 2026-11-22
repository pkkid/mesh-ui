import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("hand-made popovers and menus", () => {
  // Every popover goes through PopoverPopup and every menu through ui/menu.tsx
  // (design-system.md#popovers-and-menus), so they share one surface, the 4px
  // offset and no-drag. The network switcher keeps the sidebar surface on purpose.
  const ALLOWED = new Set(["shell/NetworkSwitcher.tsx"]);
  const root = fileURLToPath(new URL("../../features/", import.meta.url));
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("no feature imports the base-ui popover or menu directly", () => {
    const offenders = files
      .filter((f) => !ALLOWED.has(f.split(sep).join("/")))
      .filter((f) => /@base-ui\/react\/(popover|menu)\b/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no feature draws its own popover surface", () => {
    const offenders = files.filter((f) => /\bbg-popover\b/.test(readFileSync(join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
