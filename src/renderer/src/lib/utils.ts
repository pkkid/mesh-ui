import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// Register custom font sizes so tailwind-merge does not treat text-2xs as a color.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["2xs", "3xs"] } },
});

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

/** True while the user has text selected: a clickable row ignores the click that ends a drag-select, so copying a value does not open it. */
export function hasTextSelection(): boolean {
  const sel = window.getSelection();
  return sel !== null && !sel.isCollapsed && sel.toString().trim() !== "";
}
