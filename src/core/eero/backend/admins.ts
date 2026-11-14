/**
 * eero backend, admins area: `GET {net}/members` (`{members: [...]}`) and
 * `GET {net}/invites` (a bare array). eero answers 403 on invites for an
 * admin; that is an empty list, not an error.
 */

import { BackendError } from "../../errors";
import { mapInvites, mapMembers } from "../map/admins";
import { asList, type RawInvite, type RawMember } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";
import { networkLinks } from "./network";

export const admins: EeroArea<"admins"> = (ctx) => {
  const links = networkLinks(ctx);
  const path = (id: string, sub: "members" | "invites") => links.get(`net:${id}.${sub}`, `${links.get(`net:${id}`, networkPath(id))}/${sub}`);

  return {
    async list(id) {
      const [members, invites] = await Promise.all([
        ctx.client.request<unknown>({ method: "GET", path: path(id, "members") }),
        ctx.client.request<unknown>({ method: "GET", path: path(id, "invites") }).catch((err: unknown) => {
          if (err instanceof BackendError && err.detail?.status === 403) return [];
          throw err;
        }),
      ]);
      return { admins: mapMembers(asList<RawMember>(members, "members")), invites: mapInvites(asList<RawInvite>(invites, "invites")) };
    },
  };
};
