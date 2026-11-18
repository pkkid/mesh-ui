/**
 * Overview "Top profiles": the three profiles that used the most data in the
 * last 24 hours (`usage.get {scope: "profile", range: "day"}`), each with its
 * initial in the profile's series colour, that same 24-hour total, and state.
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

const TOP = 3;

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

/** The state part of the detail line, then the 24-hour total the rows are ranked by. */
function detail(p: Profile, used: number | undefined): string {
  let what = devices(p.deviceIds.length);
  if (p.state === "paused") what = `${what} paused`;
  if (p.state === "scheduled") {
    const s = p.schedules.find((x) => x.id === p.nextChange?.scheduleId) ?? p.schedules.find((x) => x.enabled);
    if (s) what = `${s.name} ${clock(s.start)} to ${clock(s.end)}`;
  }
  return `${what} · ${formatBytes(used)}`;
}

export function ProfilesList() {
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true });
  const usage = useQuery<UsageSeries[]>("usage.get", { scope: "profile", range: "day" }, { poll: true });

  const list = profiles.data?.profiles ?? [];
  const colors = entityColors(list.map((p) => p.id));
  const used = new Map((usage.data ?? []).map((s) => [s.id, s.total.down + s.total.up]));
  // Rank by the same 24-hour total each row shows. Profiles without usage sort last.
  const top = [...list].sort((a, b) => (used.get(b.id) ?? -1) - (used.get(a.id) ?? -1)).slice(0, TOP);
  // Wait for usage too, so the order does not jump; if usage fails, show list order with "-".
  const loading = !usage.data && !usage.error;
  const [adding, setAdding] = useState(false);
  const createGate = useGate({ ...PROFILE_GATE, op: "create" });

  return (
    <Section
      title="Top profiles"
      subtitle="Last 24 hours"
      tools={
        <HeaderLink to={pathFor("profiles")} arrow className="font-normal">
          All profiles
        </HeaderLink>
      }
    >
      {profiles.error && !profiles.data ? (
        <SectionError what="profiles" error={profiles.error} onRetry={() => void profiles.refetch()} />
      ) : !profiles.data ? (
        <PlaceholderRows count={TOP} />
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
      ) : loading ? (
        <PlaceholderRows count={TOP} />
      ) : (
        <RowList className={cn("transition-opacity", (profiles.fading || usage.fading) && "opacity-40")}>
          {top.map((p) => {
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
                  <div className="text-muted-foreground text-xs">{detail(p, used.get(p.id))}</div>
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
