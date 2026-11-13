/**
 * Overview "Recent activity": the latest three events, each linking to its
 * target. docs/ux/pages/overview.md (Layout 4).
 */
import {
  Ban,
  Bell,
  CalendarClock,
  Download,
  Gauge,
  type LucideIcon,
  PauseCircle,
  PlusCircle,
  Router,
  Thermometer,
  UserCog,
  Wifi,
  WifiOff,
} from "lucide-react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Card, Empty, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { cn } from "~/lib/utils";
import { formatRelative } from "../../../../core/format";
import type { EventCategory, EventPage, Network, NetworkEvent } from "../../../../core/model";

import { HeaderLink, PlaceholderRows, Row, RowList, SectionError, useNow } from "./OverviewView";

const TYPE_ICONS: Record<string, LucideIcon> = {
  device_new: PlusCircle,
  device_connected: Wifi,
  device_disconnected: WifiOff,
  device_paused: PauseCircle,
  device_blocked: Ban,
  profile_paused: PauseCircle,
  firmware_update_scheduled: CalendarClock,
};

const CATEGORY_ICONS: Record<EventCategory, LucideIcon> = {
  devices: Wifi,
  pause_block: PauseCircle,
  schedules: CalendarClock,
  eero_status: Router,
  speed_tests: Gauge,
  firmware: Download,
  admin: UserCog,
  ports_temperature: Thermometer,
  other: Bell,
};

/** Where an event's row goes: its device, eero or profile, Updates for firmware, else Activity. */
function target(e: NetworkEvent): string {
  if (e.refs.deviceId) return pathFor("device", { deviceId: e.refs.deviceId });
  if (e.refs.profileId) return pathFor("profile", { profileId: e.refs.profileId });
  if (e.refs.eeroId) return pathFor("eero", { eeroId: e.refs.eeroId });
  if (e.category === "firmware") return pathFor("updates");
  return pathFor("activity");
}

export function RecentActivity() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const events = useQuery<EventPage>("events.list", { limit: 3 }, { poll: true });
  const now = useNow();
  const tz = network.data?.timezone ?? "UTC";
  const list = events.data?.events ?? [];

  return (
    <Section title="Recent activity" tools={<HeaderLink to={pathFor("activity")}>All</HeaderLink>}>
      {events.error && !events.data ? (
        <SectionError what="recent activity" error={events.error} onRetry={() => void events.refetch()} />
      ) : !events.data ? (
        <PlaceholderRows count={3} />
      ) : list.length === 0 ? (
        <Card>
          <Empty>No recent activity.</Empty>
        </Card>
      ) : (
        <RowList className={cn("transition-opacity", events.fading && "opacity-40")}>
          {list.map((e) => (
            <Row key={e.id} to={target(e)} className="min-h-[50px]">
              <IconTile icon={TYPE_ICONS[e.type] ?? CATEGORY_ICONS[e.category]} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{e.title}</div>
                <div className="text-2xs text-muted-foreground">{formatRelative(e.at, now, tz)}</div>
              </div>
            </Row>
          ))}
        </RowList>
      )}
    </Section>
  );
}
