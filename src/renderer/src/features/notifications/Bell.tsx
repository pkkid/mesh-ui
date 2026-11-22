/**
 * The titlebar bell (docs/ux/overview.md#notifications-bell): a dot when eero
 * says anything is unread, and a popover with the latest notifications. It
 * also runs the desktop alerts from the same poll, and hosts the
 * notification settings sheet that the popover's gear (and any page) opens.
 */
import { Bell as BellIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { NotificationList } from "./NotificationList";
import { NotificationSettingsHost } from "./NotificationSettings";
import { useDesktopAlerts, useNotificationPage } from "./useDesktopAlerts";

export function Bell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { networkId, data, error } = useNotificationPage();
  useDesktopAlerts(networkId, data ?? null);
  const unread = data?.unread === true;
  const label = unread ? "Notifications, some unread" : "Notifications";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger title="Notifications" aria-label={label} className={cn(className, open && "bg-foreground/5 text-foreground")}>
          <BellIcon />
          {unread && <span className="absolute top-1.5 right-[7px] size-[7px] rounded-full bg-destructive ring-2 ring-background" />}
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-[340px] p-1">
          <NotificationList networkId={networkId} page={data} error={error !== null && !data} onClose={() => setOpen(false)} />
        </PopoverPopup>
      </Popover>
      <NotificationSettingsHost />
    </>
  );
}
