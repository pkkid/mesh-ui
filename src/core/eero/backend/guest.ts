/**
 * eero backend, guest area: `GET {net}/guestnetwork` (the password comes in
 * the clear; only `credentials` maps it), guests from `GET {net}/devices`
 * (`is_guest`), security from `GET {net}/wpa3_per_band` and 6 GHz from the
 * eeros' bands. Writes (form bodies, as the live-verified clients send them):
 * `PUT {net}/guestnetwork` `enabled` and `name`; the password has its own
 * path, `PUT {net}/guestnetwork/password` `password`, and `DELETE` there
 * makes the network open. Each write answers with a fresh `get`. See
 * docs/architecture/commands.md (guest) and docs/eero-api/endpoints.md
 * section 11.
 */

import { BackendError } from "../../errors";
import { bandOf, type RawEeroFull } from "../map/eero";
import { guestCredentials, guestSecurity, mapGuestNetwork } from "../map/guest";
import { asList, type RawDevice, type RawGuestNetwork, type RawGuestWrite, type RawPasswordWrite, type RawWpa3PerBand } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";
import { networkLinks } from "./network";

export const guest: EeroArea<"guest"> = (ctx) => {
  const links = networkLinks(ctx);
  const base = (id: string) => links.get(`net:${id}`, networkPath(id));
  const read = <T>(path: string, share = true) => ctx.client.request<T>({ method: "GET", path, share });
  // share false: a credential read never takes a finished shared GET, so a reveal never shows an old password.
  const guestNetwork = (id: string, share = true) =>
    read<RawGuestNetwork | null>(links.get(`net:${id}.guestnetwork`, `${base(id)}/guestnetwork`), share);

  /** Older firmware has no per-band setting (404 or 405): security unknown, not an error. */
  const perBand = async (id: string): Promise<RawWpa3PerBand | null> => {
    try {
      return await read<RawWpa3PerBand | null>(`${base(id)}/wpa3_per_band`);
    } catch (err) {
      if (err instanceof BackendError && err.code === "eero_error" && (err.detail?.status === 404 || err.detail?.status === 405)) return null;
      throw err;
    }
  };

  const guestPath = (id: string) => links.get(`net:${id}.guestnetwork`, `${base(id)}/guestnetwork`);
  const putGuest = (id: string, body: RawGuestWrite) =>
    ctx.client.request<unknown>({ method: "PUT", path: guestPath(id), body, encoding: "form" });

  const area: ReturnType<EeroArea<"guest">> = {
    async get(id) {
      const [raw, devices, bands, eeros] = await Promise.all([
        guestNetwork(id),
        read<unknown>(networkPath(id, "devices")).then((d) => asList<RawDevice>(d, "devices")),
        perBand(id),
        read<unknown>(links.get(`net:${id}.eeros`, `${base(id)}/eeros`)).then((e) => asList<RawEeroFull>(e, "eeros")),
      ]);
      const has6 = eeros.some((e) => (e.bands ?? []).some((b) => bandOf(b) === "6"));
      const open = !(typeof raw?.password === "string" && raw.password.length > 0);
      return mapGuestNetwork(raw, devices, guestSecurity(bands, open, has6));
    },

    async credentials(id) {
      return guestCredentials(await guestNetwork(id, false));
    },

    async setEnabled(id, enabled) {
      await putGuest(id, { enabled });
      return area.get(id);
    },

    async rename(id, name) {
      // The clients always send `enabled` with `name`; repeat the current state so a rename never toggles it.
      const current = await guestNetwork(id, false);
      await putGuest(id, { enabled: current?.enabled === true, name });
      return area.get(id);
    },

    async setPassword(id, password) {
      const path = `${guestPath(id)}/password`;
      if (password === null) await ctx.client.request<unknown>({ method: "DELETE", path, encoding: "none" });
      else await ctx.client.request<unknown>({ method: "PUT", path, body: { password } satisfies RawPasswordWrite, encoding: "form" });
      return area.get(id);
    },
  };
  return area;
};
