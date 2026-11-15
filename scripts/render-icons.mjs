#!/usr/bin/env node
// Renders every app icon PNG from the one source, build/icon.svg, and copies
// the SVG to the website. Run it after changing the icon: `pnpm icons`.
// Needs ImageMagick 7 (`magick`) with librsvg; it is a maintainer tool, not
// part of the build, so the rendered PNGs are committed.
//
//   build/icon.png              1024 px, electron-builder derives icns and ico
//   build/icons/<n>x<n>.png     the Linux hicolor sizes
//   website/public/img/icon.svg favicon and header mark
//   website/public/img/apple-touch-icon.png  180 px, opaque (iOS fills alpha with black)
//
// The tray icons in build/tray/ are hand-tuned SVGs and are not rendered here.
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = resolve(root, "build/icon.svg");

/** Render the SVG at `size` px. Rasterise large and downscale so small sizes stay crisp. */
function render(size, out, extra = []) {
  const density = Math.max(96, Math.ceil((96 * size * 4) / 256));
  execFileSync("magick", ["-background", "none", "-density", String(density), src, "-filter", "Lanczos", "-resize", `${size}x${size}`, ...extra, "-depth", "8", "-strip", out], {
    stdio: "inherit",
  });
  console.log(`${out.replace(`${root}/`, "")} (${size} px)`);
}

render(1024, resolve(root, "build/icon.png"));
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  render(size, resolve(root, `build/icons/${size}x${size}.png`));
}
// The touch icon must be opaque: put it on the box's own dark colour.
render(180, resolve(root, "website/public/img/apple-touch-icon.png"), ["-background", "#3c3836", "-alpha", "remove", "-alpha", "off"]);
copyFileSync(src, resolve(root, "website/public/img/icon.svg"));
console.log("website/public/img/icon.svg (copied)");
