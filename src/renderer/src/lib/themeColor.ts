/**
 * Colour maths for themes: parsing, OKLCH, contrast, and the palette T3 Code
 * derives from a canvas and an accent colour. Ported from T3 Code
 * (https://github.com/pingdotgg/t3code, apps/web/src/themePalette.ts and
 * vscodeThemeImport.ts), MIT License, Copyright (c) 2026 T3 Tools Inc.
 *
 * T3 parses CSS colours with culori; Mesh UI only needs the forms its own
 * palettes and VS Code themes use (hex, rgb(), oklch(), color()), so the
 * parser is hand-written and there is no dependency.
 */
import { ROSE_THEME, type ThemeAppearance, type ThemeColorRole, type ThemeColors } from "./themePalettes";

export type Rgb = { r: number; g: number; b: number };
export type Rgba = Rgb & { a: number };
export type Oklch = { L: number; C: number; h: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number, round = true): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  const srgb = clamp(c, 0, 1) * 255;
  return round ? Math.round(srgb) : srgb;
}

export function rgbToOklch(color: Rgb): Oklch {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
}

function oklchToLinear({ L, C, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const bb = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** Lowers chroma until the colour fits sRGB, keeping lightness and hue. */
function toSrgbGamut(color: Oklch): Oklch {
  const inGamut = (C: number) => {
    const linear = oklchToLinear({ ...color, C });
    return [linear.r, linear.g, linear.b].every((channel) => channel >= -0.0001 && channel <= 1.0001);
  };
  if (inGamut(color.C)) return color;
  let low = 0;
  let high = color.C;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (inGamut(mid)) low = mid;
    else high = mid;
  }
  return { ...color, C: low };
}

export function oklchToRgb(color: Oklch, round = true): Rgb {
  const linear = oklchToLinear(toSrgbGamut(color));
  return { r: linearToSrgb(linear.r, round), g: linearToSrgb(linear.g, round), b: linearToSrgb(linear.b, round) };
}

function formatNumber(value: number, precision: number): string {
  const rounded = Math.abs(value) < 10 ** -precision / 2 ? 0 : value;
  return rounded.toFixed(precision).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1");
}

/** The canonical form T3 Code stores: `oklch(L C h)`. */
export function formatOklch(color: Oklch, alpha = 1): string {
  const fitted = toSrgbGamut(color);
  const hue = fitted.C < 0.0000005 ? 0 : ((fitted.h % 360) + 360) % 360;
  const body = `${formatNumber(fitted.L, 6)} ${formatNumber(fitted.C, 6)} ${formatNumber(hue, 3)}`;
  return alpha < 1 ? `oklch(${body} / ${formatNumber(alpha, 4)})` : `oklch(${body})`;
}

export const rgbToCss = (color: Rgb): string => formatOklch(rgbToOklch(color));

export function rgbToHex(color: Rgb): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

const number = (part: string, scale: number) =>
  part.endsWith("%") ? (Number.parseFloat(part) / 100) * scale : Number.parseFloat(part);

function parseAlpha(part: string | undefined): number {
  if (part === undefined) return 1;
  const value = part.trim();
  if (value === "none") return 0;
  return clamp(number(value, 1), 0, 1);
}

function parseColorFunction(space: string, channels: number[], alpha: number): Rgba | null {
  const [red, green, blue] = channels as [number, number, number];
  if (space === "srgb") return { r: red * 255, g: green * 255, b: blue * 255, a: alpha };
  // display-p3 to sRGB, via linear light.
  const decode = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [red, green, blue].map(decode) as [number, number, number];
  return {
    r: linearToSrgb(1.2249401762805 * lr - 0.2249401762805 * lg, false),
    g: linearToSrgb(-0.042056961239 * lr + 1.042056961239 * lg, false),
    b: linearToSrgb(-0.0196375547643 * lr - 0.0786360655012 * lg + 1.0982736202656 * lb, false),
    a: alpha,
  };
}

/**
 * Parses `#rgb[a]`, `#rrggbb[aa]`, `rgb()`/`rgba()`, `oklch()` and
 * `color(srgb|display-p3 ...)`. Returns null for anything else.
 */
export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== "string") return null;
  const input = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(input)?.[1];
  if (hex) {
    const pairs = hex.length <= 4 ? [...hex].map((c) => c + c) : (hex.match(/../g) ?? []);
    const [r, g, b, a] = pairs.map((p) => Number.parseInt(p, 16)) as [number, number, number, number?];
    return { r, g, b, a: a === undefined ? 1 : a / 255 };
  }

  const fn = /^(rgba?|oklch|color)\(\s*([^)]*)\)$/.exec(input);
  if (!fn) return null;
  const [, name, body = ""] = fn;
  const [channelPart = "", alphaPart] = body.split("/");
  let parts = channelPart.trim().split(/[\s,]+/).filter(Boolean);

  if (name === "color") {
    const space = parts.shift();
    if (space !== "srgb" && space !== "display-p3") return null;
    const channels = parts.map((p) => number(p, 1));
    if (channels.length !== 3 || channels.some((c) => !Number.isFinite(c))) return null;
    return parseColorFunction(space, channels, parseAlpha(alphaPart));
  }

  // rgba(r, g, b, a) puts alpha in the fourth comma slot.
  let alpha = parseAlpha(alphaPart);
  if (alphaPart === undefined && parts.length === 4) alpha = parseAlpha(parts[3]);
  parts = parts.slice(0, 3);
  if (parts.length !== 3) return null;

  if (name === "oklch") {
    const L = number(parts[0]!, 1);
    const C = number(parts[1]!, 0.4);
    const h = Number.parseFloat(parts[2]!);
    if (![L, C, h].every(Number.isFinite)) return null;
    return { ...oklchToRgb({ L, C, h }, false), a: alpha };
  }
  const [r, g, b] = parts.map((p) => number(p, 255)) as [number, number, number];
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b, a: alpha };
}

