/**
 * eero backend, admins area: `GET {net}/members` (`{members: [...]}`) and
 * `GET {net}/invites` (a bare array). eero answers 403 on invites for an
 * admin; that is an empty list, not an error. Writes, per the clients
 * (docs/eero-api/endpoints.md section 3): `POST {net}/invites` JSON
 * `{invite_role: "admin"}` answers only `{invite_url}`, so the new invite's
 * id comes from reading the invites again, then `PUT {net}/invites/{id}`
 * `{invite_nickname}` names it; `DELETE {net}/invites/{id}`;
 * `DELETE {net}/admins/{user_id}`; `POST {net}/transfer` form
 * `{name, email}` or `{name, phone}`.
 */

import type * as M from "../../model";
import { BackendError } from "../../errors";
import { mapInvites, mapMembers } from "../map/admins";
import { asList, type RawInvite, type RawMember } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";
import { networkLinks } from "./network";

/** `POST {net}/invites` answers `{invite_url}` (the clients read nothing else); an id is taken if eero ever sends one. */
type RawInviteCreated = { invite_url?: string; invite_id?: string | number | null };

export const admins: EeroArea<"admins"> = (ctx) => {
  const links = networkLinks(ctx);
  const path = (id: string, sub: "members" | "invites") => links.get(`net:${id}.${sub}`, `${links.get(`net:${id}`, networkPath(id))}/${sub}`);

  const net = (id: string) => links.get(`net:${id}`, networkPath(id));
  const readInvites = async (id: string) => mapInvites(asList<RawInvite>(await ctx.client.request<unknown>({ method: "GET", path: path(id, "invites"), share: false }), "invites"));

  return {
    async createInvite(id, input) {
      const before = new Set((await readInvites(id)).map((i) => i.id));
      const created = await ctx.client.request<RawInviteCreated | null>({ method: "POST", path: path(id, "invites"), body: { invite_role: "admin" }, encoding: "json" });
      const inviteUrl = typeof created?.invite_url === "string" ? created.invite_url : null;
      if (!inviteUrl) throw new BackendError("eero_error", "eero did not return an invite link.");
      const after = await readInvites(id);
      const fresh = created?.invite_id != null ? after.find((i) => i.id === String(created.invite_id)) : after.filter((i) => !before.has(i.id)).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
      // Without a row to name, the link itself is the invite's only handle.
      let invite: M.Invite = fresh ?? { id: inviteUrl, nickname: null, createdAt: null, expiresAt: null };
      if (input.nickname && fresh) {
        await ctx.client.request<unknown>({ method: "PUT", path: `${path(id, "invites")}/${encodeURIComponent(fresh.id)}`, body: { invite_nickname: input.nickname }, encoding: "json" });
        invite = { ...fresh, nickname: input.nickname };
      }
      return { invite, inviteUrl, expiresAt: invite.expiresAt };
    },
    async cancelInvite(id, invite) {
      await ctx.client.request<unknown>({ method: "DELETE", path: `${path(id, "invites")}/${encodeURIComponent(invite)}`, encoding: "none" });
    },
    async remove(id, admin) {
      await ctx.client.request<unknown>({ method: "DELETE", path: `${net(id)}/admins/${encodeURIComponent(admin)}`, encoding: "none" });
    },
    async transfer(id, input) {
      const body: Record<string, unknown> = { name: input.name, email: input.email, phone: input.phone };
      await ctx.client.request<unknown>({ method: "POST", path: links.get(`net:${id}.transfer`, `${net(id)}/transfer`), body, encoding: "form" });
    },
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
