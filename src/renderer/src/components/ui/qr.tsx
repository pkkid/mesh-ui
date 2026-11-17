/**
 * QR block: a QR code with its caption, and labelled buttons to its left
 * (Copy, Save QR, plus any the page adds, such as Print a card). Used by
 * Guest network and Wi-Fi (`WIFI:` payloads from `guest.share` and
 * `wifi.share`) and admin invites. docs/design/design-system.md (QR block).
 *
 * Encoding: `uqr` (MIT, zero dependencies, pinned in package.json), a port of
 * Project Nayuki's QR generator. The renderer only draws the payload core
 * built; it never keeps it beyond the component.
 *
 * On screen the code takes the theme: `text-foreground` modules on a
 * `bg-card` tile with a quiet zone, so in the dark theme it is light on dark
 * (current iOS and Android cameras read inverted codes). What leaves the app
 * stays black on white, since paper and other scanners may not cope with an
 * inverted code: the Save QR PNG here, and the printed card, which passes
 * `bg-white text-black` to `QrCode`.
 *
 * The Mesh UI glyph (the three nodes from build/icon.svg) sits in a cleared
 * square in the middle, in the modules' colour. The code is encoded at error
 * correction level H (30% recoverable) so the hidden modules, about 7% of
 * the code, never stop it scanning.
 */
import { Check, Copy, ImageDown } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { encode } from "uqr";

import { copyText } from "../../lib/clipboard";
import { cn } from "../../lib/utils";
import { Button, ButtonSizeContext, HERO_BUTTON_SIZE } from "./button";

/** Quiet zone around the code, in modules (the spec asks for 4; 2 reads fine on screen). */
const SCREEN_QUIET = 2;
const PNG_QUIET = 4;
const PNG_MODULE_PX = 10;

/**
 * The Mesh UI glyph from build/icon.svg: a triangle of three nodes with a
 * hub, in that file's 256 coordinates. `GLYPH_BOX` is its square bounds.
 */
const GLYPH_LINES = "M128 68.46 70.96 182.54 185.04 182.54ZM128 68.46 128 146.58M70.96 182.54 128 146.58 185.04 182.54";
const GLYPH_STROKE = 11.16;
const GLYPH_NODES: [cx: number, cy: number, r: number][] = [
  [128, 68.46, 24.8],
  [70.96, 182.54, 24.8],
  [185.04, 182.54, 24.8],
  [128, 146.58, 16.12],
];
const GLYPH_BOX = { x: 46.16, y: 43.66, size: 163.68 };

/** The code's dark modules, row by row, or null when there is nothing to draw. */
export function qrModules(value: string | null | undefined): boolean[][] | null {
  if (!value) return null;
  try {
    return encode(value, { ecc: "H", border: 0 }).data;
  } catch {
    return null; // Too long for any QR version.
  }
}

/**
 * The cleared square for the glyph, in modules from the code's top left:
 * about a quarter of the width, odd so it centres on the module grid (a code
 * is always an odd number of modules wide). Under 8% of the modules, well
 * inside level H's 30%.
 */
export function qrLogoHole(n: number): { start: number; size: number } {
  let size = Math.max(5, Math.round(n * 0.24));
  if (size % 2 === 0) size += 1;
  return { start: (n - size) / 2, size };
}

function inHole(x: number, y: number, hole: { start: number; size: number }): boolean {
  return x >= hole.start && x < hole.start + hole.size && y >= hole.start && y < hole.start + hole.size;
}

/** One SVG path of unit squares for the dark modules outside the glyph's hole, offset by `quiet`. */
export function qrPath(modules: boolean[][], quiet = 0): string {
  const hole = qrLogoHole(modules.length);
  let d = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark && !inHole(x, y, hole)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    });
  });
  return d;
}

/** The glyph's box inside the hole (one module of padding), in modules, offset by `quiet`. */
function glyphRect(n: number, quiet: number): { x: number; size: number } {
  const hole = qrLogoHole(n);
  return { x: hole.start + quiet + 1, size: hole.size - 2 };
}

