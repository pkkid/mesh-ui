/**
 * The Live switch (#319) with a pulse icon, like the eero app's live usage
 * view, in the topbar on every page. Turning it on lets views ask eero for
 * live rates on every page (LiveCollector), shown on Devices and device
 * detail; it is one shared setting
 * (`useLiveMode`). Neutral button; a status dot shows while it is on,
 * and the tooltip counts down to when Live turns itself off.
 */
import { Activity } from "lucide-react";

import { liveOffAt, useLiveMode } from "~/app/useLiveMode";
import { Button } from "~/components/ui/button";
import { useNow } from "~/components/ui/page";
import { StatusDot } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatCountdown } from "../../../../core/format";

export function LiveToggle({ size, className }: { size?: "xs" | "tool"; className?: string }) {
  const [live, setLive] = useLiveMode();
  // Ticks every second so the tooltip's countdown stays current (the title tooltip follows changes).
  const now = useNow(1000);
  const left = liveOffAt();
  return (
    <Button
      variant="outline"
      size={size}
      aria-pressed={live}
      title={
        live && left !== null
          ? `Live rates on, shown on the Devices page. Turns off in ${formatCountdown(Math.max(0, (left - now) / 1000))}.`
          : "Show live rates on the Devices page (asks eero for live reporting while on)"
      }
      onClick={() => setLive(!live)}
      className={cn(live && "bg-accent dark:bg-accent", className)}
    >
      <Activity />
      Live
      {live && <StatusDot tone="success" />}
    </Button>
  );
}