/** Parses a colour and drops its alpha; `fallback` when it does not parse. */
export function parseRgb(value: string, fallback: Rgb): Rgb {
  const parsed = parseColor(value);
  return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : fallback;
}

/** Hex for any colour this module parses (alpha dropped); null when it does not parse. */
export function colorToHex(value: string): string | null {
  const parsed = parseColor(value);
  return parsed ? rgbToHex(parsed) : null;
}

/** Composites a translucent colour onto a surface: theme roles are opaque. */
export function flattenOver(color: Rgba, base: Rgb): Rgb {
  if (color.a >= 1) return { r: color.r, g: color.g, b: color.b };
  return {
    r: color.r * color.a + base.r * (1 - color.a),
    g: color.g * color.a + base.g * (1 - color.a),
    b: color.b * color.a + base.b * (1 - color.a),
  };
}

export function mixRgb(base: Rgb, overlay: Rgb, amount: number): Rgb {
  return {
    r: base.r + (overlay.r - base.r) * amount,
    g: base.g + (overlay.g - base.g) * amount,
    b: base.b + (overlay.b - base.b) * amount,
  };
}

export function luminance(color: Rgb): number {
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** At luminance 0.179 black and white text have equal contrast. */
export const isDarkSurface = (color: Rgb) => luminance(color) < 0.179;

export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Moves only the lightness until `base` reaches `minContrast` on every surface. */
export function solveLightness(
  base: Oklch,
  against: ReadonlyArray<Rgb>,
  minContrast: number,
  direction: "lighter" | "darker",
): Oklch {
  const contrastOf = (color: Oklch) =>
    Math.min(...against.map((surface) => contrastRatio(oklchToRgb(color), surface)));
  if (contrastOf(base) >= minContrast) return base;
  let low = direction === "lighter" ? base.L : 0;
  let high = direction === "lighter" ? 1 : base.L;
  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2;
    const passes = contrastOf({ ...base, L: mid }) >= minContrast;
    if (passes === (direction === "lighter")) high = mid;
    else low = mid;
  }
  return { ...base, L: direction === "lighter" ? high : low };
}

