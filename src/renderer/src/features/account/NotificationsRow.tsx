/**
 * Account, the Notifications row (docs/ux/pages/account.md,
 * Layout 2): one clickable row in the Account section with a summary of the
 * selected network's choices ("Desktop on · 6 of 9 alerts on") that opens
 * the notification settings sheet, the one place alerts are edited. The
 * `#/account/notifications` deep link opens the same sheet.
 */
import { BellRing, ChevronRight } from "lucide-react";

import { useQuery } from "~/app/useCommand";
import { notificationSummary, openNotificationSettings, useSelectedNetwork } from "~/features/notifications/NotificationSettings";
import { cn } from "~/lib/utils";
import type { NotificationSettings } from "../../../../core/model";

export function NotificationsRow({ id }: { id?: string }) {
  const networkId = useSelectedNetwork()?.id ?? null;
  const settings = useQuery<NotificationSettings>("notifications.settings.get", networkId ? { networkId } : undefined, { enabled: networkId !== null });
  const summary = settings.data ? notificationSummary(settings.data) : settings.error ? "Could not load notification settings" : "-";
  return (
    <button
      id={id}
      type="button"
      onClick={openNotificationSettings}
      className="-mx-4 flex w-[calc(100%+2rem)] cursor-pointer items-center gap-3 px-4 py-1.5 text-start outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">
        <BellRing />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-foreground/90 text-xs">Notifications</span>
        <span className={cn("block truncate text-2xs text-muted-foreground tabular-nums", settings.fading && "opacity-40")}>{summary}</span>
      </span>
      <span className="flex items-center gap-1 text-muted-foreground text-xs">
        Edit
        <ChevronRight className="size-4" />
      </span>
    </button>
  );
}
