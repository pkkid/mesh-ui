/**
 * Wi-Fi "Bands": a card per band any eero offers, with its state, clients,
 * widths, channels and share of wireless clients, plus the 2.4 GHz only
 * state and a link to its fix on Troubleshooting. A band no eero has is not
 * shown, so a single-band network shows one card. Offline: figures show "-".
 * docs/ux/pages/wifi.md (Layout, left column 3).
 */
import { Radio, RadioTower } from "lucide-react";

import { pathFor } from "~/app/router";
import { bandLabel } from "~/components/ui/band-badge";
import { Card, Section } from "~/components/ui/card";
import { KvList } from "~/components/ui/kv-list";
import { HeaderLink, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { bandColor } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatPercent, formatRelative } from "../../../../core/format";
import type { WifiSettings, WirelessBand } from "../../../../core/model";

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
      {wifi?.hide5g.active && <Hide5gNote expiresAt={wifi.hide5g.expiresAt} />}
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

function Hide5gNote({ expiresAt }: { expiresAt: string | null }) {
  const now = useNow(30_000);
  return (
    <Card padded className="flex items-center gap-3 text-[13px]">
      <Status tone="warning">2.4 GHz only is on</Status>
      <span className="text-muted-foreground text-xs">
        5 and 6 GHz are hidden so older devices can join{expiresAt ? `; it turns off ${formatRelative(expiresAt, now)}` : ""}.
      </span>
    </Card>
  );
}
