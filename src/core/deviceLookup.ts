/**
 * "Look up online" for a device you do not recognise (device detail, Device
 * information): a web search built from what eero knows about it. One
 * implementation, so every surface searches for the same thing.
 *
 * What goes in: the manufacturer and model, the hostname when it is not just
 * the device's name or a MAC, and the MAC's vendor prefix (the first three
 * octets, which name the maker of the network chip) with "OUI". Never the
 * full MAC, which is unique to the user's device and does not help a search,
 * and no prefix for a private (randomised) or other locally administered MAC,
 * which names nobody.
 */
import type { Device } from "./model";

const SEARCH_URL = "https://www.google.com/search?q=";

const norm = (s: string | null | undefined) => (s ?? "").trim();
const hexOnly = (s: string) => s.toLowerCase().replace(/[^0-9a-f]/g, "");

/** The search text, or null when there is nothing worth searching for. */
export function deviceSearchQuery(d: Pick<Device, "name" | "manufacturer" | "model" | "hostname" | "mac" | "privateMac">): string | null {
  const parts: string[] = [];
  const maker = norm(d.manufacturer);
  const model = norm(d.model);
  if (maker) parts.push(maker);
  // eero's model often repeats the maker ("Amazon Echo Dot"); keep it once.
  if (model) parts.push(maker && model.toLowerCase().startsWith(maker.toLowerCase()) ? model.slice(maker.length).trim() || model : model);
  const host = norm(d.hostname);
  const mac = hexOnly(d.mac ?? "");
  // A hostname that is the device's name, or the MAC written out, adds nothing.
  if (host && host.toLowerCase() !== norm(d.name).toLowerCase() && !(mac && hexOnly(host) === mac && host.length >= 12)) parts.push(host);
  // A locally administered MAC (second-lowest bit of the first octet set) is made up, private or not: no vendor.
  const local = mac.length === 12 && (Number.parseInt(mac.slice(0, 2), 16) & 0x02) !== 0;
  if (!d.privateMac && !local && mac.length === 12) parts.push(`${mac.slice(0, 2)}:${mac.slice(2, 4)}:${mac.slice(4, 6)} OUI`);
  const q = parts.filter(Boolean).join(" ").trim();
  return q || null;
}

/** The web search URL for a device, or null when there is nothing to search for. */
export function deviceSearchUrl(d: Parameters<typeof deviceSearchQuery>[0]): string | null {
  const q = deviceSearchQuery(d);
  return q ? SEARCH_URL + encodeURIComponent(q) : null;
}
