/**
 * "Wi-Fi bands": a card per band any eero offers, with its state, devices,
 * widths, channels, share of wireless devices and security mode, plus the 2.4 GHz only
 * switch (`wifi.hide5g.set`, confirm dialog, with its impact) with a countdown
 * to eero's own expiry. A band no eero has is
 * not shown, so a single-band network shows one card. Offline: figures show "-".
 * docs/ux/pages/wifi.md (Layout, left column 3).
 */
import { RadioTower } from "lucide-react";

import { bandLabel } from "~/components/ui/band-badge";
import { Card, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { KvList } from "~/components/ui/kv-list";
import { useWrite } from "~/app/useWrite";
import { Footnote, GatedButton, useGate, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { bandColor } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatPercent } from "../../../../core/format";
import { HIDE_5G } from "../../../../core/hide5g";
import type { Security, WifiSettings, WirelessBand } from "../../../../core/model";
import { WifiImpact } from "./WifiImpact";

const HINT: Record<WirelessBand, string> = {
  "2.4": "Range, older devices",
  "5": "Speed for most devices",
  "6": "Fastest, newest devices",
};

type BandRow = WifiSettings["bands"][number];

/** A band's security mode in a card's short value column. */
const SECURITY_SHORT: Record<Security, string> = { WPA2: "WPA2", WPA2_WPA3: "WPA2 + WPA3", WPA3: "WPA3" };

const PLACEHOLDER: BandRow[] = (["2.4", "5"] as const).map((band) => ({ band, on: false, clients: 0, widthsMhz: [], channels: [] }));

export function WifiBands({ wifi, offline, fading = false }: { wifi: WifiSettings | null; offline: boolean; fading?: boolean }) {
  const bands = wifi?.bands ?? PLACEHOLDER;
  const total = bands.reduce((n, b) => n + b.clients, 0);
  const on = bands.filter((b) => b.on).length;
  // "All radios on, 27 devices": what runs, then who is on it.
  const subtitle = !wifi
    ? "-"
    : offline
      ? "The network is offline"
      : bands.length === 1
        ? "One radio, managed by eero"
        : `${on === bands.length ? "All radios on" : `${formatCount(on)} of ${formatCount(bands.length)} radios on`}, ${formatCount(total)} ${total === 1 ? "device" : "devices"}`;

  return (
    <Section title="Wi-Fi bands" description={subtitle} className="gap-[15px]">
      <div className={cn("grid gap-3 transition-opacity", bands.length >= 3 ? "md:grid-cols-3" : bands.length === 2 ? "md:grid-cols-2" : "", fading && "opacity-40")}>
        {bands.map((b) => (
          <BandCard key={b.band} band={b} known={wifi !== null && !offline} share={total > 0 ? b.clients / total : null} security={wifi?.security[b.band] ?? null} />
        ))}
      </div>
      {wifi && bands.some((b) => b.band === "2.4") && <Hide5g wifi={wifi} offline={offline} />}
      <Footnote>eero picks channels and widths on its own; every band shares one network name.</Footnote>
    </Section>
  );
}

/** A band's card, with the eero cards' header (Eeros page): a 44px icon tile, the band in `text-sm font-medium`, its hint under it, the status level with the title; the figures under a rule. */
function BandCard({ band: b, known, share, security }: { band: BandRow; known: boolean; share: number | null; security: Security | null }) {
  const width = b.widthsMhz.length ? `${b.widthsMhz.join(" / ")} MHz` : null;
  const channels = b.channels.length ? b.channels.join(", ") : null;
  return (
    <Card>
      <div className="flex items-center gap-3 px-[18px] pt-4 pb-3">
        <IconTile icon={RadioTower} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium text-sm">
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: bandColor(b.band) }} />
            {bandLabel(b.band)}
          </div>
          <div className="truncate text-muted-foreground text-xs">{HINT[b.band]}</div>
        </div>
        {/* Level with the band name: top-aligned in a 20px box, the title's line height (as the eero cards). */}
        {known && (
          <div className="flex h-5 items-center self-start">
            <Status tone={b.on ? "success" : "muted"}>{b.on ? "On" : "Off"}</Status>
          </div>
        )}
      </div>
      <div className="border-t px-[18px] pt-3 pb-3.5">
        <div className="font-semibold text-2xl tabular-nums tracking-tight">
          {known ? formatCount(b.clients) : "-"}
          <small className="ms-1.5 font-normal text-muted-foreground text-xs">{b.clients === 1 ? "device" : "devices"}</small>
        </div>
        <KvList
          className="mt-3 text-xs"
          items={[
            { label: "Width", value: known ? width : null },
            { label: "Channels", value: known ? channels : null, mono: true },
            { label: "Share", value: known && share !== null ? `${formatPercent(share * 100)} of devices` : null },
            { label: "Security", value: security ? SECURITY_SHORT[security] : null },
          ]}
        />
      </div>
    </Card>
  );
}

