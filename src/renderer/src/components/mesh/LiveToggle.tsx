/**
 * The Live switch (#319) with a pulse icon, like the eero app's live usage
 * view. Turning it on lets views ask eero for live rates; it is one shared
 * setting (`useLiveMode`). Neutral button; a status dot shows while it is on.
 */
import { Activity } from "lucide-react";

import { LIVE_AUTO_OFF_MIN, useLiveMode } from "~/app/useLiveMode";
import { Button } from "~/components/ui/button";
import { StatusDot } from "~/components/ui/status";
import { cn } from "~/lib/utils";

export function LiveToggle({ size, className }: { size?: "xs" | "tool"; className?: string }) {
  const [live, setLive] = useLiveMode();
  return (
    <Button
      variant="outline"
      size={size}
      aria-pressed={live}
      title={live ? `Live rates on. Turns off after ${LIVE_AUTO_OFF_MIN} minutes.` : "Show live rates (asks eero for live reporting while on)"}
      onClick={() => setLive(!live)}
      className={cn(live && "bg-accent dark:bg-accent", className)}
    >
      <Activity />
      Live
      {live && <StatusDot tone="success" />}
    </Button>
  );
}
