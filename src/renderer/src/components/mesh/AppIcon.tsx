/**
 * The Mesh UI mark inside the app (sidebar, Settings & Account, sign-in),
 * drawn in the theme's colours: a quiet tile in `--color-app-icon` and the
 * three nodes in `--color-app-icon-foreground` (index.css), so it follows
 * every theme, light and dark, without standing out. The shapes are
 * build/icon.svg's (the launcher icon, which keeps its own fixed Gruvbox
 * colours and gradients); here they are flat, as the app's restrained-colour
 * rule asks. Size it with a `size-*` class.
 */
import { cn } from "~/lib/utils";

/** The tile (a squircle on a 256 canvas, spanning 6..250 by 12..240). */
const TILE = "m165 12c72 0 85 15 85 87v56c0 70-13 85-85 85h-74c-72 0-85-15-85-85v-56c0-72 13-87 85-87z";
/** The node graph: a triangle with a centre node joined to each corner. */
const EDGES = "M128 68.46 70.96 182.54 185.04 182.54ZM128 68.46 128 146.58M70.96 182.54 128 146.58 185.04 182.54";
const NODES = [
  { cx: 128, cy: 68.46, r: 24.8 },
  { cx: 70.96, cy: 182.54, r: 24.8 },
  { cx: 185.04, cy: 182.54, r: 24.8 },
  { cx: 128, cy: 146.58, r: 16.12 },
];

export function AppIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="6 4 244 244"
      className={cn("inline-block shrink-0 text-app-icon-foreground", className)}
    >
      <path d={TILE} className="fill-app-icon" />
      <path d={EDGES} fill="none" stroke="currentColor" strokeWidth="11.16" strokeLinecap="round" strokeLinejoin="round" />
      {NODES.map((n) => (
        <circle key={n.cx * 1000 + n.cy} cx={n.cx} cy={n.cy} r={n.r} fill="currentColor" />
      ))}
    </svg>
  );
}
