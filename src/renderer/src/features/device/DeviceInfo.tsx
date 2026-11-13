/**
 * Device detail "Device information" (docs/ux/pages/device-detail.md,
 * Layout 2): maker, model, hostname, MAC, then the connection. Wi-Fi devices
 * show security, standard, channel, link rate and SNR; wired devices show
 * the eero port and its negotiated speed instead. Anything eero does not
 * report, or that only applies while connected, shows `-`.
 */
import { ShieldCheck } from "lucide-react";

import { useQuery } from "~/app/useCommand";
import { Card, Section } from "~/components/ui/card";
import { type KvItem, KvList } from "~/components/ui/kv-list";
import { formatMbps, formatPercent } from "../../../../core/format";
import type { Device, Eero } from "../../../../core/model";

import type { DeviceView } from "./DevicePage";

const join = (parts: (string | null | undefined)[]) => {
  const shown = parts.filter((p): p is string => !!p);
  return shown.length ? shown.join(" · ") : null;
};

function firstSeen(iso: string | null, timeZone: string | null | undefined): string | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timeZone || "UTC" }).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(ms);
  }
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
  items.push({ label: "First seen", value: d ? firstSeen(d.firstSeen, view.network?.timezone) : null });

  return (
    <Section title="Device information">
      <Card padded>
        <KvList items={items} />
      </Card>
    </Section>
  );
}
