/**
 * Fake eero node routes: `GET {net}/eeros`, `GET /eeros/:id`, its
 * `connections` (ports) and `firmware_update/history`, and the writes:
 * rename (`PUT /eeros/:id` form), status light (`PUT /eeros/:id/led` form),
 * find (`POST /eeros/:serial/led_cycle` form), nightlight (`PUT
 * /eeros/:id/nightlight/settings` JSON) and restart (`POST /eeros/:id/reboot`,
 * 201). See docs/eero-api/endpoints.md (eeros).
 */

import type { RawEero } from "../../../src/core/eero/raw";
import { FakeAnswer, fail, ok, type Route } from "../server";
import type { FakeNetwork, FakeState } from "../state";

/** The network that owns an eero id, or null. */
function owner(state: FakeState, id: string): FakeNetwork | null {
  for (const net of state.networks.values()) if (net.eeros.some((e) => e.url === `/2.2/eeros/${id}`)) return net;
  return null;
}

/** The eero with this id, or a 404 answer. */
function eeroById(state: FakeState, id: string): RawEero {
  for (const net of state.networks.values()) {
    const eero = net.eeros.find((e) => e.url === `/2.2/eeros/${id}`);
    if (eero) return eero;
  }
  throw new FakeAnswer(fail(404, "error.eero.not.found"));
}

/** Form values arrive as strings: "true" / "false". */
const formBool = (v: unknown) => (v === "true" || v === true ? true : v === "false" || v === false ? false : undefined);
const formInt = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : typeof v === "number" ? v : undefined);

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/eeros",
    handle: ({ params, network }) => ok(network(params.net ?? "").eeros),
  },
  {
    method: "GET",
    path: "/eeros/:id",
    handle: ({ params, state }) => {
      for (const net of state.networks.values()) {
        const eero = net.eeros.find((e) => e.url === `/2.2/eeros/${params.id}`);
        if (eero) return ok(eero);
      }
      return fail(404, "error.eero.not.found");
    },
  },
  {
    method: "GET",
    path: "/eeros/:id/connections",
    handle: ({ params, state }) => {
      const id = params.id ?? "";
      const net = owner(state, id);
      return net ? ok(net.connections[id] ?? { ports: { layout: "none", interfaces: [] } }) : fail(404, "error.eero.not.found");
    },
  },
  {
    method: "GET",
    path: "/eeros/:id/firmware_update/history",
    handle: ({ params, state, req }) => {
      const id = params.id ?? "";
      const net = owner(state, id);
      if (!net) return fail(404, "error.eero.not.found");
      // eero wraps the rows: `{data: [...], meta: {has_more}}`, newest first.
      const offset = Number(req.query.get("offset") ?? 0) || 0;
      const limit = Number(req.query.get("limit") ?? 20) || 20;
      const rows = net.firmwareHistory[id] ?? [];
      return ok({ data: rows.slice(offset, offset + limit), meta: { has_more: offset + limit < rows.length } });
    },
  },
  {
    method: "PUT",
    path: "/eeros/:id",
    handle: ({ params, state, req }) => {
      const eero = eeroById(state, params.id ?? "");
      const location = req.body.location;
      if (req.encoding !== "form" || typeof location !== "string" || !location.trim()) return fail(400, "error.validation.location");
      eero.location = location;
      return ok(eero);
    },
  },
  {
    method: "PUT",
    path: "/eeros/:id/led",
    handle: ({ params, state, req }) => {
      const eero = eeroById(state, params.id ?? "");
      // eero reads the form body; a JSON PUT does nothing (FF).
      if (req.encoding !== "form") return ok(eero);
      const on = formBool(req.body.led_on);
      const brightness = formInt(req.body.led_brightness);
      if (brightness !== undefined && (brightness < 0 || brightness > 100)) return fail(400, "error.validation.led_brightness");
      if (on !== undefined) eero.led_on = on;
      if (brightness !== undefined) eero.led_brightness = brightness;
      return ok({ led_on: eero.led_on, led_brightness: eero.led_brightness });
    },
  },
  {
    method: "POST",
    path: "/eeros/:serial/led_cycle",
    handle: ({ params, state }) => {
      // Addressed by serial, as the clients send it.
      for (const net of state.networks.values()) if (net.eeros.some((e) => e.serial === params.serial)) return ok(null);
      return fail(404, "error.eero.not.found");
    },
  },
  {
    method: "PUT",
    path: "/eeros/:id/nightlight/settings",
    handle: ({ params, state, req }) => {
      const eero = eeroById(state, params.id ?? "");
      if (!eero.nightlight) return fail(400, "error.eero.not.capable");
      const b = req.body as { enabled?: boolean; brightness_percentage?: number; schedule?: { enabled?: boolean; on?: string; off?: string } };
      eero.nightlight = {
        ...eero.nightlight,
        enabled: b.enabled ?? eero.nightlight.enabled,
        brightness_percentage: b.brightness_percentage ?? eero.nightlight.brightness_percentage,
        schedule: { ...eero.nightlight.schedule, ...b.schedule },
      };
      return ok(eero.nightlight);
    },
  },
  {
    method: "POST",
    path: "/eeros/:id/reboot",
    handle: ({ params, state }) => {
      const eero = eeroById(state, params.id ?? "");
      if (eero.status === "red") return fail(400, "error.eero.offline");
      eero.last_reboot = new Date(state.now()).toISOString();
      return ok(null, 201);
    },
  },
];
