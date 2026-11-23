/**
 * eero detail "Radios": one card with a row per band (channel, width, tx
 * power, devices and utilisation now), rows split by faint dividers like a
 * settings group (no card per band: no nested boxes). Missing figures show "-"; an offline eero
 * shows "-" throughout. docs/ux/pages/eero-detail.md (Layout 2).
 */
import { BUSY_AT, wirelessRadios } from "~/components/mesh/RadioTable";
import { BandBadge, bandLabel } from "~/components/ui/band-badge";
import { Card, Empty, Section } from "~/components/ui/card";
import { Meter, meterTone } from "~/components/ui/meter";
import { cn } from "~/lib/utils";
import { formatCount, formatPercent, MISSING } from "../../../../core/format";
import type { Eero, Radio } from "../../../../core/model";
import { autoChannelLine } from "./helpers";

const PLACEHOLDER: Radio[] = (["2.4", "5"] as const).map((band) => ({
  band,
  channel: null,
  widthMhz: null,
  utilization: null,
  clients: null,
  txPowerDbm: null,
  autoChannel: null,
}));

export function EeroRadios({ eero, offline }: { eero: Eero | null; offline: boolean }) {
  const radios = eero ? wirelessRadios(eero) : PLACEHOLDER;
  // "2 radios, auto channel on": the count, then how channels are picked (data-driven, under the title).
  const auto = eero && !offline ? autoChannelLine(radios) : null;
  const description = eero ? [`${radios.length} ${radios.length === 1 ? "radio" : "radios"}`, auto ? auto.charAt(0).toLowerCase() + auto.slice(1) : null].filter(Boolean).join(", ") : "-";
  return (
    <Section title="Radios" description={description} className="gap-[15px]">
      {eero && radios.length === 0 ? (
        <Card>
          <Empty>No radio details reported.</Empty>
        </Card>
      ) : (
        <Card className="divide-y divide-border/50">
          {radios.map((r) => (
            <RadioRow key={r.band} radio={r} offline={offline} />
          ))}
        </Card>
      )}
    </Section>
  );
}

function RadioRow({ radio: r, offline }: { radio: Radio; offline: boolean }) {
  const show = <T,>(v: T | null) => (offline ? null : v);
  const channel = show(r.channel);
  const width = show(r.widthMhz);
  const tx = show(r.txPowerDbm);
  const util = show(r.utilization);
  const clients = show(r.clients);
  const busy = meterTone(util === null ? null : util / 100, BUSY_AT) === "warning";
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2.5">
        <BandBadge band={r.band} />
        <span className="whitespace-nowrap font-medium text-sm tabular-nums">Ch {channel ?? MISSING}</span>
        {/* Width over transmit power, always two lines, so a narrow card never wraps the channel. */}
        {(width !== null || tx !== null) && (
          <span className="flex flex-col whitespace-nowrap text-muted-foreground text-xs leading-tight tabular-nums">
            {width !== null && <span>{width} MHz</span>}
            {tx !== null && <span>tx {tx} dBm</span>}
          </span>
        )}
        <span className="ms-auto whitespace-nowrap text-xs">
          <b className="font-medium tabular-nums">{formatCount(clients)}</b> <span className="text-muted-foreground">{clients === 1 ? "device" : "devices"}</span>
        </span>
      </div>
      <div className="mt-2">
        <div className="flex justify-between text-2xs text-muted-foreground">
          <span>Utilization now</span>
          <span className={cn("tabular-nums", busy && "text-warning-foreground")}>{formatPercent(util)}</span>
        </div>
        <Meter value={util} warnAt={BUSY_AT} label={`${bandLabel(r.band)} utilization`} className="mt-1" />
      </div>
    </div>
  );
}
