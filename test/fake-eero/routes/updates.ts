/**
 * Fake software update routes: `GET {net}/updates`, the same object the
 * network embeds as `updates`, and the release notes manifest it names
 * (public: no session). See docs/eero-api/endpoints.md (updates).
 */

import { ok, type Route } from "../server";
import { FAKE_MANIFEST, FAKE_MANIFEST_PATH } from "../state";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/updates",
    handle: ({ req, params, network }) => {
      const updates = network(params.net ?? "").updates;
      // eero names an absolute URL; the fake's origin is only known per request (in-process or a random port).
      const manifest = updates.manifest_resource?.startsWith("/") ? `http://${req.headers.host ?? "127.0.0.1"}${updates.manifest_resource}` : updates.manifest_resource;
      return ok({ ...updates, manifest_resource: manifest });
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