/**
 * A colour readable on `surface`: `color` itself when it already reaches
 * `minContrast`, else the same hue lightened or darkened until it does.
 */
export function readableColorOn(color: string, surface: string, minContrast: number): string {
  const parsedColor = parseColor(color);
  const parsedSurface = parseColor(surface);
  if (!parsedColor || !parsedSurface) return color;
  if (contrastRatio(parsedColor, parsedSurface) >= minContrast) return color;
  const direction = isDarkSurface(parsedSurface) ? "lighter" : "darker";
  return rgbToHex(oklchToRgb(solveLightness(rgbToOklch(parsedColor), [parsedSurface], minContrast, direction)));
}

const LIGHT_FOREGROUND: Rgb = { r: 255, g: 250, b: 255 };
const DARK_FOREGROUND: Rgb = { r: 36, g: 21, b: 35 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Near-white or near-black text for a filled control. */
function readableForeground(background: Rgb): Rgb {
  const light = contrastRatio(background, LIGHT_FOREGROUND);
  const dark = contrastRatio(background, DARK_FOREGROUND);
  if (Math.max(light, dark) >= 4.5) return light >= dark ? LIGHT_FOREGROUND : DARK_FOREGROUND;
  return contrastRatio(background, WHITE) >= contrastRatio(background, BLACK) ? WHITE : BLACK;
}

/** `foreground` mixed toward `background` as far as `minimumRatio` allows. */
function softenedText(background: Rgb, foreground: Rgb, amount: number, minimumRatio: number): Rgb {
  const softened = mixRgb(foreground, background, amount);
  if (contrastRatio(softened, background) >= minimumRatio) return softened;
  let readable = foreground;
  let lower = 0;
  let upper = amount;
  for (let index = 0; index < 12; index += 1) {
    const mid = (lower + upper) / 2;
    const candidate = mixRgb(foreground, background, mid);
    if (contrastRatio(candidate, background) >= minimumRatio) {
      readable = candidate;
      lower = mid;
    } else {
      upper = mid;
    }
  }
  return readable;
}

/** Muted text at the contrast T3 Code's standard palette uses. */
function mutedText(background: Rgb, foreground: Rgb): Rgb {
  return softenedText(background, foreground, 1, isDarkSurface(background) ? 5.082 : 4.705);
}

const STANDARD_STATUS = {
  light: { error: "#fb2c36", errorForeground: "#c10007", warning: "#fe9a00", warningForeground: "#bb4d00" },
  dark: { error: "#fb414a", errorForeground: "#ff6467", warning: "#fe9a00", warningForeground: "#ffb900" },
} as const;

function standardStatusColors(canvas: Rgb) {
  const dark = isDarkSurface(canvas);
  const standard = STANDARD_STATUS[dark ? "dark" : "light"];
  const surfaceOf = (value: string) => mixRgb(canvas, parseRgb(value, canvas), dark ? 0.16 : 0.08);
  const readableOn = (foreground: string, surface: Rgb) =>
    formatOklch(solveLightness(rgbToOklch(parseRgb(foreground, canvas)), [surface], 4.6, dark ? "lighter" : "darker"));
  const errorSurface = surfaceOf(standard.error);
  const warningSurface = surfaceOf(standard.warning);
  return {
    error: rgbToCss(parseRgb(standard.error, canvas)),
    errorForeground: readableOn(standard.errorForeground, errorSurface),
    errorSurface: rgbToCss(errorSurface),
    warning: rgbToCss(parseRgb(standard.warning, canvas)),
    warningForeground: readableOn(standard.warningForeground, warningSurface),
    warningSurface: rgbToCss(warningSurface),
  };
}

/** T3 Code's default palette for an appearance: Rose (T3 Chat). */
export function getDefaultThemeColors(appearance: ThemeAppearance): ThemeColors {
  return appearance === ROSE_THEME.appearance ? ROSE_THEME.colors : (ROSE_THEME.variants?.[appearance] ?? ROSE_THEME.colors);
}

/**
 * Every role from a canvas and an accent colour, as T3 Code's
 * `createVividThemeColors`: surfaces step away from the canvas tinted toward
 * the accent hue, and text roles are solved for contrast.
 */
export function createVividThemeColors(appearance: ThemeAppearance, canvasValue: string, accentValue: string): ThemeColors {
  const canvasRgb = parseRgb(canvasValue, appearance === "dark" ? { r: 24, g: 15, b: 27 } : { r: 250, g: 245, b: 250 });
  const accentRgb = parseRgb(accentValue, { r: 168, g: 67, b: 112 });
  const canvas = rgbToOklch(canvasRgb);
  const accent = rgbToOklch(accentRgb);
  const dark = isDarkSurface(canvasRgb);
  const hue = accent.C < 0.02 ? canvas.h : accent.h;
  const tintC = Math.min(0.045, Math.max(0.008, accent.C * 0.22));
  const step = dark ? 1 : -1;

  const surfaceAt = (deltaL: number, chroma = tintC): Oklch => ({
    L: clamp(canvas.L + step * deltaL, 0.05, 0.98),
    C: chroma,
    h: hue,
  });
  const css = formatOklch;

  const textBase: Oklch = { L: dark ? 0.95 : 0.2, C: Math.min(0.035, accent.C * 0.25), h: hue };
  const textRgb = oklchToRgb(solveLightness(textBase, [canvasRgb], 7, dark ? "lighter" : "darker"));
  const textMutedRgb = mutedText(canvasRgb, textRgb);

  const action: Oklch = {
    L: clamp(accent.L + (dark ? 0.06 : -0.02), 0.35, 0.85),
    C: Math.max(accent.C * 0.9, 0.06),
    h: (hue + 50) % 360,
  };
  const actionRgb = oklchToRgb(action);

  const sidebar = surfaceAt(0.045, tintC * 1.4);
  const sidebarRgb = oklchToRgb(sidebar);
  const surfaceRaised = surfaceAt(0.05);
  const secondary = surfaceAt(dark ? 0.1 : 0.06, Math.min(0.09, accent.C * 0.5));
  const muted = surfaceAt(dark ? 0.06 : 0.04, Math.min(0.06, accent.C * 0.35));
  const accentSurface = surfaceAt(dark ? 0.13 : 0.08, Math.min(0.11, accent.C * 0.55));
  const messageSurface = surfaceAt(dark ? 0.16 : 0.1, Math.min(0.13, accent.C * 0.6));
  const updateSurface = surfaceAt(dark ? 0.14 : 0.09, Math.min(0.12, accent.C * 0.55));

  const foregroundOn = (surface: Oklch): string =>
    css(solveLightness(textBase, [oklchToRgb(surface)], 4.6, dark ? "lighter" : "darker"));
  const searchMatch = oklchToRgb(surfaceAt(0.22, Math.min(0.12, accent.C)));
  const searchMatchActive = oklchToRgb(surfaceAt(0.4, Math.min(0.18, accent.C)));
  const text = rgbToCss(textRgb);
  const textMuted = rgbToCss(textMutedRgb);

  return {
    ...getDefaultThemeColors(appearance),
    ...standardStatusColors(canvasRgb),
    canvas: rgbToCss(canvasRgb),
    chrome: rgbToCss(canvasRgb),
    toolbar: rgbToCss(canvasRgb),
    toolbarForeground: text,
    toolbarBorder: css(surfaceAt(dark ? 0.14 : 0.1, Math.min(0.08, accent.C * 0.4))),
    toolbarControl: css(surfaceAt(dark ? 0.09 : 0.05, tintC * 1.3)),
    toolbarControlForeground: text,
    toolbarControlHover: css(surfaceAt(dark ? 0.14 : 0.09, tintC * 1.6)),
    surface: css(surfaceAt(0.015)),
    surfaceRaised: css(surfaceRaised),
    surfaceOverlay: css(surfaceAt(0.075)),
    text,
    textMuted,
    border: css(surfaceAt(dark ? 0.16 : 0.12, Math.min(0.07, accent.C * 0.35))),
    input: css(surfaceAt(dark ? 0.21 : 0.16, Math.min(0.08, accent.C * 0.4))),
    focus: rgbToCss(accentRgb),
    accent: rgbToCss(accentRgb),
    accentForeground: rgbToCss(readableForeground(accentRgb)),
    secondary: css(secondary),
    secondaryForeground: foregroundOn(secondary),
    muted: css(muted),
    mutedForeground: rgbToCss(softenedText(oklchToRgb(muted), textRgb, 1, 4.6)),
    placeholder: rgbToCss(softenedText(oklchToRgb(surfaceRaised), textRgb, 1, 4.6)),
    secondaryLabel: textMuted,
    iconMuted: textMuted,
    update: rgbToCss(accentRgb),
    updateForeground: foregroundOn(updateSurface),
    updateSurface: css(updateSurface),
    accentSurface: css(accentSurface),
    accentSurfaceForeground: foregroundOn(accentSurface),
    messageSurface: css(messageSurface),
    messageForeground: foregroundOn(messageSurface),
    messageAction: rgbToCss(actionRgb),
    messageActionForeground: rgbToCss(readableForeground(actionRgb)),
    messageActionHover: css({ ...action, L: action.L + (dark ? 0.06 : -0.06) }),
    codeBackground: css(surfaceAt(0.035, tintC * 0.8)),
    codeForeground: text,
    searchMatchBackground: rgbToCss(searchMatch),
    searchMatchForeground: rgbToCss(readableForeground(searchMatch)),
    searchMatchActiveBackground: rgbToCss(searchMatchActive),
    searchMatchActiveForeground: rgbToCss(readableForeground(searchMatchActive)),
    sidebar: css(sidebar),
    sidebarForeground: foregroundOn(sidebar),
    sidebarMutedForeground: rgbToCss(mutedText(sidebarRgb, textRgb)),
    sidebarControlSurface: css(surfaceAt(dark ? 0.1 : 0.07, tintC * 1.5)),
    sidebarRowHover: css(surfaceAt(dark ? 0.08 : 0.06, Math.min(0.08, accent.C * 0.45))),
    sidebarRowActive: css(surfaceAt(dark ? 0.12 : 0.09, Math.min(0.1, accent.C * 0.55))),
    sidebarRowSelected: css(surfaceAt(dark ? 0.14 : 0.1, Math.min(0.11, accent.C * 0.6))),
    sidebarBorder: css(surfaceAt(dark ? 0.17 : 0.12, Math.min(0.08, accent.C * 0.4))),
    terminalBackground: rgbToCss(canvasRgb),
    terminalForeground: text,
    terminalCursor: rgbToCss(accentRgb),
    terminalSelection: css(surfaceAt(dark ? 0.18 : 0.12, Math.min(0.12, accent.C * 0.55))),
    terminalScrollbar: css(surfaceAt(dark ? 0.22 : 0.16, tintC)),
    terminalScrollbarHover: css(surfaceAt(dark ? 0.3 : 0.22, tintC)),
  };
}

/**
 * Sets one colour in the theme editor's advanced mode and re-derives the
 * roles that go with it (a surface's text, a status colour's text and
 * wash), as T3 Code's `updateThemeColorFamily`. Trimmed to the families
 * Mesh UI paints.
 */
export function updateThemeColorFamily(
  appearance: ThemeAppearance,
  colors: ThemeColors,
  role: ThemeColorRole,
  value: string,
): ThemeColors {
  const parsed = parseColor(value);
  if (!parsed) return { ...colors, [role]: value };
  const normalized = formatOklch(rgbToOklch(parsed), parsed.a);
  const canvas = parseRgb(colors.canvas, appearance === "dark" ? { r: 24, g: 15, b: 27 } : { r: 250, g: 245, b: 250 });
  const selectedOn = (background: Rgb) => flattenOver(parsed, background);
  const onCanvas = selectedOn(canvas);
  const dark = isDarkSurface(canvas);
  const foregroundOn = (background: Rgb) => rgbToCss(readableForeground(background));
  const toneOn = (background: Rgb) =>
    formatOklch(solveLightness(rgbToOklch(parsed), [background], 4.6, isDarkSurface(background) ? "lighter" : "darker"));
  const status = () => {
    const surface = mixRgb(canvas, onCanvas, dark ? 0.16 : 0.08);
    return { foreground: toneOn(surface), surface: rgbToCss(surface) };
  };

  switch (role) {
    case "canvas":
      return { ...colors, canvas: normalized, chrome: normalized, toolbar: normalized };
    case "text":
      return { ...colors, text: normalized, toolbarForeground: normalized, toolbarControlForeground: normalized };
    case "mutedForeground":
      return {
        ...colors,
        textMuted: normalized,
        mutedForeground: normalized,
        placeholder: normalized,
        secondaryLabel: normalized,
        iconMuted: normalized,
        sidebarMutedForeground: normalized,
      };
    case "border":
      return { ...colors, border: normalized, toolbarBorder: normalized, sidebarBorder: normalized };
    case "secondary":
      return { ...colors, secondary: normalized, secondaryForeground: foregroundOn(onCanvas), muted: normalized, toolbarControl: normalized };
    case "accentSurface":
      return { ...colors, accentSurface: normalized, accentSurfaceForeground: foregroundOn(onCanvas), toolbarControlHover: normalized };
    case "accent": {
      const updateSurface = mixRgb(canvas, onCanvas, dark ? 0.32 : 0.16);
      return {
        ...colors,
        accent: normalized,
        accentForeground: foregroundOn(onCanvas),
        focus: normalized,
        update: normalized,
        updateForeground: toneOn(updateSurface),
        updateSurface: rgbToCss(updateSurface),
        terminalCursor: normalized,
      };
    }
    case "messageAction": {
      const foreground = readableForeground(onCanvas);
      const toward = luminance(foreground) > 0.5 ? BLACK : WHITE;
      const hover = mixRgb(parsed, toward, 0.12);
      return {
        ...colors,
        messageAction: normalized,
        messageActionForeground: rgbToCss(foreground),
        messageActionHover: formatOklch(rgbToOklch(hover), parsed.a),
      };
    }
    case "codeBackground":
      return { ...colors, codeBackground: normalized, codeForeground: foregroundOn(onCanvas) };
    case "sidebar":
      return { ...colors, sidebar: normalized, sidebarForeground: foregroundOn(onCanvas) };
    case "sidebarRowSelected": {
      const sidebar = parseRgb(colors.sidebar, canvas);
      const onSidebar = selectedOn(sidebar);
      return {
        ...colors,
        sidebarRowHover: rgbToCss(mixRgb(sidebar, onSidebar, 0.5)),
        sidebarRowActive: rgbToCss(mixRgb(sidebar, onSidebar, 0.8)),
        sidebarRowSelected: normalized,
      };
    }
    case "error": {
      const { foreground, surface } = status();
      return { ...colors, error: normalized, errorForeground: foreground, errorSurface: surface };
    }
    case "warning": {
      const { foreground, surface } = status();
      return { ...colors, warning: normalized, warningForeground: foreground, warningSurface: surface };
    }
    default:
      return { ...colors, [role]: normalized };
  }
}

export type Hsv = { h: number; s: number; v: number };

/** `#rrggbb` to hue (0 to 360), saturation and value (0 to 1), for the colour picker. */
export function hexToHsv(hex: string): Hsv {
  const numeric = Number.parseInt(hex.slice(1, 7), 16);
  const r = ((numeric >> 16) & 255) / 255;
  const g = ((numeric >> 8) & 255) / 255;
  const b = (numeric & 255) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - chroma;
  const [r, g, b] =
    hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}
