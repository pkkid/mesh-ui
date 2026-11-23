/**
 * Account, the Notifications row (docs/ux/pages/account.md, Layout 2): a
 * settings row in Email and alerts with the selected network's choices
 * ("Desktop on · 6 of 9 alerts on") and Edit…, which opens the notification
 * settings sheet, the one place alerts are edited. The
 * `#/account/notifications` deep link opens the same sheet.
 */
import { BellRing } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { openNotificationSettings } from "~/features/notifications/NotificationSettings";

export function NotificationsRow({ id, summary, error }: { id?: string; summary: string | null; error: boolean }) {
  return (
    <div id={id}>
      <SettingsRow
        title="Notifications"
        description={summary ?? (error ? "Could not load notification settings." : "Desktop alerts and eero's push alerts for this network.")}
        control={
          <Button variant="outline" onClick={openNotificationSettings}>
            <BellRing />
            Edit{"\u2026"}
          </Button>
        }
      />
    </div>
  );
}
