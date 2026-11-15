/**
 * App & account, Notifications (docs/ux/pages/app-account.md, Layout 3).
 * Skeleton from M6.1; M6.7 adds the alert switches. Activity's settings icon
 * opens it at `#/account/notifications`.
 */
import { Card, Section } from "~/components/ui/card";

export function AccountNotifications({ id }: { id?: string }) {
  return (
    <Section id={id} title="Notifications" subtitle="Shown in the bell and as desktop notifications">
      <Card padded className="text-muted-foreground text-xs">
        Alerts for this network and the eero app on your phone.
      </Card>
    </Section>
  );
}
