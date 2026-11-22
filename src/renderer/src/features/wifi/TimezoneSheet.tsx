/**
 * The time zone sheet behind Wi-Fi > Nickname and location > Edit: one select
 * of IANA zones (this runtime's list, plus the current zone if it is
 * missing), the local time there, and core's `settings.impact` for the
 * change. Save runs `settings.timezone.set` through the write kit. It is
 * `disruptive` (every schedule shifts), so Save always asks in a confirm over
 * the sheet with core's message, which names any devices a schedule takes
 * offline right away; the toast's Undo sets the old zone back.
 * docs/ux/pages/wifi.md (Nickname and location).
 */
import { useEffect, useMemo, useState } from "react";

import { fieldErrors, useWrite } from "~/app/useWrite";
import { WriteConfirmDialog } from "~/components/ui/confirm";
import { useNow } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { ImpactPanel } from "~/features/advanced/ImpactPanel";
import { networkClock } from "../../../../core/format";
import type { NetworkSettings } from "../../../../core/model";

const ID = "settings.timezone.set";

/** Every IANA zone this runtime knows, A to Z, with `current` added if it is missing. */
export function timeZoneOptions(current: string | null): string[] {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add("UTC");
  if (current) zones.add(current);
  return [...zones].sort((a, b) => a.localeCompare(b));
}

export function TimezoneSheet({ open, onClose, current }: { open: boolean; onClose: () => void; current: string | null }) {
  const [tz, setTz] = useState(current ?? "");
  useEffect(() => {
    if (open) setTz(current ?? "");
  }, [open]);
  const zones = useMemo(() => timeZoneOptions(current), [current]);
  const now = useNow(30_000);
  const save = useWrite<{ timezone: string }, NetworkSettings>(ID, {
    success: (r) => `Time zone set to ${r.timezone ?? tz}`,
    undo: current ? { id: ID, params: { timezone: current }, success: `Time zone set back to ${current}`, confirm: { title: "Change the time zone back?", confirmLabel: "Change time zone" } } : undefined,
    form: true,
    confirmIn: "nested",
    confirm: { title: "Change the time zone?", confirmLabel: "Change time zone" },
  });
  const errors = fieldErrors(save.error);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Time zone"
      subtitle="Profile schedules, power saving and updates follow it"
      dirty={tz !== "" && tz !== current}
      onSave={() => save.run({ timezone: tz })}
      saves={[ID]}
      error={errors._form}
    >
      <SheetField label="Time zone" htmlFor="timezone-sheet-zone" error={errors.timezone} helper={tz ? `Local time ${networkClock(tz).time(now)}` : null}>
        <Select items={zones.map((z) => ({ value: z, label: z.replaceAll("_", " ") }))} value={tz || null} onValueChange={(v) => v !== null && setTz(v)}>
          <SelectTrigger id="timezone-sheet-zone" className="w-full min-w-0">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectPopup align="start" className="max-h-72 text-sm">
            {zones.map((z) => (
              <SelectItem key={z} value={z}>
                {z.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </SheetField>
      <ImpactPanel ids={tz !== "" && tz !== current ? [ID] : []} />
      <WriteConfirmDialog write={save} />
    </Sheet>
  );
}
