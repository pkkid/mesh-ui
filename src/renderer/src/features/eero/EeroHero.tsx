/**
 * The eero detail hero, flat like every page header: a 64px product tile
 * (the device hero's size) with a small LED bar, name with "Gateway", status
 * line (status, uptime), facts (Model, Radios, Devices, Data 24h), and the
 * Uplink card on the right. The LED bar pulses while Blink light blinks the eero.
 * Actions: Rename… first (the rename sheet, `eero.rename` with Undo), Blink
 * light, and Restart eero… last. docs/ux/pages/eero-detail.md (Layout 1).
 */
import { Lightbulb, Pencil, RotateCcw } from "lucide-react";
import { useState } from "react";

import { useWrite } from "~/app/useWrite";

import { GatewayLabel } from "~/components/ui/badge";
import { GatedButton, useGate } from "~/components/ui/page";
import { RenameSheet } from "~/components/ui/rename-sheet";
import { Metric, PageHeader } from "~/components/ui/hero";
import { networkStatus, Status } from "~/components/ui/status";
import { eeroIcon } from "~/lib/deviceIcons";
import { BlinkLightButton, useBlinking } from "~/features/eeros/EeroCards";
import { useEeroRestart } from "./EeroActions";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount, formatDuration, formatPercent } from "../../../../core/format";
import type { Eero, UsageBreakdownRow } from "../../../../core/model";
import { ledState, radioBadge } from "./helpers";

import { EeroUplink } from "./EeroUplink";

export type EeroHeroProps = {
  eero: Eero | null;
  eeros: ReadonlyArray<Eero>;
  /** This eero (or the whole network) is not reporting. */
  offline: boolean;
  networkOffline: boolean;
  /** "2:16 AM", for an offline eero. */
  lastSeen: string | null;
  /** This eero's row in `usage.breakdown {by: eero, range: day}`. */
  usage: UsageBreakdownRow | null;
  /** The Internet node, for the gateway only. */
  internet: { label: string | null; wanMbps: number | null } | null;
  /** For Restart's confirm and toast when this eero is the gateway. */
  networkName: string;
  fading?: boolean;
};

