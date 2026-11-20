/**
 * The page loading mark: the app icon without its tile, in a solid colour a
 * shade off the background (`watermark`, no transparency), centred in the
 * page area, with "Loading…" for screen readers only. `RouterOutlet`
 * shows it for the whole of a page switch; it fades in over 1.5 s, so quick
 * switches never show it. No animation; a quiet background, not a spinner.
 * See docs/architecture/ui.md#page-transitions.
 */
import { AppIcon } from "~/components/mesh/AppIcon";
import { cn } from "~/lib/utils";

export function PageLoading({ visible }: { visible: boolean }) {
  return (
    <div
      role="status"
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-[6vh] transition-opacity",
        // Starts with the switch but fades in over 1.5 s, easing in, so a quick
        // switch ends before it shows; out quickly as the page fades in.
        visible ? "opacity-100 duration-1500 ease-in" : "opacity-0 duration-200 ease-out",
      )}
    >
      <AppIcon tile={false} className="size-20 text-watermark" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
