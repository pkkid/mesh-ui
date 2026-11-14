/**
 * Fake admin routes. Reads: `GET {net}/members` answers `{members: [...]}`
 * and `GET {net}/invites` a bare array, or 403 on a network where the fake
 * account is an admin (Lake Cabin), as eero does. Writes, owner only (403
 * otherwise), shaped as the clients send them: `POST {net}/invites` JSON
 * `{invite_role: "admin"}` answers only `{invite_url}`; `PUT
 * {net}/invites/{id}` JSON `{invite_nickname}`; `DELETE {net}/invites/{id}`;
 * `DELETE {net}/admins/{user_id}` (never the owner); `POST {net}/transfer`
 * form `{name, email}` or `{name, phone}`. Shapes:
 * docs/eero-api/endpoints.md sections 3 and 17.
 */

import { fail, FakeAnswer, ok, type Route, type RouteContext } from "../server";
import type { FakeNetwork } from "../state";

/** Invites are single use and expire after 48 hours. */
const INVITE_MS = 48 * 3_600_000;

/** The network, when the caller owns it; else a 403 answer. */
function owned({ params, network }: RouteContext): FakeNetwork {
  const net = network(params.net ?? "");
  if (net.permissions.role !== "owner" || net.invites === null) throw new FakeAnswer(fail(403, "error.network.forbidden"));
  return net;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

let nextInvite = 1;

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/members",
    handle: ({ params, network }) => ok({ members: network(params.net ?? "").members }),
  },
  {
    method: "GET",
    path: "/networks/:net/invites",
    handle: ({ params, network }) => {
      const invites = network(params.net ?? "").invites;
      return invites ? ok(invites) : fail(403, "error.network.forbidden");
    },
  },
  {
    method: "POST",
    path: "/networks/:net/invites",
    handle: (ctx) => {
      const net = owned(ctx);
      if (ctx.req.body.invite_role !== "admin") return fail(400, "error.invite.role.invalid");
      const id = `fake-inv-new-${nextInvite++}`;
      const at = ctx.state.now();
      net.invites?.unshift({ invite_id: id, invite_nickname: null, created: new Date(at).toISOString(), expires: new Date(at + INVITE_MS).toISOString() });
      return ok({ invite_url: `https://invite.example.com/fake/${id}` });
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/invites/:invite",
    handle: (ctx) => {
      const row = owned(ctx).invites?.find((i) => String(i.invite_id) === ctx.params.invite);
      if (!row) return fail(404, "error.invite.not.found");
      const nickname = text(ctx.req.body.invite_nickname);
      if (!nickname || nickname.length > 32) return fail(400, "error.invite.nickname.invalid");
      row.invite_nickname = nickname;
      return ok(row);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/invites/:invite",
    handle: (ctx) => {
      const net = owned(ctx);
      const before = net.invites?.length ?? 0;
      net.invites = (net.invites ?? []).filter((i) => String(i.invite_id) !== ctx.params.invite);
      return net.invites.length === before ? fail(404, "error.invite.not.found") : ok(null);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/admins/:user",
    handle: (ctx) => {
      const net = owned(ctx);
      const member = net.members.find((m) => String(m.user_id) === ctx.params.user);
      if (!member) return fail(404, "error.member.not.found");
      if (member.user_role === "owner") return fail(400, "error.member.owner");
      net.members = net.members.filter((m) => m !== member);
      return ok(null);
    },
  },
  {
    method: "POST",
    path: "/networks/:net/transfer",
    handle: (ctx) => {
      const net = owned(ctx);
      const { body } = ctx.req;
      const name = text(body.name);
      const email = text(body.email);
      const phone = text(body.phone);
      if (!name || (email === null) === (phone === null)) return fail(400, "error.transfer.recipient.invalid");
      net.transfer = { recipient_name: name, recipient_email_address: email, recipient_phone_number: phone, transfer_date: new Date(ctx.state.now()).toISOString() };
      return ok(net.transfer);
    },
  },
];
