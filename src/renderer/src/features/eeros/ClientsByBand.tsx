/**
 * "Clients by band": a donut of the `device.list` summary's `byBand` with
 * the client total in the middle, and a list in band colours.
 * docs/ux/pages/eeros.md (Layout 3).
 */
import { useState } from "react";

import { Donut, DonutLegendRow } from "~/components/charts/Donut";
import { Card, Section } from "~/components/ui/card";
import { bandLabel } from "~/components/ui/band-badge";
import { bandColor } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { Band, DeviceSummary } from "../../../../core/model";

const BANDS: ReadonlyArray<Band> = ["2.4", "5", "6", "wired"];

export function ClientsByBand({ summary, fading = false }: { summary: DeviceSummary | undefined; fading?: boolean }) {
  const counts = summary?.byBand;
  const total = counts ? BANDS.reduce((n, b) => n + (counts[b] ?? 0), 0) : null;
  const [active, setActive] = useState<string | null>(null);
  return (
    <Section title="Clients by band">
      <Card padded className={cn("flex items-center gap-6 transition-opacity", fading && "opacity-40")}>
        <Donut
          size={120}
          ariaLabel="Connected clients by band"
          active={active}
          onActiveChange={setActive}
          format={(v) => `${formatCount(v)} ${v === 1 ? "client" : "clients"}`}
          segments={BANDS.map((b) => ({ label: bandLabel(b), value: counts?.[b] ?? 0, color: bandColor(b) }))}
        >
          <div className="text-center">
            <div className="font-semibold text-xl tabular-nums">{formatCount(total)}</div>
            <div className="text-2xs text-muted-foreground">{total === 1 ? "client" : "clients"}</div>
          </div>
        </Donut>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {BANDS.map((b) => (
            <DonutLegendRow key={b} label={bandLabel(b)} color={bandColor(b)} active={active} onActiveChange={setActive} className="gap-3 text-[13px]">
              <span className="font-medium tabular-nums">{counts ? formatCount(counts[b]) : "-"}</span>
            </DonutLegendRow>
          ))}
        </div>
      </Card>
    </Section>
  );
}