export function EeroHero({ eero, eeros, offline, networkOffline, lastSeen, usage, internet, networkName, fading = false }: EeroHeroProps) {
  const restart = useEeroRestart(eero, eeros, networkName, offline);
  const [renaming, setRenaming] = useState(false);
  const rename = useWrite<{ eero: string; location: string }, Eero>("eero.rename", { form: true });
  const roleGate = useGate({ area: "eeros" });
  // Renaming needs the eero online, as its other settings do.
  const renameGate = !eero ? { allowed: false, reason: null } : offline ? { allowed: false, reason: `${eero.location} is offline` } : roleGate;
  const status = offline ? networkStatus("offline") : networkStatus(eero?.status);
  const badge = eero ? radioBadge(eero) : null;
  const wired = eero?.clients.wired ?? null;
  const total = offline ? null : (eero?.clients.total ?? null);
  const bytes = usage ? usage.down + usage.up : null;

  return (
    <>
    <PageHeader
      flat
      className={cn("transition-opacity", fading && "opacity-40")}
      title={
        // "Gateway" is a role label beside the name: plain dim text (design-system.md, Role label).
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span className="truncate">{eero?.location ?? "-"}</span>
          {eero?.isGateway && <GatewayLabel />}
        </span>
      }
      icon={<ProductTile eero={eero} offline={offline} />}
      status={
        <>
          <Status tone={status.tone}>{status.label}</Status>
          <span>{offline ? (lastSeen ? `Last seen ${lastSeen}` : null) : eero?.uptimeSec != null ? `Up ${formatDuration(eero.uptimeSec)}` : null}</span>
        </>
      }
      // Model and radios are facts, label over value like every hero, not boxed badges.
      facts={
        <>
          <Metric label="Model" value={eero?.model ?? null} />
          <Metric label="Radios" value={badge} />
          <Metric
            label="Devices"
            value={
              total === null ? null : (
                <>
                  {formatCount(total)}
                  {wired !== null && wired > 0 && <small className="ms-1.5 font-normal text-muted-foreground text-xs">{formatCount(wired)} wired</small>}
                </>
              )
            }
          />
          <Metric
            label="Data, 24h"
            value={
              bytes === null ? null : (
                <>
                  {formatBytes(bytes)}
                  {/* The share after the value, "142 GB (32%)", as on Overview. */}
                  {usage && <small className="ms-1.5 font-normal text-muted-foreground text-xs">({formatPercent(usage.share)})</small>}
                </>
              )
            }
          />
        </>
      }
      // Hero actions, as on Overview and Internet: outline, the hero's 28px size, dim icons, under the facts.
      actions={
        eero ? (
          <>
            {/* First in every detail hero; it opens the rename sheet, so it ends in an ellipsis. */}
            <GatedButton variant="outline" className={DIM_ICON} gate={renameGate} onClick={() => setRenaming(true)}>
              <Pencil />
              Rename{"\u2026"}
            </GatedButton>
            {restart.blocked ? (
              <GatedButton variant="outline" className={DIM_ICON} gate={restart.gate}>
                <Lightbulb />
                Blink light
              </GatedButton>
            ) : (
              <span className={cn("inline-flex", DIM_ICON)}>
                <BlinkLightButton eero={eero} size="context" />
              </span>
            )}
            {/* Ellipsis: it confirms first. The tooltip says what it takes down. */}
            <span title={restart.line ?? undefined} className="inline-flex">
              <GatedButton variant="outline" className={DIM_ICON} gate={restart.gate} disabled={restart.running} onClick={() => void restart.run()}>
                <RotateCcw />
                Restart eero…
              </GatedButton>
            </span>
          </>
        ) : undefined
      }
      aside={eero ? <EeroUplink eero={eero} eeros={eeros} internet={internet} networkOffline={networkOffline} /> : null}
    />
    {eero && (
      <RenameSheet
        open={renaming}
        onClose={() => setRenaming(false)}
        title={`Rename ${eero.location}`}
        saveLabel="Rename eero"
        subtitle="The name shown everywhere for this eero, like Office, Den or Kitchen"
        label="Location"
        value={eero.location}
        error={rename.error?.code === "bad_params" ? rename.error.message : null}
        onSave={(location) =>
          rename.run(
            { eero: eero.id, location },
            { success: `Renamed ${eero.location} to ${location}`, undo: { id: "eero.rename", params: { eero: eero.id, location: eero.location } } },
          )
        }
      />
    )}
    </>
  );
}

/** Icons inside buttons are dim (design-system.md, Buttons and links). */
const DIM_ICON = "[&_svg]:text-muted-foreground";

const LED_LABEL = { on: "Status light on", dim: "Status light dimmed", off: "Status light off", unknown: "Status light unknown", blink: "Status light blinking" } as const;

/** A 64px tile like the device hero's IconTile, with the eero glyph and a small LED bar at the top that mirrors the LED. */
function ProductTile({ eero, offline }: { eero: Eero | null; offline: boolean }) {
  const Icon = eeroIcon(eero);
  const blinking = useBlinking(eero?.id) !== null;
  const led = blinking ? "blink" : ledState(eero, offline);
  return (
    <div
      role="img"
      aria-label={`${eero?.model ?? "eero"}. ${LED_LABEL[led]}`}
      className="relative grid size-16 shrink-0 place-items-center rounded-(--hero-radius) bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]"
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-2 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full",
          led === "on" && "bg-foreground/80",
          led === "blink" && "animate-pulse bg-foreground/80",
          led === "dim" && "bg-foreground/40",
          (led === "off" || led === "unknown") && "bg-border",
        )}
      />
      <Icon aria-hidden className={cn("size-[30px]", offline && "opacity-60")} />
    </div>
  );
}
