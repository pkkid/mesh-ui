/**
 * Sizes `--titlebar-inset-right` from the native window controls overlay
 * (Windows and Linux `titleBarOverlay`) instead of a fixed guess. The
 * controls differ per desktop (a Linux theme may show only minimise and
 * close), so a constant leaves a gap or overlaps them. index.css keeps 140px
 * as the fallback for when the overlay API is missing or not visible.
 */

interface Rect {
  x: number;
  width: number;
}

interface ControlsOverlay extends EventTarget {
  visible: boolean;
  getTitlebarAreaRect(): Rect;
}

/**
 * Pixels the overlay covers at the right edge, or null when the rect does not
 * describe a usable titlebar area (overlay hidden, window not laid out yet).
 */
export function rightInset(area: Rect, windowWidth: number): number | null {
  if (!(area.width > 0) || !(windowWidth > 0)) return null;
  const inset = Math.round(windowWidth - (area.x + area.width));
  return inset >= 0 && inset < windowWidth ? inset : null;
}

/** Keeps the CSS variable in step with the overlay; a no-op where it is absent. */
export function trackTitlebarInset(root: HTMLElement = document.documentElement): void {
  const overlay = (navigator as { windowControlsOverlay?: ControlsOverlay }).windowControlsOverlay;
  if (!overlay || typeof overlay.getTitlebarAreaRect !== "function") return;
  const update = () => {
    const inset = overlay.visible ? rightInset(overlay.getTitlebarAreaRect(), window.innerWidth) : null;
    if (inset === null) root.style.removeProperty("--titlebar-inset-right");
    else root.style.setProperty("--titlebar-inset-right", `${inset}px`);
  };
  overlay.addEventListener("geometrychange", update);
  window.addEventListener("resize", update);
  update();
}
