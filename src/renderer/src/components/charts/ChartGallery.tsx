/**
 * Dev-only gallery of every chart in the kit, with invented data, so charts
 * can be checked in light and dark (the topbar toggle switches appearance).
 * Registered in app/routes.ts only when import.meta.env.DEV is true, at
 * #/dev/charts. Not linked from the sidebar.
 */
import { useState } from "react";

import { formatBytes, formatMbps } from "../../../../core/format";
import { Card, Section } from "~/components/ui/card";
import { Segmented } from "~/components/ui/segmented";
import { bandColor, entityColor, seriesColors } from "~/lib/chartColors";

import { AreaChart } from "./AreaChart";
import { BarChart } from "./BarChart";
import { Donut } from "./Donut";
import { Gauge } from "./Gauge";
import { Heatmap } from "./Heatmap";
import { ShareBar } from "./ShareBar";
import { Sparkline } from "./Sparkline";

/** Seeded generator so the gallery looks the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A daily rhythm: quiet overnight, busy in the evening, with noise and the odd spike. */
function rhythm(n: number, base: number, seed: number, spikes = 0): number[] {
  const next = rng(seed);
  const values = Array.from({ length: n }, (_, i) => {
    const hour = (i / n) * 24;
    const curve = 0.25 + 0.75 * Math.max(0, Math.sin(((hour - 6) / 24) * Math.PI * 2 - 0.6));
    return Math.max(0, base * curve * (0.75 + next() * 0.5));
  });
  for (let k = 0; k < spikes; k += 1) {
    const at = Math.floor(next() * n);
    values[at] = (values[at] ?? 0) + base * (1.5 + next());
  }
  return values;
}

