/**
 * Fake software update routes: `GET {net}/updates`, the same object the
 * network embeds as `updates`, and the release notes manifest it names
 * (public: no session). Writes: `POST {net}/updates` (empty JSON) starts an
 * install only when `can_update_now`: `update_status` reads `installing`
 * for FAKE_INSTALL_MS, then every eero is on the target and the network is
 * up to date. `POST {net}/updates/preferred_update_hour` JSON
 * `{preferred_update_hour: 0..23}`. See docs/eero-api/endpoints.md (updates).
 */

import { fail, ok, type Route } from "../server";
import { FAKE_MANIFEST, isOwnerRole, FAKE_MANIFEST_PATH, type FakeNetwork, type FakeState } from "../state";

/** How long a fake install takes, so `--fake` shows the installing state and then the eeros returning. */
export const FAKE_INSTALL_MS = 20_000;

/** Finishes an install whose time has passed. */
function settle(net: FakeNetwork, state: FakeState): void {
  if (net.installUntil == null || state.now() < net.installUntil) return;
  const u = net.updates;
  const target = u.target_firmware ?? null;
  if (target) for (const e of net.eeros) e.os_version = target;
  Object.assign(u, { update_status: "up_to_date", has_update: false, target_firmware: null, update_to_firmware: null, scheduled_update_time: null });
  net.installUntil = null;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/updates",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      settle(net, state);
      const updates = net.updates;
      // eero names an absolute URL; the fake's origin is only known per request (in-process or a random port).
      const manifest = updates.manifest_resource?.startsWith("/") ? `http://${req.headers.host ?? "127.0.0.1"}${updates.manifest_resource}` : updates.manifest_resource;
      return ok({ ...updates, manifest_resource: manifest });
    },
  },
  {
    method: "POST",
    path: "/networks/:net/updates",
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      settle(net, state);
      const u = net.updates;
      if (!isOwnerRole(net.permissions.role)) return fail(403, "error.network.forbidden");
      if (u.can_update_now !== true || u.has_update !== true || u.update_status === "installing") return fail(400, "error.updates.not_available");
      u.update_status = "installing";
      u.last_update_started = new Date(state.now()).toISOString();
      net.installUntil = state.now() + FAKE_INSTALL_MS;
      return ok(null);
    },
  },
  {
    method: "POST",
    path: "/networks/:net/updates/preferred_update_hour",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      const hour = Number(req.body.preferred_update_hour);
      if (req.body.preferred_update_hour === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) return fail(400, "error.updates.preferred_update_hour.invalid");
      net.updates.preferred_update_hour = hour;
      return ok(null);
    },
  },
  {
    method: "GET",
    path: FAKE_MANIFEST_PATH.replace(/^\/2\.2/, ""),
    auth: "none",
    versions: ["2.2"],
    handle: () => ok(FAKE_MANIFEST),
  },
];
