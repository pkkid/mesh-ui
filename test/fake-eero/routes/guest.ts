/**
 * Fake guest network reads: `GET {net}/guestnetwork` (the network's embedded
 * `guest_network`, password in the clear as eero sends it) and
 * `GET {net}/wpa3_per_band`, which the guest network's security mirrors.
 * Guests are the devices with `is_guest`; eero has no guest device list.
 * Shapes: docs/eero-api/endpoints.md section 17.
 */

import { fail, ok, type Route } from "../server";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/guestnetwork",
    handle: ({ params, network }) => {
      const guest = network(params.net ?? "").network.guest_network;
      return guest ? ok(guest) : fail(404, "error.guestnetwork.not.found");
    },
  },
  {
    method: "GET",
    path: "/networks/:net/wpa3_per_band",
    handle: ({ params, network }) => ok(network(params.net ?? "").wpa3PerBand),
  },
];
