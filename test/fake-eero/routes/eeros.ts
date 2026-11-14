/**
 * Fake eero node routes: `GET {net}/eeros`, `GET /eeros/:id`, its
 * `connections` (ports) and `firmware_update/history`, and the writes:
 * rename (`PUT /eeros/:id` form), status light (`PUT /eeros/:id/led` form),
 * find (`POST /eeros/:serial/led_cycle` form), nightlight (`PUT
 * /eeros/:id/nightlight/settings` JSON), restart (`POST /eeros/:id/reboot`,
 * 201), port actions (`POST /eeros/:id/ports/:n/action` JSON `{action}`) and
 * remove (`DELETE /eeros/:id`). See docs/eero-api/endpoints.md (eeros).
 */

import type { RawEero, RawPortInterface } from "../../../src/core/eero/raw";
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

/** Each action's opposite, as eero lists only what applies now. */
const OPPOSITE: Record<string, string> = {
  ENABLE_PORT: "DISABLE_PORT",
  DISABLE_PORT: "ENABLE_PORT",
  ENABLE_DATA: "DISABLE_DATA",
  DISABLE_DATA: "ENABLE_DATA",
  ENABLE_POE: "DISABLE_POE",
  DISABLE_POE: "ENABLE_POE",
};

/** What a disabled port had, so enabling it brings the link back. The real disabled `port_status` is unknown; the fake uses "DISABLED". */
const parked = new WeakMap<RawPortInterface, Pick<RawPortInterface, "port_status" | "negotiated_speed" | "connection_status">>();

function applyPortAction(p: RawPortInterface, action: string): void {
  if (action === "DISABLE_PORT") {
    parked.set(p, { port_status: p.port_status, negotiated_speed: p.negotiated_speed, connection_status: p.connection_status });
    Object.assign(p, { port_status: "DISABLED", negotiated_speed: null, connection_status: null });
  } else if (action === "ENABLE_PORT") {
    Object.assign(p, parked.get(p) ?? { port_status: "DISCONNECTED", negotiated_speed: null, connection_status: null });
    parked.delete(p);
  } else if (action === "ENABLE_POE" || action === "DISABLE_POE") {
    p.poe_status = action === "ENABLE_POE" ? "ON" : "OFF";
  }
  const opposite = OPPOSITE[action];
  if (opposite) p.actions = (p.actions ?? []).map((a) => (a.type === action ? { ...a, type: opposite } : a));
}

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
  {
    method: "POST",
    path: "/eeros/:id/ports/:n/action",
    handle: ({ params, state, req }) => {
      const id = params.id ?? "";
      const net = owner(state, id);
      if (!net) return fail(404, "error.eero.not.found");
      const eero = eeroById(state, id);
      if (eero.status === "red") return fail(400, "error.eero.offline");
      const port = net.connections[id]?.ports?.interfaces?.find((p) => String(p.interface_number) === params.n);
      if (!port) return fail(404, "error.port.not.found");
      const action = (req.body as { action?: unknown }).action;
      if (req.encoding !== "json" || typeof action !== "string") return fail(400, "error.validation.action");
      // eero refuses an action the port does not list.
      if (!(port.actions ?? []).some((a) => a.type === action)) return fail(400, "error.port.action.not.allowed");
      applyPortAction(port, action);
      return ok(null);
    },
  },
  {
    method: "DELETE",
    path: "/eeros/:id",
    handle: ({ params, state }) => {
      const id = params.id ?? "";
      const net = owner(state, id);
      if (!net) return fail(404, "error.eero.not.found");
      const eero = eeroById(state, id);
      // Removing the gateway while others depend on it is refused (core never asks).
      if (eero.gateway && net.eeros.length > 1) return fail(400, "error.eero.gateway");
      net.eeros = net.eeros.filter((e) => e !== eero);
      delete net.connections[id];
      return ok(null);
    },
  },
];
