/**
 * The runtime side of Places (docs/ux/overview.md, Command palette, Places):
 * the `data-place` anchor a section or settings row renders from its title,
 * and jumping to one after the palette opens its page.
 */
import { isValidElement, type ReactNode } from "react";

import { placeSlug } from "@shared/places";

/**
 * The first text in a title, as the build-time scanner reads it: "DNS", or
 * "Legacy mode" from `<>Legacy mode{legacy && <Status/>}</>`.
 */
export function titleText(node: ReactNode): string | null {
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    for (const n of node) {
      const t = titleText(n);
      if (t) return t;
    }
    return null;
  }
  if (isValidElement(node)) return titleText((node.props as { children?: ReactNode }).children);
  return null;
}

/** The `data-place` value for a title, or undefined when it has no text. */
export function placeAnchor(title: ReactNode): string | undefined {
  const t = titleText(title);
  return t ? placeSlug(t) || undefined : undefined;
}

/** How long a jump waits for the page (and its data) to draw the place, and how long the highlight shows. */
const WAIT_MS = 4000;
const FLASH_MS = 1800;

/**
 * Once the page has drawn the element with `data-place={anchor}`, scrolls its
 * section to the top of the view (a section, or the section a setting is in)
 * and briefly brightens the place itself so the eye finds it. Gives up quietly after
 * a few seconds (the place is not on this network after all).
 */
export function revealPlace(anchor: string): void {
  const started = Date.now();
  const tick = () => {
    const el = document.querySelector<HTMLElement>(`[data-place="${CSS.escape(anchor)}"]`);
    // Only the page's own scrolling column moves (as the router's scrollToSection): scrollIntoView would scroll the
    // whole window too and shift the app shell.
    const column = el?.closest<HTMLElement>("[data-page-scroll]");
    if (!el || !column) {
      if (Date.now() - started < WAIT_MS) setTimeout(tick, 100);
      return;
    }
    // The view always goes to the section: a section itself, or the section a setting sits in, starts at the top
    // (22px down, as the router's scrollToSection). Only the place itself is highlighted.
    const section = el.matches("section[data-slot=section]") ? el : (el.closest<HTMLElement>("section[data-slot=section]") ?? el);
    const view = column.getBoundingClientRect();
    const at = (n: HTMLElement) => n.getBoundingClientRect().top - view.top + column.scrollTop;
    let target = at(section) - 22;
    // A setting far down a long section would land below the view: then it goes a third of the way down instead.
    const box = el.getBoundingClientRect();
    if (box.bottom - view.top + column.scrollTop - target > view.height - 24) target = at(el) - view.height / 3;
    column.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    el.setAttribute("data-place-flash", "");
    setTimeout(() => el.removeAttribute("data-place-flash"), FLASH_MS);
  };
  setTimeout(tick, 50);
}
