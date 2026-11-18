/**
 * "Your eeros": a card per eero (Grid) with the radio table and Blink light,
 * or one row per eero (List) with per-band client counts. Blink light
 * (`eero.find`) blinks the LED and the button counts down ("Blinking · 24s"); the blink state is
 * shared with eero detail (`useFind`). No Stop until a stop call is
 * verified. docs/ux/pages/eeros.md (Layout 2).
 */
import { ChevronRight, Lightbulb } from "lucide-react";
import { useSyncExternalStore } from "react";

import { pathFor } from "~/app/router";
import { eeroIcon } from "~/lib/deviceIcons";
import { RadioTable, wirelessRadios } from "~/components/mesh/RadioTable";
import { GatewayLabel } from "~/components/ui/badge";
import { BandBadge } from "~/components/ui/band-badge";
import { Card, CardLink } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { useWrite } from "~/app/useWrite";
import { GatedButton, Row, RowList, useGate, useNow } from "~/components/ui/page";
import { type StatusTone, Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatCount, formatDuration } from "../../../../core/format";
import type { Eero } from "../../../../core/model";

// ---------------------------------------------------------------------------
// Blink light: which eeros are blinking, until when (module state, so every page agrees)

const blinking = new Map<string, number>();
const blinkListeners = new Set<() => void>();
let blinkVersion = 0;
const emitBlink = () => {
  blinkVersion++;
  blinkListeners.forEach((l) => l());
};

/** Seconds left on this eero's blink, or null when it is not blinking. */
export function useBlinking(eeroId: string | null | undefined): number | null {
  useSyncExternalStore(
    (l) => (blinkListeners.add(l), () => blinkListeners.delete(l)),
    () => blinkVersion,
  );
  const until = eeroId ? blinking.get(eeroId) : undefined;
  const now = useNow(1_000);
  if (until === undefined) return null;
  const left = Math.ceil((until - now) / 1000);
  return left > 0 ? left : null;
}

/** Runs `eero.find` and marks the eero blinking for the seconds eero was asked for. */
export function useFind(eero: Pick<Eero, "id" | "location" | "status"> | null) {
  const write = useWrite<{ eero: string }, { eeroId: string; seconds: number }>("eero.find");
  const gate = useGate({ area: "eeros" });
  const left = useBlinking(eero?.id);
  const offline = eero?.status === "offline";
  const run = async () => {
    if (!eero) return;
    const r = await write.run({ eero: eero.id }, { success: `Blinking ${eero.location}` });
    if (r?.ok) {
      blinking.set(r.result.eeroId, Date.now() + r.result.seconds * 1000);
      emitBlink();
      setTimeout(emitBlink, r.result.seconds * 1000 + 50);
    }
  };
  return {
    run,
    running: write.running,
    left,
    gate: offline ? { allowed: false, reason: `${eero?.location ?? "This eero"} is offline` } : gate,
  };
}

/** "Blink light" (`eero.find`), or "Blinking · 24s" while the LED blinks. The same label on every page. */
export function BlinkLightButton({ eero, size = "xs" }: { eero: Eero; size?: "xs" | "context" }) {
  const find = useFind(eero);
  return (
    <GatedButton
      // "context": the region's size (the hero's 28px), as the page header sets it.
      size={size === "context" ? undefined : size}
      variant="outline"
      // Icons inside buttons are dim (design-system.md, Buttons and links).
      className="[&_svg]:text-muted-foreground"
      gate={find.gate}
      disabled={find.running || find.left !== null}
      onClick={() => void find.run()}
      aria-label={find.left !== null ? `${eero.location} blinking, ${find.left}s left` : `Blink ${eero.location}'s light`}
    >
      <Lightbulb />
      {find.left !== null ? <span className="tabular-nums">Blinking · {find.left}s</span> : "Blink light"}
    </GatedButton>
  );
}

export type EeroStatusWord = { tone: StatusTone; label: string };

