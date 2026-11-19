/**
 * Device detail "Device settings" (docs/ux/pages/device-detail.md, Layout 3):
 * settings rows in one card at the bottom of the page, like eero detail's
 * "eero settings". Appearance has the name right on the row (like eero's
 * Location: Enter or blur saves `device.rename` with Undo, Escape cancels,
 * an empty field follows the device's own name again) and an icon button
 * that opens the icon sheet (`device.type.set`); Profile picks the device's
 * profile from a menu
 * (`device.profile.set`, Undo toast). Profile is left out for guests and in
 * bridge mode, and dims with the reason while the device is blocked. Controls
 * dim by permission.
 */
import { ChevronDown, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useQuery } from "~/app/useCommand";
import { performWrite, useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, Section } from "~/components/ui/card";
import { GatedButton, useGate } from "~/components/ui/page";
import { ProfileMenu, profileRequest } from "~/features/devices/BulkBar";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { entityColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import type { Device, ProfileList } from "../../../../core/model";

import { IconSheet, typeLabel } from "./DeviceHero";
import type { DeviceView } from "./DevicePage";

export function DeviceSettings({ view }: { view: DeviceView }) {
  const d = view.device;
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true, enabled: !view.bridged });
  const editGate = useGate({ area: "devices" });
  const gate = useGate({ area: "devices", bridgeOff: true });
  const [iconOpen, setIconOpen] = useState(false);

  const list = profiles.data?.profiles ?? [];
  const colors = entityColors(list.map((p) => p.id));
  const profile = d?.profileId ? list.find((p) => p.id === d.profileId) : undefined;
  const showProfile = !view.bridged && !view.guest;
  const profileName = profile?.name ?? (d && !d.profileId ? "Unassigned" : null);
  const profileGate = d?.blocked ? { allowed: false, reason: `Unblock ${d.name} to change its profile` } : gate;

  // "Named Kitchen Echo, smart speaker, in Alex": what the settings are set to now.
  const description = d
    ? [`Named ${d.name}`, d.type === "generic" ? null : typeLabel(d.type).toLowerCase(), showProfile && profileName ? (profile ? `in ${profile.name}` : "no profile") : null]
        .filter(Boolean)
        .join(", ")
    : "-";

  const profileButton = (
    <GatedButton gate={d ? profileGate : { allowed: false, reason: null }} variant="outline" size="sm">
      <UserRound />
      {profileName ?? "-"}
      <ChevronDown />
    </GatedButton>
  );

  return (
    <Section title="Device settings" description={description} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        <AppearanceRow device={d} gate={d ? editGate : { allowed: false, reason: null }} onIcon={() => setIconOpen(true)} />
        {showProfile && (
          <SettingsRow
            title="Profile"
            description="Pauses, schedules and usage for this device follow its profile."
            control={
              d && profileGate.allowed ? (
                <ProfileMenu
                  profiles={list.map((p) => ({ id: p.id, name: p.name, color: colors[p.id] }))}
                  current={d.profileId}
                  onPick={(p) => void performWrite(profileRequest([d], p))}
                  trigger={profileButton}
                />
              ) : (
                profileButton
              )
            }
          />
        )}
      </Card>
      {d && <IconSheet key={`${d.id}:${iconOpen}`} device={d} open={iconOpen} onClose={() => setIconOpen(false)} />}
    </Section>
  );
}

/**
 * Appearance: the nickname in a field on the row, and the icon as a button
 * beside it. The field shows the nickname, with the device's own name as the
 * placeholder, so clearing it reads as "follow its own name".
 */
function AppearanceRow({ device: d, gate, onIcon }: { device: Device | undefined; gate: { allowed: boolean; reason: string | null }; onIcon: () => void }) {
  const nickname = d?.nickname ?? "";
  const rename = useWrite<{ device: string; nickname: string }, Device>("device.rename", { form: true });
  const [draft, setDraft] = useState(nickname);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(nickname), [nickname]);

  const save = async () => {
    const next = draft.trim();
    if (!d || !gate.allowed || next === nickname) {
      setDraft(nickname);
      return;
    }
    const r = await rename.run(
      { device: d.id, nickname: next },
      {
        success: next ? `Renamed to ${next}` : `${d.name} follows its own name again`,
        undo: { id: "device.rename", params: { device: d.id, nickname } },
      },
    );
    if (!r?.ok) setDraft(nickname);
  };
  const error = rename.error?.code === "bad_params" ? rename.error.message : null;
  const Icon = deviceIcon(d);
  const own = d ? (d.hostname ?? d.name) : "";

  return (
    <SettingsRow
      title="Appearance"
      description="The name and icon shown for this device everywhere in Mesh UI and the eero app. Leave the name empty to use the device's own."
      control={
        <>
          {/* Icon only, so the ellipsis ("asks first": it opens the icon sheet) is in its name and tooltip. */}
          <span title={gate.allowed ? "Change icon…" : (gate.reason ?? undefined)} className="inline-flex">
            <Button variant="outline" size="icon" aria-label="Change icon…" disabled={!gate.allowed} onClick={onIcon}>
              <Icon />
            </Button>
          </span>
          <span title={gate.reason ?? undefined} className="inline-flex w-56">
            <Input
              ref={input}
              aria-label="Name"
              value={draft}
              placeholder={own}
              disabled={!gate.allowed || rename.running}
              maxLength={32}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void save()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setDraft(nickname);
                  requestAnimationFrame(() => input.current?.blur());
                }
              }}
              // 32px outside, border and all, to match the icon button beside it.
              className="truncate disabled:cursor-not-allowed [&_input]:h-[30px]"
            />
          </span>
        </>
      }
    >
      {error && <div className="text-destructive-foreground text-xs">{error}</div>}
    </SettingsRow>
  );
}
