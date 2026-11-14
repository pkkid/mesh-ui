/**
 * Overview "Profiles": one row per profile with its initial in the profile's
 * series colour, today's usage or schedule, and state.
 * docs/ux/pages/overview.md (Layout 4).
 */
import { Plus } from "lucide-react";
import { useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Card, Empty, Section } from "~/components/ui/card";
import { GatedButton, HeaderLink, PlaceholderRows, Row, RowList, SectionError, useGate } from "~/components/ui/page";
import { PROFILE_GATE, ProfileSheet } from "~/features/profiles/ProfileCards";
import { Status, type StatusTone } from "~/components/ui/status";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes } from "../../../../core/format";
import type { Hhmm, Profile, ProfileList, UsageSeries } from "../../../../core/model";

const STATE: Record<Profile["state"], { tone: StatusTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  scheduled: { tone: "info", label: "Scheduled" },
  paused: { tone: "warning", label: "Paused" },
};

/** "21:00" as "9:00 PM". The times are already in the network time zone. */
function clock(hhmm: Hhmm): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const devices = (n: number) => `${n} ${n === 1 ? "device" : "devices"}`;

function detail(p: Profile, today: number | null | undefined): string {
  if (p.state === "paused") return `${devices(p.deviceIds.length)} paused`;
  if (p.state === "scheduled") {
    const s = p.schedules.find((x) => x.id === p.nextChange?.scheduleId) ?? p.schedules.find((x) => x.enabled);
    if (s) return `${s.name} ${clock(s.start)} to ${clock(s.end)}`;
  }
  return `${devices(p.deviceIds.length)} · ${formatBytes(today)} today`;
}

export function ProfilesList() {
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true });
  const usage = useQuery<UsageSeries[]>("usage.get", { scope: "profile", range: "day" }, { poll: true });

  const list = profiles.data?.profiles ?? [];
  const colors = entityColors(list.map((p) => p.id));
  const today = new Map((usage.data ?? []).map((s) => [s.id, s.todaySoFar]));
  const [adding, setAdding] = useState(false);
  const createGate = useGate({ ...PROFILE_GATE, op: "create" });

  return (
    <Section title="Profiles" tools={<HeaderLink to={pathFor("profiles")}>Manage</HeaderLink>}>
      {profiles.error && !profiles.data ? (
        <SectionError what="profiles" error={profiles.error} onRetry={() => void profiles.refetch()} />
      ) : !profiles.data ? (
        <PlaceholderRows count={4} />
      ) : list.length === 0 ? (
        <Card>
          <Empty className="flex flex-col items-center gap-3">
            <span>No profiles yet. Group devices by person to pause them together.</span>
            <GatedButton gate={createGate} size="xs" variant="outline" onClick={() => setAdding(true)}>
              <Plus />
              Add a profile
            </GatedButton>
            <ProfileSheet mode={adding ? { kind: "create" } : null} onClose={() => setAdding(false)} />
          </Empty>
        </Card>
      ) : (
        <RowList className={cn("transition-opacity", profiles.fading && "opacity-40")}>
          {list.map((p) => {
            const state = STATE[p.state];
            return (
              <Row key={p.id} to={pathFor("profile", { profileId: p.id })}>
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-full font-semibold text-background text-xs"
                  style={{ backgroundColor: colors[p.id] ?? seriesColors.neutral }}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[13.5px]">{p.name}</div>
                  <div className="text-muted-foreground text-xs">{detail(p, today.get(p.id))}</div>
                </div>
                <Status tone={state.tone}>{state.label}</Status>
              </Row>
            );
          })}
        </RowList>
      )}
    </Section>
  );
}