export type EeroCardsProps = {
  eeros: ReadonlyArray<Eero>;
  view: "grid" | "list";
  statusOf: (e: Eero) => EeroStatusWord;
  /** "last seen 2:16 AM" for an offline eero. */
  offlineDetail: (e: Eero) => string | null;
  /** A refetch has run for 150 ms: fade the figures. */
  fading?: boolean;
};

/** "eero Max 7 · 192.168.4.1 · up 23d 4h", or the last-seen line when offline (no uptime). */
function facts(e: Eero, offlineDetail: (e: Eero) => string | null): string {
  const up = e.status === "offline" || e.uptimeSec === null ? offlineDetail(e) : `up ${formatDuration(e.uptimeSec)}`;
  return [e.model, e.ipv4, up].filter(Boolean).join(" · ") || "-";
}

export function EeroCards({ eeros, view, statusOf, offlineDetail, fading = false }: EeroCardsProps) {
  if (view === "list") {
    return (
      <RowList className={cn("transition-opacity", fading && "opacity-40")}>
        {eeros.map((e) => {
          const status = statusOf(e);
          const radios = wirelessRadios(e);
          return (
            <Row key={e.id} to={pathFor("eero", { eeroId: e.id })}>
              <IconTile icon={eeroIcon(e)} />
              <div className="min-w-0 flex-1">
                <Title eero={e} />
                <div className="truncate text-muted-foreground text-xs">{facts(e, offlineDetail)}</div>
              </div>
              <div className="hidden items-center gap-3 md:flex">
                {radios.map((r) => (
                  <span key={r.band} className="inline-flex items-center gap-1.5 text-xs">
                    <BandBadge band={r.band} />
                    <span className="w-5 font-medium tabular-nums">{formatCount(r.clients)}</span>
                  </span>
                ))}
                {(e.clients.wired ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <BandBadge band="wired" />
                    <span className="w-5 font-medium tabular-nums">{formatCount(e.clients.wired)}</span>
                  </span>
                )}
              </div>
              <Status tone={status.tone} className="w-20">
                {status.label}
              </Status>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </Row>
          );
        })}
      </RowList>
    );
  }

  return (
    <div className={cn("grid gap-4 transition-opacity lg:grid-cols-2", fading && "opacity-40")}>
      {eeros.map((e) => {
        const status = statusOf(e);
        const to = pathFor("eero", { eeroId: e.id });
        return (
          <Card key={e.id} to={to}>
            <div className="flex items-center gap-3 px-[18px] pt-4 pb-3">
              <IconTile icon={eeroIcon(e)} size="lg" />
              <div className="min-w-0 flex-1">
                <Title eero={e} to={to} />
                <div className="truncate text-muted-foreground text-xs">{facts(e, offlineDetail)}</div>
              </div>
              {/* Level with the name: top-aligned in a 20px box, the title's line height.
                  -me-1: 4px further right, so the button's gap to the card edge matches its gap to the top. */}
              <div className="-me-1 flex h-5 items-center gap-3 self-start">
                <Status tone={status.tone}>{status.label}</Status>
                <span data-card-ignore className="flex">
                  <BlinkLightButton eero={e} />
                </span>
              </div>
            </div>
            <div className="border-t px-[18px] pt-3 pb-3.5">
              <RadioTable eero={e} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** The eero's name plus its Gateway label. With `to` the name is the clickable card's link (its keyboard focus target). */
function Title({ eero, to }: { eero: Eero; to?: string }) {
  return (
    // 14px, the list-name size on the type scale (was an off-scale 15px / 13.5px).
    <span className="flex min-w-0 items-center gap-2 font-medium text-sm">
      {to ? (
        <CardLink to={to}>{eero.location}</CardLink>
      ) : (
        <span className="truncate">{eero.location}</span>
      )}
      {eero.isGateway && (
        <GatewayLabel />
      )}
    </span>
  );
}
