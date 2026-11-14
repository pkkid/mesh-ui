/**
 * The titlebar bell (docs/ux/overview.md#notifications-bell): a dot when eero
 * says anything is unread, and a popover with the latest notifications. It
 * also runs the desktop alerts from the same poll.
 */
import { Popover } from "@base-ui/react/popover";
import { Bell as BellIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { NotificationList } from "./NotificationList";
import { useDesktopAlerts, useNotificationPage } from "./useDesktopAlerts";

export function Bell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { networkId, data, error } = useNotificationPage();
  useDesktopAlerts(networkId, data ?? null);
  const unread = data?.unread === true;
  const label = unread ? "Notifications, some unread" : "Notifications";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger title="Notifications" aria-label={label} className={cn(className, open && "bg-foreground/5 text-foreground")}>
        <BellIcon />
        {unread && <span className="absolute top-1.5 right-[7px] size-[7px] rounded-full bg-destructive ring-2 ring-background" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="no-drag w-[340px] rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            <NotificationList page={data} error={error !== null && !data} onClose={() => setOpen(false)} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
