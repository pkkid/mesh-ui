/**
 * The bell popover's content (docs/ux/overview.md#notifications-bell): up to
 * 8 notifications newest first, each with an icon, its title and body on one
 * line each, a relative time and an unread marker, then the footer. "Mark all
 * read" (`notifications.mark_read`) clears eero's network-wide unread flag;
 * Activity's event stream uses the same control (MarkAllReadButton).
 */
import { Bell, Globe, MonitorSmartphone, Router, Settings, Users } from "lucide-react";
import type { ComponentType } from "react";

import { Link } from "~/app/router";
import { routeById } from "~/app/routes";
import { useWrite } from "~/app/useWrite";
import { GatedButton, useGate } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import { unreadCount } from "../../../../core/commands/notifications";
import { formatRelative } from "../../../../core/format";
import type { Notification, NotificationPage } from "../../../../core/model";
import { notificationPath } from "./useDesktopAlerts";

export const MAX_ITEMS = 8;

/**
 * Mark all read for one network. Not undoable (eero cannot mark anything
 * unread), so the toast has no Undo. Gated like the palette gates it
 * (`network` update permission); `idle` when nothing is unread.
 */
export function useMarkAllRead(networkId: string | null, page: NotificationPage | undefined) {
  const write = useWrite("notifications.mark_read", { success: "Marked all read" });
  const gate = useGate({ area: "network", op: "update" });
  const idle = !networkId || page?.unread !== true;
  return {
    gate,
    running: write.running,
    disabled: idle || write.running,
    title: idle ? "Nothing unread" : undefined,
    run: () => (networkId ? write.run({ networkId }) : undefined),
  };
}

/** The Activity event stream's Mark all read, beside its Unread marker. */
export function MarkAllReadButton({ networkId, page }: { networkId: string | null; page: NotificationPage | undefined }) {
  const mark = useMarkAllRead(networkId, page);
  return (
    <GatedButton gate={mark.gate} size="xs" variant="outline" disabled={mark.disabled} title={mark.title} onClick={() => void mark.run()}>
      Mark all read
    </GatedButton>
  );
}

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  device: MonitorSmartphone,
  eero: Router,
  network: Globe,
  profile: Users,
};

function Item({ n, now, onOpen }: { n: Notification; now: number; onOpen: () => void }) {
  const Icon = (n.category && ICONS[n.category]) || Bell;
  return (
    <Link
      to={notificationPath(n)}
      onClick={onOpen}
      className="flex items-start gap-2.5 rounded-lg px-2 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
    >
      <span className="mt-px grid size-6 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground [&_svg]:size-3.5">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-xs", n.read ? "text-foreground/80" : "font-medium text-foreground")}>{n.title}</span>
        {n.body && <span className="block truncate text-2xs text-muted-foreground">{n.body}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 pt-px text-2xs text-muted-foreground tabular-nums">
        {formatRelative(n.at, now)}
        <span aria-label={n.read ? undefined : "Unread"} className={cn("size-1.5 rounded-full", n.read ? "bg-transparent" : "bg-info")} />
      </span>
    </Link>
  );
}

type Props = { networkId: string | null; page: NotificationPage | undefined; error: boolean; onClose: () => void };

export function NotificationList({ networkId, page, error, onClose }: Props) {
  const mark = useMarkAllRead(networkId, page);
  const now = Date.now();
  const items = page?.notifications.slice(0, MAX_ITEMS) ?? [];
  const count = page ? unreadCount(page) : 0;
  const summary = !page ? null : count > 0 ? `${count} unread` : page.unread ? "Unread" : "All read";

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between px-2.5 pt-1.5 pb-1">
        <span className="font-medium text-foreground text-sm">Notifications</span>
        {summary && <span className="text-2xs text-muted-foreground">{summary}</span>}
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {items.length > 0 ? (
          items.map((n) => <Item key={n.id} n={n} now={now} onOpen={onClose} />)
        ) : (
          <p className="px-2.5 py-6 text-center text-muted-foreground text-xs">
            {error ? "Could not load notifications." : page ? "No notifications yet." : "Loading notifications."}
          </p>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1 border-t px-1 pt-1">
        <span title={mark.gate.reason ?? mark.title} className="inline-flex">
          <button
            type="button"
            disabled={mark.disabled || !mark.gate.allowed}
            onClick={() => void mark.run()}
            className="rounded-lg px-2 py-1.5 text-muted-foreground text-xs hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:text-muted-foreground/60"
          >
            Mark all read
          </button>
        </span>
        <Link
          to={routeById("activity").path}
          onClick={onClose}
          className="ms-auto rounded-lg px-2 py-1.5 text-muted-foreground text-xs hover:bg-muted/60 hover:text-foreground"
        >
          All activity
        </Link>
        <Link
          to={routeById("account").path}
          onClick={onClose}
          title="Notification settings"
          aria-label="Notification settings"
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground [&_svg]:size-3.5"
        >
          <Settings />
        </Link>
      </div>
    </div>
  );
}
