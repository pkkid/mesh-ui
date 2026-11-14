/**
 * Eco efficiency: the power saving switch and its schedules on the shared
 * week timeline (components/ui/timeline.tsx), with one line per schedule.
 * Adding and editing schedules come later; the buttons are disabled.
 * docs/ux/pages/advanced-networking.md (Network services), mockup 13.
 */
import { Leaf } from "lucide-react";

import { ComingSoonButton, useNow } from "~/components/ui/page";
import { formatMinute, WeekTimeline, type WeekSchedule } from "~/components/ui/timeline";
import { seriesColors } from "~/lib/chartColors";
import { networkClock } from "../../../../core/format";
import type { Day, NetworkSettings, Schedule } from "../../../../core/model";

import { ReadSwitch, Row, SubPanel } from "./SettingsGroups";

const DAY_INDEX: Record<Day, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "Every day", "Mon to Fri", "Sat, Sun". */
export function daysLabel(days: ReadonlyArray<Day>): string {
  const idx = [...new Set(days.map((d) => DAY_INDEX[d]))].sort((a, b) => a - b);
  if (idx.length === 7) return "Every day";
  if (idx.length === 0) return "No days";
  const run = idx.every((d, i) => i === 0 || d === (idx[i - 1] ?? 0) + 1);
  if (run && idx.length >= 3) return `${DAY_SHORT[idx[0] ?? 0]} to ${DAY_SHORT[idx[idx.length - 1] ?? 0]}`;
  return idx.map((d) => DAY_SHORT[d]).join(", ");
}

const toWeek = (s: Schedule): WeekSchedule => ({
  id: s.id,
  label: s.name,
  color: seriesColors.powerSaving,
  icon: <Leaf />,
  days: s.days.map((d) => DAY_INDEX[d]),
  start: minutes(s.start),
  end: minutes(s.end),
  enabled: s.enabled,
});

export function PowerSaving({ settings, timezone, loading }: { settings: NetworkSettings | undefined; timezone: string | null; loading: boolean }) {
  const now = useNow(60_000);
  const ps = settings?.powerSaving;
  const schedules = ps?.schedules ?? [];
  const clock = networkClock(timezone);
  const parts = clock.parts(now);
  const minute = parts.hour * 60 + Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone ?? "UTC", minute: "numeric" }).format(now));
  const unsupported = settings !== undefined && ps?.enabled === null && ps.scheduleEnabled === null;

  return (
    <>
      <Row title="Eco efficiency" description="Use less power when nobody needs full speed" dim={unsupported} control={<ReadSwitch on={ps?.enabled} label="Eco efficiency" />} />
      <Row
        title="Power saving schedule"
        description="Radios drop to 1x1 and LEDs turn green. Wi-Fi blips for up to 5 seconds when it starts."
        dim={unsupported}
        control={<ReadSwitch on={ps?.scheduleEnabled} label="Power saving schedule" />}
      >
        {!unsupported && (
          <SubPanel className="flex flex-col gap-3">
            {schedules.length === 0 ? (
              <span className="text-muted-foreground text-xs">{settings ? "No power saving schedules yet." : " "}</span>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {schedules.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: seriesColors.powerSaving }} aria-hidden />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">
                      {daysLabel(s.days)} · {formatMinute(minutes(s.start))} to {formatMinute(minutes(s.end))}
                      {s.enabled ? "" : " · off"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <WeekTimeline
              schedules={schedules.map(toWeek)}
              today={settings ? parts.weekday : null}
              now={settings ? minute : null}
              loading={loading}
              ariaLabel={`Power saving schedules across the week: ${schedules.length === 0 ? "none" : schedules.map((s) => `${s.name}, ${daysLabel(s.days)}, ${s.start} to ${s.end}${s.enabled ? "" : ", off"}`).join("; ")}`}
            />
            <div>
              <ComingSoonButton size="xs" variant="outline">
                Add schedule
              </ComingSoonButton>
            </div>
          </SubPanel>
        )}
      </Row>
    </>
  );
}
