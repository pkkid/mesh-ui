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
//   build/tray/mesh-ui-trayTemplate.png, @2x  the macOS menu bar template
//                               image (16 and 32 px) from build/tray/mesh-ui-tray-16.svg
//   build/tray/png/mesh-ui-tray-{white,black}-{16,32}.png  the Windows tray
//                               glyph for dark and light taskbars, from mesh-ui-tray-16.svg
//   build/tray/png/mesh-ui-tray-{white,black}-{22,44}.png  the Linux panel
//                               glyph, from mesh-ui-tray-22.svg
//
// `pnpm icons --tray` renders only the tray PNGs. The tray SVGs themselves are
// hand-tuned (KDE ColorScheme classes); here the symbol's color is swapped
// for plain white or black.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = resolve(root, "build/icon.svg");

/** Render the SVG at `size` px. Rasterise large and downscale so small sizes stay crisp. */
function render(size, out, extra = [], from = src, base = 256) {
  const density = Math.max(96, Math.ceil((96 * size * 4) / base));
  execFileSync("magick", ["-background", "none", "-density", String(density), from, "-filter", "Lanczos", "-resize", `${size}x${size}`, ...extra, "-depth", "8", "-strip", out], {
    stdio: "inherit",
  });
  console.log(`${out.replace(`${root}/`, "")} (${size} px)`);
}

const trayOnly = process.argv.includes("--tray");

if (!trayOnly) {
  render(1024, resolve(root, "build/icon.png"));
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    render(size, resolve(root, `build/icons/${size}x${size}.png`));
  }
  // The touch icon must be opaque: put it on the box's own dark colour.
  render(180, resolve(root, "website/public/img/apple-touch-icon.png"), ["-background", "#3c3836", "-alpha", "remove", "-alpha", "off"]);
  copyFileSync(src, resolve(root, "website/public/img/icon.svg"));
  console.log("website/public/img/icon.svg (copied)");
}

// macOS shows template images by their alpha only, so the symbol's color does not matter.
const tray16 = resolve(root, "build/tray/mesh-ui-tray-16.svg");
render(16, resolve(root, "build/tray/mesh-ui-trayTemplate.png"), [], tray16, 16);
render(32, resolve(root, "build/tray/mesh-ui-trayTemplate@2x.png"), [], tray16, 16);

// Windows and Linux: the same glyph in white (dark taskbars and panels) and black (light ones).
const tmp = mkdtempSync(join(tmpdir(), "mesh-ui-tray-"));
mkdirSync(resolve(root, "build/tray/png"), { recursive: true });
for (const [name, color] of [["white", "#ffffff"], ["black", "#000000"]]) {
  for (const [svg, base, sizes] of [["mesh-ui-tray-16.svg", 16, [16, 32]], ["mesh-ui-tray-22.svg", 22, [22, 44]]]) {
    const text = readFileSync(resolve(root, "build/tray", svg), "utf8").replace(/(\.ColorScheme-Text \{ color:)#[0-9a-fA-F]+/, `$1${color}`);
    const recolored = join(tmp, `${name}-${svg}`);
    writeFileSync(recolored, text);
    for (const size of sizes) render(size, resolve(root, `build/tray/png/mesh-ui-tray-${name}-${size}.png`), [], recolored, base);
  }
}
rmSync(tmp, { recursive: true, force: true });
