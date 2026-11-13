/**
 * One eero's radios: band, channel, width, utilisation and clients, plus a
 * dual-band note and a Wired row. Used by the eero cards on the eeros page
 * and by eero detail. docs/ux/pages/eeros.md (Layout 2).
 */
import { BandBadge } from "~/components/ui/band-badge";
import { Meter, meterTone } from "~/components/ui/meter";
import { cn } from "~/lib/utils";
import { formatCount, formatPercent, MISSING } from "../../../../core/format";
import type { Eero, Radio } from "../../../../core/model";

/** Utilisation from this share is shown in the warning colour. */
export const BUSY_AT = 0.65;

const ORDER: Record<string, number> = { "2.4": 0, "5": 1, "6": 2 };

const COLS = "grid grid-cols-[62px_64px_58px_minmax(0,1fr)_34px] items-center gap-2";

/** Wireless radios in band order. */
export const wirelessRadios = (e: Pick<Eero, "radios">): Radio[] =>
  e.radios.filter((r) => r.band !== "wired").sort((a, b) => (ORDER[a.band] ?? 9) - (ORDER[b.band] ?? 9));

export function RadioTable({ eero, className }: { eero: Eero; className?: string }) {
  const radios = wirelessRadios(eero);
  const dualBand = radios.length > 0 && !radios.some((r) => r.band === "6");
  const wired = eero.clients.wired ?? 0;

  return (
    <div className={cn("text-xs", className)} role="table" aria-label={`${eero.location} radios`}>
      <div role="row" className={cn(COLS, radios.length === 0 && "hidden", "pb-1 text-3xs text-muted-foreground uppercase tracking-[0.06em]")}>
        <span role="columnheader">Band</span>
        <span role="columnheader">Channel</span>
        <span role="columnheader">Width</span>
        <span role="columnheader">Utilisation</span>
        <span role="columnheader" className="text-right">
          Cl.
        </span>
      </div>
      {radios.length === 0 && <div className="py-1.5 text-muted-foreground">No radio details reported.</div>}
      {radios.map((r) => {
        const share = r.utilization === null ? null : r.utilization / 100;
        const busy = meterTone(share, BUSY_AT) === "warning";
        return (
          <div role="row" key={r.band} className={cn(COLS, "border-dashed py-[5px] [&+&]:border-t")}>
            <span role="cell">
              <BandBadge band={r.band} />
            </span>
            <span role="cell" className="tabular-nums">
              {r.channel === null ? MISSING : `ch ${r.channel}`}
            </span>
            <span role="cell" className="text-muted-foreground tabular-nums">
              {r.widthMhz === null ? MISSING : `${r.widthMhz} MHz`}
            </span>
            <span role="cell" className="flex items-center gap-1.5">
              {r.utilization === null ? (
                <span className="text-muted-foreground">{MISSING}</span>
              ) : (
                <>
                  <Meter value={r.utilization} warnAt={BUSY_AT} label={`${bandName(r.band)} utilisation`} className="flex-1" />
                  <span className={cn("w-[30px] text-right text-2xs tabular-nums", busy ? "text-warning-foreground" : "text-muted-foreground")}>
                    {formatPercent(r.utilization)}
                  </span>
                </>
              )}
            </span>
            <span role="cell" className="text-right font-medium tabular-nums">
              {formatCount(r.clients)}
            </span>
          </div>
        );
      })}
      {dualBand && <div className="mt-2 text-2xs text-muted-foreground">{eero.model ?? "This eero"} is dual band, no 6 GHz radio</div>}
      {wired > 0 && (
        <div role="row" className={cn(COLS, "mt-1 border-t border-dashed py-[5px]")}>
          <span role="cell">
            <BandBadge band="wired" />
          </span>
          <span role="cell" className="text-muted-foreground">
            Ethernet
          </span>
          <span role="cell" />
          <span role="cell" />
          <span role="cell" className="text-right font-medium tabular-nums">
            {formatCount(wired)}
          </span>
        </div>
      )}
    </div>
  );
}

const bandName = (b: Radio["band"]) => (b === "wired" ? "Wired" : `${b} GHz`);
