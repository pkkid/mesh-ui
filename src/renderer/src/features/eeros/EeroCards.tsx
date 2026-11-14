/**
 * "Your eeros": a card per eero (Grid) with the radio table and Find, or one
 * row per eero (List) with per-band client counts. Find (`eero.find`) blinks
 * the LED and the button counts down ("Blinking · 24s"); the blink state is
 * shared with eero detail (`useFind`). No Stop until a stop call is
 * verified. docs/ux/pages/eeros.md (Layout 2).
 */
import { ChevronRight, Lightbulb } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Link, pathFor } from "~/app/router";
import { eeroIcon } from "~/components/mesh/Topology";
import { RadioTable, wirelessRadios } from "~/components/mesh/RadioTable";
import { Badge } from "~/components/ui/badge";
import { BandBadge } from "~/components/ui/band-badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { useWrite } from "~/app/useWrite";
import { GatedButton, Row, RowList, useGate, useNow } from "~/components/ui/page";
import { type StatusTone, Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatCount, formatDuration } from "../../../../core/format";
import type { Eero } from "../../../../core/model";

// ---------------------------------------------------------------------------
// Find: which eeros are blinking, until when (module state, so every page agrees)

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

/** Find button: "Find", or "Blinking · 24s" while the LED blinks. */
export function FindButton({ eero, label = "Find" }: { eero: Eero; label?: string }) {
  const find = useFind(eero);
  return (
    <GatedButton size="xs" variant="outline" gate={find.gate} disabled={find.running || find.left !== null} onClick={() => void find.run()}>
      <Lightbulb />
      {find.left !== null ? <span className="tabular-nums">Blinking · {find.left}s</span> : label}
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

/** "eero Max 7 · 192.168.4.1 · up 23 d 4 h", or the last-seen line when offline (no uptime). */
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
    <div className={cn("grid gap-3.5 transition-opacity lg:grid-cols-2", fading && "opacity-40")}>
      {eeros.map((e) => {
        const status = statusOf(e);
        const to = pathFor("eero", { eeroId: e.id });
        return (
          <Card key={e.id}>
            <div className="flex items-center gap-3 px-[18px] pt-4 pb-3">
              <IconTile icon={eeroIcon(e)} size="lg" />
              <div className="min-w-0 flex-1">
                <Link to={to} className="outline-none hover:underline focus-visible:underline">
                  <Title eero={e} large />
                </Link>
                <div className="truncate text-muted-foreground text-xs">{facts(e, offlineDetail)}</div>
              </div>
              <Status tone={status.tone}>{status.label}</Status>
              <FindButton eero={e} />
              <Button size="icon-xs" variant="outline" title="Details" aria-label={`${e.location} details`} render={<Link to={to} />}>
                <ChevronRight />
              </Button>
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

function Title({ eero, large = false }: { eero: Eero; large?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2 font-medium", large ? "text-[15px]" : "text-[13.5px]")}>
      <span className="truncate">{eero.location}</span>
      {eero.isGateway && (
        <Badge variant="outline" className="shrink-0">
          Gateway
        </Badge>
      )}
    </span>
  );
}
