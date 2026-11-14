/**
 * Wi-Fi "Bands": a card per band any eero offers, with its state, clients,
 * widths, channels and share of wireless clients, plus the 2.4 GHz only
 * switch (`wifi.hide5g.set`, inline confirm with its impact) with a countdown
 * to eero's own expiry, and a link to Troubleshooting. A band no eero has is
 * not shown, so a single-band network shows one card. Offline: figures show "-".
 * docs/ux/pages/wifi.md (Layout, left column 3).
 */
import { Radio, RadioTower } from "lucide-react";

import { pathFor } from "~/app/router";
import { bandLabel } from "~/components/ui/band-badge";
import { Card, Section } from "~/components/ui/card";
import { KvList } from "~/components/ui/kv-list";
import { useWrite } from "~/app/useWrite";
import { WriteConfirm } from "~/components/ui/confirm";
import { GatedButton, HeaderLink, useGate, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { bandColor } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatPercent } from "../../../../core/format";
import type { WifiSettings, WirelessBand } from "../../../../core/model";
import { WifiImpact } from "./WifiImpact";

const HINT: Record<WirelessBand, string> = {
  "2.4": "Range, older devices",
  "5": "Speed for most devices",
  "6": "Fastest, newest devices",
};

type BandRow = WifiSettings["bands"][number];

const PLACEHOLDER: BandRow[] = (["2.4", "5"] as const).map((band) => ({ band, on: false, clients: 0, widthsMhz: [], channels: [] }));

export function WifiBands({ wifi, offline, fading = false }: { wifi: WifiSettings | null; offline: boolean; fading?: boolean }) {
  const bands = wifi?.bands ?? PLACEHOLDER;
  const total = bands.reduce((n, b) => n + b.clients, 0);
  const on = bands.filter((b) => b.on).length;
  const subtitle = !wifi
    ? null
    : offline
      ? "The network is offline"
      : bands.length === 1
        ? "One radio, managed by eero"
        : on === bands.length
          ? "All radios on, managed by eero"
          : `${formatCount(on)} of ${formatCount(bands.length)} radios on`;

  return (
    <Section
      title="Bands"
      subtitle={subtitle}
      tools={
        <HeaderLink to={pathFor("troubleshooting")}>
          <Radio />
          2.4 GHz only devices
        </HeaderLink>
      }
    >
      {wifi && bands.some((b) => b.band === "2.4") && <Hide5g wifi={wifi} offline={offline} />}
      <div className={cn("grid gap-3 transition-opacity", bands.length >= 3 ? "md:grid-cols-3" : bands.length === 2 ? "md:grid-cols-2" : "", fading && "opacity-40")}>
        {bands.map((b) => (
          <BandCard key={b.band} band={b} known={wifi !== null && !offline} share={total > 0 ? b.clients / total : null} />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">eero picks channels and widths on its own; every band shares one network name.</p>
    </Section>
  );
}

function BandCard({ band: b, known, share }: { band: BandRow; known: boolean; share: number | null }) {
  const width = b.widthsMhz.length ? `${b.widthsMhz.join(" / ")} MHz` : null;
  const channels = b.channels.length ? b.channels.join(", ") : null;
  return (
    <Card className="px-[18px] py-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)] [&_svg]:size-4">
          <RadioTower />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-medium text-[13px]">
            <span aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: bandColor(b.band) }} />
            {bandLabel(b.band)}
          </div>
          <div className="truncate text-2xs text-muted-foreground">{HINT[b.band]}</div>
        </div>
        {known && <Status tone={b.on ? "success" : "muted"}>{b.on ? "On" : "Off"}</Status>}
      </div>
      <div className="mt-3 font-semibold text-2xl tabular-nums tracking-tight">
        {known ? formatCount(b.clients) : "-"}
        <small className="ms-1.5 font-normal text-muted-foreground text-xs">clients</small>
      </div>
      <KvList
        className="mt-3 text-xs"
        items={[
          { label: "Width", value: known ? width : null },
          { label: "Channels", value: known ? channels : null, mono: true },
          { label: "Share", value: known && share !== null ? `${formatPercent(share * 100)} of clients` : null },
        ]}
      />
    </Card>
  );
}

/** "17:42" until eero turns 2.4 GHz only off; "1 h 05 min" past an hour. */
export function countdown(expiresAt: string, now: number): string | null {
  const left = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  if (!Number.isFinite(left)) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * The 2.4 GHz only switch: off, a button that asks first with the devices it
 * moves; on, the countdown to eero's expiry and Turn off.
 */
function Hide5g({ wifi, offline }: { wifi: WifiSettings; offline: boolean }) {
  const { active, expiresAt } = wifi.hide5g;
  const gate = useGate({ area: "settings" });
  const write = useWrite<{ enabled: boolean }, WifiSettings>("wifi.hide5g.set", {
    success: (r) => (r.hide5g.active ? "2.4 GHz only is on" : "2.4 GHz only is off"),
    progress: active ? "Turning 2.4 GHz only off..." : "Hiding 5 and 6 GHz...",
    confirm: { confirmLabel: active ? "Turn off" : "Hide 5 and 6 GHz" },
  });
  const now = useNow(active ? 1000 : 60_000);
  const left = active && expiresAt ? countdown(expiresAt, now) : null;

  return (
    <Card padded className="flex flex-col gap-3 text-[13px]">
      <WriteConfirm write={write}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-medium">
              2.4 GHz only
              {active ? <Status tone="warning">On</Status> : <Status tone="muted">Off</Status>}
            </div>
            <div className="text-muted-foreground text-xs">
              {active
                ? "5 and 6 GHz are hidden so older devices can join. eero turns it off when the time runs out."
                : "Hides 5 and 6 GHz for a while so a device that only speaks 2.4 GHz can join. eero turns it off on its own."}
            </div>
          </div>
          {left && (
            <span title="Time left" aria-label={`${left} left`} className="font-mono font-semibold text-lg tabular-nums tracking-tighter">
              {left}
            </span>
          )}
          <GatedButton size="sm" variant="outline" gate={gate} disabled={offline || write.running} onClick={() => void write.run({ enabled: !active })}>
            {active ? "Turn off" : "Turn on"}
          </GatedButton>
        </div>
      </WriteConfirm>
      {write.asking && !active && <WifiImpact params={{ change: "hide5g" }} />}
    </Card>
  );
}
