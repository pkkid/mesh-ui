/**
 * eero detail "Radios": a small card per band with channel, width, tx power,
 * clients and utilisation now. Missing figures show "-"; an offline eero
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
  const sub = eero && !offline ? autoChannelLine(radios) : null;
  return (
    <Section title="Radios" subtitle={sub}>
      {eero && radios.length === 0 ? (
        <Card>
          <Empty>No radio details reported.</Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {radios.map((r) => (
            <RadioCard key={r.band} radio={r} offline={offline} />
          ))}
        </div>
      )}
    </Section>
  );
}

function RadioCard({ radio: r, offline }: { radio: Radio; offline: boolean }) {
  const show = <T,>(v: T | null) => (offline ? null : v);
  const channel = show(r.channel);
  const width = show(r.widthMhz);
  const tx = show(r.txPowerDbm);
  const util = show(r.utilization);
  const clients = show(r.clients);
  const busy = meterTone(util === null ? null : util / 100, BUSY_AT) === "warning";
  return (
    <Card className="px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <BandBadge band={r.band} />
        <span className="font-medium text-[13px] tabular-nums">Ch {channel ?? MISSING}</span>
        {(width !== null || tx !== null) && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {[width === null ? null : `${width} MHz`, tx === null ? null : `tx ${tx} dBm`].filter(Boolean).join(" · ")}
          </span>
        )}
        <span className="ms-auto text-xs">
          <b className="font-medium tabular-nums">{formatCount(clients)}</b> <span className="text-muted-foreground">clients</span>
        </span>
      </div>
      <div className="mt-2">
        <div className="flex justify-between text-2xs text-muted-foreground">
          <span>Utilisation now</span>
          <span className={cn("tabular-nums", busy && "text-warning-foreground")}>{formatPercent(util)}</span>
        </div>
        <Meter value={util} warnAt={BUSY_AT} label={`${bandLabel(r.band)} utilisation`} className="mt-1" />
      </div>
    </Card>
  );
}
