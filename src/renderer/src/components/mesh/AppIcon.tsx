/**
 * The Mesh UI app icon, the same build/icon.svg the launchers are made from,
 * so the in-app mark always matches the dock, taskbar and Start menu icon.
 *
 * The SVG is a 256 canvas whose box (Gruvbox Plus app-icon shape) spans
 * 6..250 across; the image is drawn 256/244 of the box size and shifted so
 * the box fills the element. Size it with a `size-*` class.
 */
import iconUrl from "../../../../../build/icon.svg";
import { cn } from "~/lib/utils";

export function AppIcon({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-block shrink-0 overflow-hidden", className)}>
      <img src={iconUrl} alt="" draggable={false} className="absolute -top-[2.459%] -left-[2.459%] size-[104.918%] max-w-none select-none" />
    </span>
  );
}
