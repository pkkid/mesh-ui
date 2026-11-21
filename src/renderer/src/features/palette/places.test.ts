/**
 * Places (docs/ux/overview.md, Command palette, Places): the index built from
 * the page source, its show-if rules, and the items the palette offers. The
 * first test is the safety net: a section or settings row a page shows only
 * sometimes must name a show-if rule, or this fails and names it.
 */
import { describe, expect, it } from "vitest";

import { ROUTES } from "~/app/routes";
import { placeSlug } from "@shared/places";
import { scanPlaces } from "../../../../../scripts/places";
import type { NetworkSettings } from "../../../../core/model";
import { isPlaceRule, PLACE_RULES, type PlaceContext, placeShown } from "./placeRules";
import { placeItems } from "./search";

const places = scanPlaces(process.cwd());
const routeIds = new Set(ROUTES.map((r) => r.id));

describe("Places index", () => {
  it("every place the page shows only sometimes names a show-if rule, and every rule exists", () => {
    const missing = places.filter((p) => p.conditional && !p.when).map((p) => `${p.title} (${p.file}): add when="..." from placeRules.ts`);
    expect(missing).toEqual([]);
    const unknown = places.filter((p) => p.when && !isPlaceRule(p.when)).map((p) => `${p.title}: when="${p.when}"`);
    expect(unknown).toEqual([]);
  });

  it("finds the sections and settings rows of every page, on real routes, each anchor once per page", () => {
    expect(places.length).toBeGreaterThan(60);
    for (const route of ["overview", "advanced", "ports", "updates", "troubleshooting", "signal", "wifi", "guest", "settings", "account"]) {
      expect(places.some((p) => p.route === route), route).toBe(true);
    }
    expect(places.filter((p) => !routeIds.has(p.route as never))).toEqual([]);
    const keys = places.map((p) => `${p.route}|${p.anchor}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Text titles from fragments are read too: "Legacy mode" from `<>Legacy mode{...}</>`.
    expect(places.find((p) => p.route === "advanced" && p.title === "IPv6")).toMatchObject({ kind: "setting" });
    expect(places.find((p) => p.route === "ports" && p.title === "IPv6 firewall rules")).toMatchObject({ kind: "section", when: "ipv6Rules" });
  });

  it("anchors are the title in lower case with dashes, as the components render them", () => {
    expect(placeSlug("Optimize for conferencing and gaming (SQM)")).toBe("optimize-for-conferencing-and-gaming-sqm");
    expect(placeSlug("Isolation & security")).toBe("isolation-security");
    expect(placeSlug("2.4 GHz only")).toBe("2-4-ghz-only");
  });
});

describe("Places show-if rules", () => {
  const ctx = (over: Partial<PlaceContext> = {}): PlaceContext => ({
    network: undefined,
    settings: undefined,
    account: undefined,
    guest: undefined,
    wifi: undefined,
    coverageMissing: false,
    upgradeMissing: false,
    ...over,
  });
  const settings = (over: Partial<NetworkSettings>) => ({ connectionMode: "nat", ipv6: { enabled: true }, ...over }) as NetworkSettings;

  it("IPv6 firewall rules show only in router mode with IPv6 on; unknown data hides them", () => {
    expect(PLACE_RULES.ipv6Rules(ctx({ settings: settings({}) }))).toBe(true);
    expect(PLACE_RULES.ipv6Rules(ctx({ settings: settings({ ipv6: { enabled: false } }) }))).toBe(false);
    expect(PLACE_RULES.ipv6Rules(ctx({ settings: settings({ connectionMode: "bridged" }) }))).toBe(false);
    expect(placeShown("ipv6Rules", ctx())).toBe(false);
    expect(placeShown(null, ctx())).toBe(true);
    expect(placeShown("no-such-rule", ctx({ settings: settings({}) }))).toBe(false);
  });

  it("the palette offers a page's places with their page as context, leaving out the ones the rules hide", () => {
    const routes = [{ id: "advanced", path: "/settings/advanced", title: "Advanced networking" }];
    const list = [
      { route: "advanced", title: "DNS", kind: "setting" as const, anchor: "dns", when: "nat" },
      { route: "advanced", title: "Thread", kind: "setting" as const, anchor: "thread", when: "thread" },
      { route: "nowhere", title: "Lost", kind: "section" as const, anchor: "lost", when: null },
    ];
    const items = placeItems(list, routes, (rule) => rule !== "thread");
    expect(items).toEqual([
      { kind: "page", key: "place:advanced:dns", label: "DNS", path: "/settings/advanced", routeId: "advanced", anchor: "dns", context: "Advanced networking", place: "setting" },
    ]);
  });
});
