/**
 * Pure helpers for the eero detail page: the wording and graph walks its
 * components use, kept free of React and the `~` alias so they can be unit
 * tested (helpers.test.ts). docs/ux/pages/eero-detail.md.
 */
import type { Eero, EeroPort, Radio } from "../../../../core/model";

/** "Tri-band Wi-Fi 7", "Dual-band": band count, plus the Wi-Fi generation when the model name carries it. */
export function radioBadge(e: Pick<Eero, "bands" | "model">): string | null {
  const n = e.bands.filter((b) => b !== "wired").length;
  const bands = n >= 3 ? "Tri-band" : n === 2 ? "Dual-band" : null;
  const gen = /\b(7|6E|6)$/i.exec(e.model ?? "")?.[1]?.toUpperCase();
  return [bands, gen ? `Wi-Fi ${gen}` : null].filter(Boolean).join(" ") || null;
}

/** LED state from `eero.led`: on at full, dimmed, off, or unknown. */
export function ledState(e: Eero | null, offline: boolean): "on" | "dim" | "off" | "unknown" {
  if (!e || offline || e.led.on === null) return "unknown";
  if (!e.led.on) return "off";
  return e.led.brightness !== null && e.led.brightness < 100 ? "dim" : "on";
}

/** "Auto channel selection on", "Fixed channel on 5 GHz", or null when eero does not say. */
export function autoChannelLine(radios: ReadonlyArray<Radio>): string | null {
  const known = radios.filter((r) => r.autoChannel !== null);
  if (known.length === 0) return null;
  const fixed = known.filter((r) => r.autoChannel === false);
  if (fixed.length === 0) return "Auto channel selection on";
  if (fixed.length === known.length) return "Auto channel selection off";
  return `Fixed channel on ${fixed.map((r) => `${r.band} GHz`).join(", ")}`;
}

/** This eero's upstream (the gateway when eero reports none) and the eeros that hang off it. */
export function uplinkOf(eero: Eero, eeros: ReadonlyArray<Eero>): { upstream: Eero | null; downstream: Eero[] } {
  const others = eeros.filter((e) => e.id !== eero.id);
  const upstream = eero.isGateway ? null : (others.find((e) => e.id === eero.upstream) ?? others.find((e) => e.isGateway) ?? null);
  const downstream = others
    .filter((e) => !e.isGateway && (e.upstream === eero.id || (eero.isGateway && e.upstream === null)))
    .sort((a, b) => a.location.localeCompare(b.location));
  return { upstream, downstream };
}

/** "2.5 GbE", "10 GbE", "100 Mb". */
export const ethernet = (mbps: number) => (mbps >= 1000 ? `${Number((mbps / 1000).toFixed(1))} GbE` : `${mbps} Mb`);

/** "2 x 5 GbE, numbered left to right", "2 x 10 GbE, 2 x 2.5 GbE, numbered left to right". */
export function portsLine(ports: ReadonlyArray<EeroPort>): string | null {
  if (ports.length === 0) return null;
  const counts = new Map<number, number>();
  for (const p of ports) if (p.supportedMbps) counts.set(p.supportedMbps, (counts.get(p.supportedMbps) ?? 0) + 1);
  const speeds = [...counts].sort((a, b) => b[0] - a[0]).map(([mbps, n]) => `${n} x ${ethernet(mbps)}`);
  return [speeds.join(", ") || `${ports.length} ports`, "numbered left to right"].join(", ");
}

/** "Port 1", or eero's own name for it ("WAN"). */
export const portName = (p: Pick<EeroPort, "number" | "name">) => p.name ?? `Port ${p.number}`;

/** "2 AM", "12 PM". */
export const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h % 24 < 12 ? "AM" : "PM"}`;

/** eero's update window: three hours from the preferred hour ("2 to 5 AM"). */
export function updateWindow(hour: number | null): string | null {
  if (hour === null) return null;
  const from = hourWord(hour);
  const to = hourWord((hour + 3) % 24);
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)} to ${to}` : `${from} to ${to}`;
}

/** "IPv4 192.168.4.22" lines for every known address, for the card's copy button. */
export function ipText(e: Pick<Eero, "ipv4" | "ipv6" | "subnet" | "gatewayIp">): string {
  const rows: [string, string | null][] = [["IPv4", e.ipv4], ...e.ipv6.map((ip): [string, string] => ["IPv6", ip]), ["Subnet", e.subnet], ["Gateway", e.gatewayIp]];
  return rows.flatMap(([k, v]) => (v ? [`${k} ${v}`] : [])).join("\n");
}

/** Restart copy: who drops and for how long (about 1 minute for a leaf, 2 to 3 for the gateway; commands.md#restart-estimates). */
export function restartLine(eero: Eero, eeros: ReadonlyArray<Eero>, networkName: string): string {
  if (eero.isGateway) return `Everyone on ${networkName} loses internet for about 2 to 3 minutes`;
  const downstream = eeros.filter((e) => e.upstream === eero.id).map((e) => e.location);
  const also = downstream.length > 0 ? ` and ${downstream.join(", ")} (downstream)` : "";
  return `Its devices${also} drop for about 1 minute`;
}