const HOURS = Array.from({ length: 24 }, (_, h) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`));
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GB = 1e9;

const download = rhythm(24, 320, 1, 2);
const upload = rhythm(24, 60, 2, 1);
const eeros = [
  { id: "eero-a", label: "Living room", values: rhythm(24, 1.6 * GB, 3) },
  { id: "eero-b", label: "Office", values: rhythm(24, 1.1 * GB, 4) },
  { id: "eero-c", label: "Basement", values: rhythm(24, 0.5 * GB, 5) },
];
const devices = [
  { id: "tv", label: "Living room TV", values: rhythm(24, 0.9 * GB, 6, 1) },
  { id: "laptop", label: "Work laptop", values: rhythm(24, 0.5 * GB, 7) },
  { id: "phone", label: "Phone", values: rhythm(24, 0.2 * GB, 8) },
];
const heat = DAYS.map((_, d) => rhythm(24, d >= 5 ? 1.3 : 1, 10 + d));
const zeros = Array.from({ length: 24 }, () => 0);

type Mode = "live" | "loading";

export function ChartGallery() {
  const [mode, setMode] = useState<Mode>("live");
  const loading = mode === "loading";

  return (
    <div className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Dev only. Invented data. Use the topbar toggle to check light and dark.
          </p>
          <Segmented
            aria-label="Data state"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "live", label: "Live" },
              { value: "loading", label: "Loading" },
            ]}
          />
        </header>

        <Block title="Area chart" note="Download and upload per hour, overlapping, shared scale">
          <AreaChart
            ariaLabel="Download and upload throughput per hour, last 24 hours"
            series={[
              { id: "down", label: "Download", color: seriesColors.download, values: download },
              { id: "up", label: "Upload", color: seriesColors.upload, values: upload },
            ]}
            labels={HOURS}
            format={formatMbps}
            total={false}
            loading={loading}
            markers={[{ index: 9, label: "Scheduled pause" }]}
          />
        </Block>

        <Block title="Stacked area" note="Data usage by eero per hour, with a Total row">
          <AreaChart
            ariaLabel="Data usage by eero per hour, stacked, last 24 hours"
            series={eeros.map((e, i) => ({ ...e, color: entityColor(i) }))}
            labels={HOURS}
            format={formatBytes}
            stacked
            loading={loading}
          />
        </Block>

        <Block title="Bar chart" note="Usage per hour by device, stacked columns">
          <BarChart
            ariaLabel="Data usage per hour by device, last 24 hours"
            series={devices.map((d, i) => ({ ...d, color: entityColor(i) }))}
            labels={HOURS}
            format={formatBytes}
            loading={loading}
          />
        </Block>

        <div className="grid gap-6 md:grid-cols-2">
          <Block title="Share bar" note="Devices by band">
            <ShareBar
              segments={[
                { label: "5 GHz", value: 24, color: bandColor("5") },
                { label: "2.4 GHz", value: 11, color: bandColor("2.4") },
                { label: "6 GHz", value: 4, color: bandColor("6") },
                { label: "Wired", value: 3, color: bandColor("wired") },
              ]}
              format={(v) => `${v} devices`}
            />
          </Block>

          <Block title="Sparklines" note="Table and eero rows">
            <div className="flex flex-col">
              {eeros.map((e, i) => (
                <div key={e.id} className="flex items-center gap-4 border-b border-border/50 py-2 last:border-b-0">
                  <span className="w-28 shrink-0 text-xs">{e.label}</span>
                  <Sparkline
                    className="h-6 flex-1"
                    values={e.values}
                    color={entityColor(i)}
                    ariaLabel={`${e.label} usage, last 24 hours`}
                    loading={loading}
                  />
                  <span className="w-16 text-right text-xs tabular-nums">
                    {formatBytes(e.values.reduce((a, b) => a + b, 0))}
                  </span>
                </div>
              ))}
            </div>
          </Block>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Block title="Gauges" note="Speed test result">
            <div className="flex flex-wrap items-center justify-around gap-4">
              <Gauge
                size={150}
                value={412}
                max={500}
                color={seriesColors.download}
                label="Download"
                text="412"
                unit="Mbps"
                ariaLabel="Download speed 412 Mbps of 500"
                loading={loading}
              />
              <Gauge
                size={150}
                value={38}
                max={50}
                color={seriesColors.upload}
                label="Upload"
                text="38"
                unit="Mbps"
                ariaLabel="Upload speed 38 Mbps of 50"
                loading={loading}
              />
              <Gauge size={150} value={null} max={500} color={seriesColors.download} label="Not run" unit="Mbps" ariaLabel="No speed test yet" />
            </div>
          </Block>

          <Block title="Donut" note="Devices by band; hover a segment">
            <div className="flex items-center justify-center gap-6">
              <Donut
                ariaLabel="Devices by band: 5 GHz 24, 2.4 GHz 11, 6 GHz 4, wired 3"
                segments={[
                  { label: "5 GHz", value: 24, color: bandColor("5") },
                  { label: "2.4 GHz", value: 11, color: bandColor("2.4") },
                  { label: "6 GHz", value: 4, color: bandColor("6") },
                  { label: "Wired", value: 3, color: bandColor("wired") },
                ]}
                format={(v) => String(v)}
                loading={loading}
              >
                <div className="flex flex-col items-center">
                  <span className="text-2xl font-semibold tabular-nums">42</span>
                  <span className="text-3xs text-muted-foreground">devices</span>
                </div>
              </Donut>
              <Donut ariaLabel="Devices by band, no devices" segments={[]}>
                <span className="text-xs text-muted-foreground">-</span>
              </Donut>
            </div>
          </Block>
        </div>

        <Block title="Heatmap" note="When the network is busy, day by hour">
          <Heatmap
            ariaLabel="Network usage by day of week and hour"
            rows={DAYS}
            columns={24}
            values={heat}
            color={seriesColors.download}
            format={(v) => formatBytes(v * GB)}
            cellLabel={(r, c) => `${DAYS[r] ?? ""} ${HOURS[c] ?? ""}`}
            loading={loading}
          />
        </Block>

        <div className="grid gap-6 md:grid-cols-2">
          <Block title="Loading, no data yet" note="Unlabelled placeholder gridlines">
            <AreaChart
              ariaLabel="Throughput, loading"
              series={[{ id: "down", label: "Download", color: seriesColors.download, values: [] }]}
              labels={[]}
              format={formatMbps}
              loading
              heightClassName="h-36"
            />
          </Block>
          <Block title="Empty range" note="One centred muted sentence">
            <AreaChart
              ariaLabel="Throughput, no activity"
              series={[{ id: "down", label: "Download", color: seriesColors.download, values: zeros }]}
              labels={HOURS}
              format={formatMbps}
              heightClassName="h-36"
            />
          </Block>
        </div>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <Section title={title} subtitle={note}>
      <Card padded>{children}</Card>
    </Section>
  );
}
