/**
 * Show-if rules for Places (docs/ux/overview.md, Command palette, Places).
 * A section or settings row the page shows only sometimes names its rule
 * with a `when` prop (`<Section title="IPv6 firewall rules" when="ipv6Rules">`);
 * the palette offers that place only while the rule passes, from the same
 * cached reads the page uses. scripts/places.ts finds every conditional place
 * and places.test.ts fails on one without a rule, so the page and the search
 * cannot disagree for long.
 *
 * A rule answers true, false, or undefined while its data has not loaded:
 * an unknown place is left out until the data arrives.
 */
import { useQuery } from "~/app/useCommand";
import type { Account, GuestNetwork, Network, NetworkSettings, WifiInsights, WifiSettings } from "../../../../core/model";

export type PlaceContext = {
  network: Network | undefined;
  settings: NetworkSettings | undefined;
  account: Account | undefined;
  guest: GuestNetwork | undefined;
  wifi: WifiSettings | undefined;
  /** The Signal page's `wifi.insights`, from the cache only (it reads eero's upgrade report, which can be slow). */
  insights: WifiInsights | undefined;
};

const known = <T,>(v: T | undefined, f: (v: T) => boolean): boolean | undefined => (v === undefined ? undefined : f(v));
const and = (a: boolean | undefined, b: boolean | undefined): boolean | undefined => (a === false || b === false ? false : a === undefined || b === undefined ? undefined : true);

const nat = (c: PlaceContext) => known(c.settings?.connectionMode ?? c.network?.connectionMode ?? undefined, (m) => m === "nat");

/** Every rule a `when` prop may name. Each matches the condition its page uses to show the place. */
export const PLACE_RULES = {
  /** eero runs the network (not bridge or IP passthrough): profiles, reservations, forwards, DNS and the NAT-only rows. */
  nat,
  /** IPv6 firewall rules: router mode and IPv6 on. */
  ipv6Rules: (c: PlaceContext) => and(nat(c), known(c.settings, (s) => s.ipv6.enabled !== false)),
  /** NAT port mode: router mode, and eero reports it. */
  natPortMode: (c: PlaceContext) => and(nat(c), known(c.settings, (s) => s.natRandomization !== null)),
  /** Local DNS caching: router mode, and eero reports it. */
  dnsCaching: (c: PlaceContext) => and(nat(c), known(c.settings, (s) => s.dns.caching !== null)),
  /** UPnP: router mode, and eero reports it. */
  upnp: (c: PlaceContext) => and(nat(c), known(c.settings, (s) => s.upnp !== null)),
  /** SQM: router mode, and eero reports it. */
  sqm: (c: PlaceContext) => and(nat(c), known(c.settings, (s) => s.sqm !== null)),
  /** Eco efficiency and the power saving schedule: the gateway can do it and eero reports it. */
  powerSaving: (c: PlaceContext) =>
    and(
      known(c.network, (n) => n.capabilities.power_saving !== false),
      known(c.settings, (s) => !(s.powerSaving.enabled === null && s.powerSaving.scheduleEnabled === null)),
    ),
  /** Multi-link operation: eero reports it (Wi-Fi 7 networks). */
  mlo: (c: PlaceContext) => known(c.settings, (s) => s.mlo !== null),
  /** Thread: the network has a Thread border router. */
  thread: (c: PlaceContext) => known(c.settings, (s) => s.thread !== null),
  /** Stay up to date: eero reports the marketing email consent. */
  marketingEmails: (c: PlaceContext) => known(c.account, (a) => typeof a.marketingEmails === "boolean"),
  /** The guest network's usage, isolation and devices: it is on, in router mode. */
  guestOn: (c: PlaceContext) => and(nat(c), known(c.guest, (g) => g.enabled)),
  /** 2.4 GHz only: the network has a 2.4 GHz band to keep. */
  twoFourBand: (c: PlaceContext) => known(c.wifi, (w) => w.bands.some((b) => b.band === "2.4")),
  /** Signal's What holds them back: eero's upgrade report exists on this network. */
  upgradeReport: (c: PlaceContext) => known(c.insights, (i) => i.report),
  /** Owner-only sections (Transfer network). */
  owner: (c: PlaceContext) => known(c.network, (n) => n.role === null || n.role === "owner"),
} as const satisfies Record<string, (c: PlaceContext) => boolean | undefined>;

export type PlaceRule = keyof typeof PLACE_RULES;

export const isPlaceRule = (name: string): name is PlaceRule => Object.hasOwn(PLACE_RULES, name);

/**
 * The data the rules read, from the same queries the pages use: when the palette opens, a cold one is read once
 * (shared with every page through the engine cache), never per keystroke.
 */
export function usePlaceContext(enabled: boolean): PlaceContext {
  const network = useQuery<Network>("network.get", undefined, { enabled });
  const settings = useQuery<NetworkSettings>("settings.get", undefined, { enabled });
  const account = useQuery<Account>("account.get", undefined, { enabled });
  const guest = useQuery<GuestNetwork>("guest.get", undefined, { enabled });
  const wifi = useQuery<WifiSettings>("wifi.get", undefined, { enabled });
  // `enabled: false` reads what the Signal page left in the cache without reading eero.
  const insights = useQuery<WifiInsights>("wifi.insights", undefined, { enabled: false });
  return {
    network: network.data,
    settings: settings.data,
    account: account.data,
    guest: guest.data,
    wifi: wifi.data,
    insights: insights.data,
  };
}

/** Whether a place with this rule (or none) is shown now; an unknown answer hides it until the data arrives. */
export function placeShown(rule: string | null, ctx: PlaceContext): boolean {
  if (!rule) return true;
  return isPlaceRule(rule) ? PLACE_RULES[rule](ctx) === true : false;
}