/** "17:42" until eero turns 2.4 GHz only off; "1h 05m" past an hour. */
export function countdown(expiresAt: string, now: number): string | null {
  const left = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  if (!Number.isFinite(left)) return null;
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const sec = left % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** "5 and 6 GHz", "5 GHz": the bands 2.4 GHz only hides on this network. */
export function hiddenBands(wifi: WifiSettings): string {
  const others = wifi.bands.map((b) => b.band).filter((b) => b !== "2.4");
  const names = others.length ? others : (["5"] as WirelessBand[]);
  return `${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]} GHz`;
}

/**
 * 2.4 GHz only, as one settings row: the title (with a warning On status and
 * eero's countdown while it is on), when you would want it, and a button that
 * says what it does to the other bands: Hide 5 and 6 GHz… or Show 5 and 6
 * GHz…, each asking first (the confirm says it is disruptive, with the
 * devices it moves).
 */
function Hide5g({ wifi, offline }: { wifi: WifiSettings; offline: boolean }) {
  return (
    <Card>
      <Hide5gRow wifi={wifi} offline={offline} />
    </Card>
  );
}

/** The 2.4 GHz only settings row on its own, for a card that holds other rows too (Troubleshooting's Fixes). */
export function Hide5gRow({ wifi, offline }: { wifi: WifiSettings; offline: boolean }) {
  const { active, expiresAt } = wifi.hide5g;
  const others = hiddenBands(wifi);
  const gate = useGate({ area: "settings" });
  const write = useWrite<{ enabled: boolean }, WifiSettings>("wifi.hide5g.set", {
    success: (r) => (r.hide5g.active ? `${others} hidden` : `${others} back on`),
    progress: active ? `Showing ${others}...` : `Hiding ${others}...`,
    confirm: { confirmLabel: active ? `Show ${others}` : `Hide ${others}` },
  });
  const now = useNow(active ? 1000 : 60_000);
  const left = active && expiresAt ? countdown(expiresAt, now) : null;

  return (
    <SettingsRow
      title={
        <>
          2.4 GHz only
          {active && <Status tone="warning">On</Status>}
        </>
      }
      description={active ? HIDE_5G.active : HIDE_5G.why}
      control={
        <span className="flex items-center gap-3">
          {left && (
            <span title="Time left" aria-label={`${left} left`} className="font-mono font-semibold text-base tabular-nums tracking-tighter">
              {left}
            </span>
          )}
          <GatedButton
            variant="outline"
            gate={gate}
            title={active ? `Brings ${others} back now, before eero does` : HIDE_5G.action}
            disabled={offline || write.running}
            onClick={() => void write.run({ enabled: !active })}
          >
            {active ? `Show ${others}\u2026` : `Hide ${others}\u2026`}
          </GatedButton>
        </span>
      }
    >
      {write.asking && !active && <WifiImpact params={{ change: "hide5g" }} />}
    </SettingsRow>
  );
}
