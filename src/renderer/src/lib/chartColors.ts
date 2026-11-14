/**
 * One colour per kind of series, used by every chart, legend, dot and bar
 * for that thing. Values are CSS custom properties that `themes.ts` sets
 * from the active theme's series palette (`themePalettes.ts`), so each one
 * has a light and a dark value and follows theme changes without re-render.
 * Never pick a colour inline. See docs/design/design-system.md#series-colours.
 */
import type { Band, Effect } from "../../../core/model";
import type { SeriesHue } from "./themePalettes";

/** A CSS colour for a hue of the active theme's series palette. */
export const hue = (name: SeriesHue): string => `var(--series-${name})`;

/** Fixed series kinds. */
export const seriesColors = {
  download: hue("blue"),
  upload: hue("purple"),
  band24: hue("yellow"),
  band5: hue("blue"),
  band6: hue("purple"),
  wired: hue("aqua"),
  /** Neutral or "other": a mix of the text colour with the background. */
  neutral: "color-mix(in srgb, var(--color-foreground) 40%, var(--color-background))",
} as const;

export type SeriesKind = keyof typeof seriesColors;

/** The colour for a band, including wired (ethernet). */
export function bandColor(band: Band): string {
  switch (band) {
    case "2.4":
      return seriesColors.band24;
    case "5":
      return seriesColors.band5;
    case "6":
      return seriesColors.band6;
    case "wired":
      return seriesColors.wired;
  }
}

/** Order for entities that each get their own colour (eeros, profiles). */
export const ENTITY_HUES: ReadonlyArray<SeriesHue> = ["blue", "purple", "aqua", "orange", "yellow", "green"];

/** The colour for the n-th entity in a list, cycling through ENTITY_HUES. */
export function entityColor(index: number): string {
  const n = ENTITY_HUES.length;
  return hue(ENTITY_HUES[((index % n) + n) % n] ?? "blue");
}

/**
 * Colours for a set of entities (eeros, profiles), stable per id: ids are
 * sorted before assignment, so an entity keeps its colour across pages and
 * re-orderings of the same set.
 */
export function entityColors(ids: ReadonlyArray<string>): Record<string, string> {
  const sorted = [...new Set(ids)].sort();
  return Object.fromEntries(sorted.map((id, i) => [id, entityColor(i)]));
}

/** Command effect badges (palette, App & account): a dot in a fixed colour on a neutral badge. */
export const effectColors: Readonly<Record<Effect, string>> = {
  query: hue("aqua"),
  write: hue("blue"),
  disruptive: hue("yellow"),
  destructive: hue("red"),
};

/** LAN address map (Reservations & ports): one colour per kind of address, in the map, its range bar and legend. */
export const lanColors = {
  gateway: hue("purple"),
  staticRange: "color-mix(in srgb, var(--series-orange) 40%, var(--color-card))",
  reserved: hue("aqua"),
  leased: hue("blue"),
  free: "color-mix(in srgb, var(--series-blue) 22%, var(--color-card))",
  /** Network and broadcast addresses: not usable. */
  none: "color-mix(in srgb, var(--color-foreground) 8%, var(--color-card))",
} as const;
