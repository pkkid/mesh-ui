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
import { Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fieldErrors, useWrite } from "~/app/useWrite";
import { WriteConfirmDialog } from "~/components/ui/confirm";
import { useNow } from "~/components/ui/page";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { ImpactPanel } from "~/features/advanced/ImpactPanel";
import { networkClock } from "../../../../core/format";
import type { NetworkSettings } from "../../../../core/model";

const ID = "settings.timezone.set";

const selectClass =
  "h-8 w-full cursor-pointer truncate rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/32";

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
      icon={<Clock />}
      title="Time zone"
      subtitle="Profile schedules, power saving and updates follow it"
      dirty={tz !== "" && tz !== current}
      onSave={() => save.run({ timezone: tz })}
      error={errors._form}
      clean
    >
      <SheetField label="Time zone" htmlFor="timezone-sheet-zone" error={errors.timezone} helper={tz ? `Local time ${networkClock(tz).time(now)}` : null}>
        <select id="timezone-sheet-zone" className={selectClass} value={tz} onChange={(e) => setTz(e.target.value)}>
          {tz === "" && <option value="">Not set</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </SheetField>
      <ImpactPanel ids={[ID]} />
      <WriteConfirmDialog write={save} />
    </Sheet>
  );
}
