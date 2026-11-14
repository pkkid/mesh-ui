/**
 * Fake guest network: `GET {net}/guestnetwork` (the network's embedded
 * `guest_network`, password in the clear as eero sends it) and
 * `GET {net}/wpa3_per_band`, which the guest network's security mirrors.
 * Guests are the devices with `is_guest`; eero has no guest device list.
 * Writes change the embedded `guest_network`: `PUT {net}/guestnetwork`
 * (`enabled`, `name`), `PUT {net}/guestnetwork/password` (`password`) and
 * `DELETE` there (open network). Form fields arrive as strings.
 * Shapes: docs/eero-api/endpoints.md sections 11 and 17.
 */

import { fail, ok, type Route } from "../server";
import type { FakeNetwork } from "../state";

const guestOf = (net: FakeNetwork) => net.network.guest_network ?? null;

/** A form boolean: `"true"` or `"false"` (JSON sends real booleans). */
const bool = (v: unknown): boolean | undefined => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined);

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/guestnetwork",
    handle: ({ params, network }) => {
      const guest = guestOf(network(params.net ?? ""));
      return guest ? ok(guest) : fail(404, "error.guestnetwork.not.found");
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/guestnetwork",
    handle: ({ params, network, req }) => {
      const { body } = req;
      const guest = guestOf(network(params.net ?? ""));
      if (!guest) return fail(404, "error.guestnetwork.not.found");
      const enabled = bool(body.enabled);
      if (body.enabled !== undefined && enabled === undefined) return fail(400, "error.guestnetwork.enabled.invalid");
      if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim() === "")) return fail(400, "error.guestnetwork.name.invalid");
      if (enabled !== undefined) guest.enabled = enabled;
      if (typeof body.name === "string") guest.name = body.name;
      return ok(guest);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/guestnetwork/password",
    handle: ({ params, network, req }) => {
      const { body } = req;
      const guest = guestOf(network(params.net ?? ""));
      if (!guest) return fail(404, "error.guestnetwork.not.found");
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 63) return fail(400, "error.guestnetwork.password.invalid");
      guest.password = body.password;
      return ok(guest);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/guestnetwork/password",
    handle: ({ params, network }) => {
      const guest = guestOf(network(params.net ?? ""));
      if (!guest) return fail(404, "error.guestnetwork.not.found");
      guest.password = "";
      return ok(guest);
    },
  },
  {
    method: "GET",
    path: "/networks/:net/wpa3_per_band",
    handle: ({ params, network }) => ok(network(params.net ?? "").wpa3PerBand),
  },
];
