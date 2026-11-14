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
 * A QR code is drawn dark on a light tile in both themes, with a quiet zone:
 * some scanners cannot read inverted (light on dark) codes. It is the one
 * place fixed black and white are used.
 */
import { Check, Copy, ImageDown } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { encode } from "uqr";

import { copyText } from "../../lib/clipboard";
import { cn } from "../../lib/utils";
import { Button } from "./button";

/** Quiet zone around the code, in modules (the spec asks for 4; 2 reads fine on screen). */
const SCREEN_QUIET = 2;
const PNG_QUIET = 4;
const PNG_MODULE_PX = 10;

/** The code's dark modules, row by row, or null when there is nothing to draw. */
export function qrModules(value: string | null | undefined): boolean[][] | null {
  if (!value) return null;
  try {
    return encode(value, { ecc: "M", border: 0 }).data;
  } catch {
    return null; // Too long for any QR version.
  }
}

/** One SVG path of unit squares for the dark modules, offset by `quiet`. */
export function qrPath(modules: boolean[][], quiet = 0): string {
  let d = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    });
  });
  return d;
}

/** A PNG data URL of the code, black on white with a 4-module quiet zone. */
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
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + PNG_QUIET) * PNG_MODULE_PX, (y + PNG_QUIET) * PNG_MODULE_PX, PNG_MODULE_PX, PNG_MODULE_PX);
    }),
  );
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

/** Just the code on its light tile. An empty frame (with `placeholder` centred in it) while `value` is missing. */
export function QrCode({ value, ariaLabel, size = 116, className, placeholder }: QrCodeProps) {
  const modules = qrModules(value);
  const n = (modules?.length ?? 25) + SCREEN_QUIET * 2;
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-lg border bg-white", !modules && "bg-muted/40", className)}
      style={{ width: size, height: size }}
    >
      {modules ? (
        <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={ariaLabel} className="block">
          <path d={qrPath(modules, SCREEN_QUIET)} fill="#000" />
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
        <div className="flex flex-col gap-1.5 [&>button]:justify-start">
          {copyLabel ? (
            <Button size="sm" variant="outline" disabled={!value} onClick={() => void copy()}>
              {copied === "done" ? <Check /> : <Copy />}
              {copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : copyLabel}
            </Button>
          ) : null}
          {fileName ? (
            <Button size="sm" variant="outline" disabled={!modules} onClick={save}>
              <ImageDown />
              Save QR
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
      <div className="flex flex-col items-center gap-1.5">
        <QrCode value={value} {...code} />
        {caption ? <div className="text-muted-foreground text-xs">{caption}</div> : null}
      </div>
    </div>
  );
}
