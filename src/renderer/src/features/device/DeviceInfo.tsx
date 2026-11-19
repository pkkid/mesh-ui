/**
 * Device detail "Device information" (docs/ux/pages/device-detail.md,
 * Layout 2): maker, model, hostname, MAC, then the connection. Wi-Fi devices
 * show security, standard, channel, link rate and SNR; wired devices show
 * the eero port and its negotiated speed instead. Anything eero does not
 * report, or that only applies while connected, shows `-`.
 */
import { ExternalLink, ShieldCheck } from "lucide-react";

import { useQuery } from "~/app/useCommand";
import { Card, Section } from "~/components/ui/card";
import { type KvItem, KvList } from "~/components/ui/kv-list";
import { formatMbps, formatPercent, networkClock } from "../../../../core/format";
import { deviceSearchQuery, deviceSearchUrl } from "../../../../core/deviceLookup";
import type { Device, Eero } from "../../../../core/model";

import type { DeviceView } from "./DevicePage";

const join = (parts: (string | null | undefined)[]) => {
  const shown = parts.filter((p): p is string => !!p);
  return shown.length ? shown.join(" · ") : null;
};

/** "Nov 18, 9:41 PM" in the network's time zone (shared clock); null when eero has no time. */
function activeSince(iso: string | null, timeZone: string | null | undefined): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return networkClock(timeZone).dateTime(iso);
}

const bandText = (d: Device) => (d.band && d.band !== "wired" ? `${d.band} GHz` : null);

export function DeviceInfo({ view }: { view: DeviceView }) {
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const d = view.device;
  const wired = d?.band === "wired" || (!!d?.wiredPort && !d.band);

  const items: KvItem[] = [
    { label: "Manufacturer", value: d?.manufacturer },
    { label: "Model", value: d?.model && d.model.toLowerCase() !== "unknown" ? d.model : null },
    { label: "Hostname", value: d?.hostname, mono: true },
    { label: "MAC address", value: d?.mac, mono: true, copy: true },
  ];
  if (d?.privateMac) items.push({ label: "MAC type", value: "Private (random)" });

  if (wired) {
    const port = d?.wiredPort;
    const on = port ? eeros.data?.find((e) => e.id === port.eeroId)?.location : null;
    items.push(
      { label: "eero port", value: port ? join([`Port ${port.port}`, on ? `on ${on}` : null]) : null },
      { label: "Speed", value: port?.speedMbps ? formatMbps(port.speedMbps) : null },
    );
  } else {
    const link = d?.link;
    items.push(
      {
        label: "Security",
        value: d?.security ? (
          <span className="flex items-center justify-end gap-1.5">
            <ShieldCheck className="size-3.5 text-success" />
            {d.security}
          </span>
        ) : null,
      },
      { label: "Wi-Fi standard", value: link?.standard },
      { label: "Channel", value: d ? join([d.channel === null ? null : String(d.channel), link?.widthMhz ? `${link.widthMhz} MHz` : null, bandText(d)]) : null },
      {
        label: "Link rate",
        value: link ? join([link.rxMbps === null ? null : `${formatMbps(link.rxMbps)} rx`, link.txMbps === null ? null : `${formatMbps(link.txMbps)} tx`]) : null,
      },
      {
        label: "SNR",
        value: link ? join([link.snr === null ? null : `${link.snr} dB`, link.retryPct === null ? null : `${formatPercent(link.retryPct, 1)} retries`]) : null,
      },
    );
  }
  items.push({ label: "Active since", value: d ? activeSince(d.firstSeen, view.network?.timezone) : null });

  return (
    <Section title="Device information" tools={d ? <LookUpOnline device={d} /> : null}>
      <Card padded>
        <KvList items={items} />
      </Card>
    </Section>
  );
}

/**
 * A web search for the device, opened in the user's browser (the window's open
 * handler sends https links there, never into the app). It goes somewhere, so
 * it is a link, not a button: dim like a section header link, with the
 * external-link icon in place of the arrow because it leaves the app. The
 * tooltip shows exactly what is searched; see core/deviceLookup.ts.
 */
function LookUpOnline({ device }: { device: Device }) {
  const url = deviceSearchUrl(device);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`Search the web for: ${deviceSearchQuery(device)}`}
      className="inline-flex items-center gap-1 rounded-sm text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      Look up online
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
}
