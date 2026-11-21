/**
 * The anchor a page section or settings row renders with (`data-place`) and
 * the search palette's Places index jumps to: its title, lower case, with
 * anything but letters and digits as single dashes ("Optimize for
 * conferencing and gaming (SQM)" is `optimize-for-conferencing-and-gaming-sqm`).
 * One function for the build-time scanner (scripts/places.ts) and the
 * components (Section, settings Row), so the two always agree.
 */
export function placeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
