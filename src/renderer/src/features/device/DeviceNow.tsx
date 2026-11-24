/**
 * Device detail's Live throughput column (docs/ux/pages/device-detail.md,
 * Layout 1): the shared hero panel from Devices (`LivePanel`) for this one
 * device. With Live off it is the dim "Live throughput off" watermark; with
 * Live on it shows this device's download and upload, a chart of its readings
 * since Live was turned on, and when the last reading came. An offline,
 * paused or blocked device has no live rates, so the watermark says why.
 * While Live is on, LiveCollector (in the shell) asks for
 * `device.rates.refresh` on every page and refetches `device.get` once the
 * rates have settled; the chart's readings are recorded there too.
 */
import { LivePanel } from "~/features/devices/LiveThroughput";
import { networkClock } from "../../../../core/format";
import type { Device } from "../../../../core/model";

export function DeviceNow({ device: d, timezone }: { device: Device; timezone: string | null | undefined }) {
  const unavailable = d.blocked ? "Device blocked" : !d.connected ? "Device offline" : d.paused ? "Device paused" : null;
  const { timeSeconds } = networkClock(timezone ?? "UTC");
  return (
    <LivePanel
      id={`device:${d.id}`}
      rates={d.rates}
      timezone={timezone}
      unavailable={unavailable}
      className="w-96"
      ariaLabel={`Current download and upload for ${d.name}, since Live was turned on`}
      footer={(r) => (r ? `Last reading ${timeSeconds(r.at)}` : "No live rates yet")}
    />
  );
}