/** The glyph as SVG, filling the given square, in `currentColor`. */
function QrGlyph({ x, size }: { x: number; size: number }) {
  return (
    <svg x={x} y={x} width={size} height={size} viewBox={`${GLYPH_BOX.x} ${GLYPH_BOX.y} ${GLYPH_BOX.size} ${GLYPH_BOX.size}`} shapeRendering="geometricPrecision">
      <path d={GLYPH_LINES} fill="none" stroke="currentColor" strokeWidth={GLYPH_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      {GLYPH_NODES.map(([cx, cy, r]) => (
        <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" />
      ))}
    </svg>
  );
}

/** A PNG data URL of the code, black on white with a 4-module quiet zone and the glyph in the middle. */
export function qrPngDataUrl(modules: boolean[][]): string | null {
  const n = modules.length + PNG_QUIET * 2;
  const canvas = document.createElement("canvas");
  canvas.width = n * PNG_MODULE_PX;
  canvas.height = n * PNG_MODULE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  const hole = qrLogoHole(modules.length);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark && !inHole(x, y, hole)) ctx.fillRect((x + PNG_QUIET) * PNG_MODULE_PX, (y + PNG_QUIET) * PNG_MODULE_PX, PNG_MODULE_PX, PNG_MODULE_PX);
    }),
  );
  const g = glyphRect(modules.length, PNG_QUIET);
  const scale = (g.size * PNG_MODULE_PX) / GLYPH_BOX.size;
  ctx.save();
  ctx.translate(g.x * PNG_MODULE_PX, g.x * PNG_MODULE_PX);
  ctx.scale(scale, scale);
  ctx.translate(-GLYPH_BOX.x, -GLYPH_BOX.y);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = GLYPH_STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(GLYPH_LINES));
  for (const [cx, cy, r] of GLYPH_NODES) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return canvas.toDataURL("image/png");
}

/**
 * Hands the PNG to Chromium's download flow, which shows the native save
 * dialog. It goes no further than that dialog; the text-only
 * `window.mesh.saveFile` bridge is not used for images.
 */
function savePng(dataUrl: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
}

export type QrCodeProps = {
  value: string | null | undefined;
  /** What the code is, for screen readers ("QR code to join Maple Street Guest"). */
  ariaLabel: string;
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Centred over the empty frame while there is no code (Wi-Fi's "Show code" button). */
  placeholder?: ReactNode;
};

/** Just the code on its card-coloured tile. An empty frame (with `placeholder` centred in it) while `value` is missing. */
export function QrCode({ value, ariaLabel, size = 116, className, placeholder }: QrCodeProps) {
  const modules = qrModules(value);
  const n = (modules?.length ?? 25) + SCREEN_QUIET * 2;
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-lg border bg-card text-foreground", !modules && "bg-muted/40", className)}
      style={{ width: size, height: size }}
    >
      {modules ? (
        <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={ariaLabel} className="block">
          <path d={qrPath(modules, SCREEN_QUIET)} fill="currentColor" />
          <QrGlyph {...glyphRect(modules.length, SCREEN_QUIET)} />
        </svg>
      ) : (
        <>
          <span role="img" aria-label={`${ariaLabel}, not available`} />
          {placeholder ? <div className="absolute inset-0 flex items-center justify-center">{placeholder}</div> : null}
        </>
      )}
    </div>
  );
}

export type QrBlockProps = QrCodeProps & {
  /** Muted caption under the code ("Guest Network"). */
  caption?: ReactNode;
  /** Copy button label ("Copy password", "Copy link"). Omit to hide Copy. */
  copyLabel?: string;
  /** What Copy puts on the clipboard; defaults to the QR payload. May fetch on demand. */
  copyText?: string | (() => Promise<string | null>);
  /** Save QR file name, ".png" included. Omit to hide Save QR. */
  fileName?: string;
  /** More buttons under Copy and Save QR (Print a card). */
  actions?: ReactNode;
};

/** The QR block from the design system: buttons on the left, code and caption on the right. */
export function QrBlock({ value, caption, copyLabel, copyText: copySource, fileName, actions, className, ...code }: QrBlockProps) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => {
    if (copied === "idle") return;
    const t = setTimeout(() => setCopied("idle"), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const modules = qrModules(value);
  const copy = async () => {
    const text = typeof copySource === "function" ? await copySource() : (copySource ?? value ?? null);
    setCopied(text && (await copyText(text)) ? "done" : "failed");
  };
  const save = () => {
    const url = modules && fileName ? qrPngDataUrl(modules) : null;
    if (url && fileName) savePng(url, fileName);
  };

  return (
    <div data-slot="qr-block" className={cn("flex items-start gap-4", className)}>
      {copyLabel || fileName || actions ? (
        <ButtonSizeContext value={HERO_BUTTON_SIZE}>
          <div className="flex flex-col gap-1.5 [&>button]:justify-start">
            {copyLabel ? (
              <Button variant="outline" disabled={!value} onClick={() => void copy()}>
                {copied === "done" ? <Check /> : <Copy />}
                {copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : copyLabel}
              </Button>
            ) : null}
            {fileName ? (
              <Button variant="outline" disabled={!modules} onClick={save}>
                <ImageDown />
                Save QR
              </Button>
            ) : null}
            {actions}
          </div>
        </ButtonSizeContext>
      ) : null}
      <div className="flex flex-col items-center gap-1.5">
        <QrCode value={value} {...code} />
        {caption ? <div className="text-muted-foreground text-xs">{caption}</div> : null}
      </div>
    </div>
  );
}
