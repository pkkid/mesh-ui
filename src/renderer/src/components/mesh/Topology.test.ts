import { describe, expect, it } from "vitest";

import type { Eero } from "../../../../core/model";
import { fitView, layoutMesh, MAP_HEIGHT_PX, meshBounds, ZOOM_MAX, ZOOM_MIN, zoomAt } from "./Topology";

/** An invented eero; only the fields a test names matter. */
function eero(over: Partial<Eero> & Pick<Eero, "id" | "location">): Eero {
  return {
    serial: null,
    model: null,
    modelNumber: null,
    isGateway: false,
    status: "online",
    firmware: null,
    updateAvailable: null,
    endOfLife: null,
    backhaul: "wireless",
    meshBars: 4,
    upstream: null,
    hop: null,
    meshQuality: null,
    clients: { total: null, wired: null, wireless: null },
    bands: [],
    radios: [],
    led: { on: null, brightness: null },
    nightlight: null,
    ipv4: null,
    ipv6: [],
    ...over,
  } as Eero;
}

/** A gateway and a chain of `hops` columns, two eeros in the first. */
function mesh(hops: number): Eero[] {
  const out = [eero({ id: "gw", location: "Hall", isGateway: true, hop: 0, backhaul: "wired" })];
  out.push(eero({ id: "a1", location: "Den", upstream: "gw", hop: 1 }), eero({ id: "a2", location: "Office", upstream: "gw", hop: 1 }));
  for (let h = 2; h <= hops; h++) out.push(eero({ id: `h${h}`, location: `Hop ${h}`, upstream: h === 2 ? "a1" : `h${h - 1}`, hop: h }));
  return out;
}

const centreX = (layout: ReturnType<typeof layoutMesh>) => {
  const xs = [...layout.nodes.map((n) => n.x), ...(layout.internet ? [layout.internet.x] : [])];
  return (Math.min(...xs) + Math.max(...xs)) / 2;
};
const centreY = (layout: ReturnType<typeof layoutMesh>) => {
  const b = meshBounds(layout, { w: 0, h: MAP_HEIGHT_PX });
  return ((b.y0 + b.y1) / 2 / MAP_HEIGHT_PX) * 100;
};

describe("layoutMesh centring", () => {
  for (const hops of [1, 2, 3]) {
    it(`centres a mesh with ${hops} hop column${hops > 1 ? "s" : ""}`, () => {
      for (const wiredChip of [false, true]) {
        const layout = layoutMesh(mesh(hops), { internet: true, wiredChip });
        expect(centreX(layout)).toBeCloseTo(50, 6);
        expect(centreY(layout)).toBeCloseTo(50, 6);
      }
    });
  }

  it("keeps the column spacing capped at 30 percent", () => {
    const layout = layoutMesh(mesh(1), { internet: true });
    const gw = layout.nodes.find((n) => n.eero.isGateway);
    const hop1 = layout.nodes.find((n) => n.eero.id === "a1");
    expect(hop1!.x - gw!.x).toBeLessThanOrEqual(30);
  });

  it("centres without the Internet node, and moves the links and chip with the nodes", () => {
    const layout = layoutMesh(mesh(2), { internet: false, wiredChip: true });
    expect(layout.internet).toBeNull();
    expect(centreX(layout)).toBeCloseTo(50, 6);
    const gw = layout.nodes.find((n) => n.eero.isGateway)!;
    expect(layout.chip).toEqual({ x: gw.x, y: gw.y + 36 });
    for (const link of layout.links) {
      const to = layout.nodes.find((n) => n.eero.id === link.eeroId)!;
      expect(link.to).toBe(to);
    }
  });

  it("puts a lone gateway in the middle", () => {
    const layout = layoutMesh([eero({ id: "gw", location: "Hall", isGateway: true, hop: 0 })], { internet: false });
    expect(layout.nodes[0]!.x).toBeCloseTo(50, 6);
  });
});

describe("map zoom and pan", () => {
  const size = { w: 900, h: MAP_HEIGHT_PX };

  it("fits a small mesh at 100% and centres it in the room above the legend", () => {
    const layout = layoutMesh(mesh(1), { internet: true });
    const view = fitView(layout, size, 32);
    expect(view.scale).toBe(1);
    // Within a few px of centre: the Internet label takes a little less room than an eero.
    expect(Math.abs(view.x)).toBeLessThan(8);
    expect(view.y).toBeCloseTo(-16, 0);
  });

  it("shrinks a mesh that does not fit, but not below the zoom floor", () => {
    const layout = layoutMesh(mesh(3), { internet: true, wiredChip: true });
    const narrow = fitView(layout, { w: 420, h: MAP_HEIGHT_PX });
    expect(narrow.scale).toBeLessThan(1);
    expect(narrow.scale).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(fitView(layout, { w: 60, h: MAP_HEIGHT_PX }).scale).toBe(ZOOM_MIN);
  });

  it("leaves the map unscaled until the box is measured", () => {
    expect(fitView(layoutMesh(mesh(1), { internet: true }), { w: 0, h: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("zooms about a point, keeping it still, within the range", () => {
    const from = { scale: 1, x: 10, y: -5 };
    const at = { x: 120, y: 40 };
    const to = zoomAt(from, 1.5, at);
    expect(to.scale).toBe(1.5);
    // The layer point under `at` before the zoom is still under it after.
    const layerPoint = { x: (at.x - from.x) / from.scale, y: (at.y - from.y) / from.scale };
    expect(to.x + to.scale * layerPoint.x).toBeCloseTo(at.x, 6);
    expect(to.y + to.scale * layerPoint.y).toBeCloseTo(at.y, 6);
    expect(zoomAt(from, 10).scale).toBe(ZOOM_MAX);
    expect(zoomAt(from, 0.01).scale).toBe(ZOOM_MIN);
  });
});
