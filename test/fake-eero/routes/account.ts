/**
 * Fake account routes: `GET /2.2/account` answers the seeded account
 * (state.account), with its network list, and the account writes from
 * docs/eero-api/endpoints.md section 2 (sources: FF and LD, unverified on a
 * real account, section 20):
 *
 * - `PUT /account/name` form `name`.
 * - `PUT /account/email` and `PUT /account/phone` (form `email`, `phone` in
 *   E.164): the new value stays unverified until `POST .../verify` with form
 *   `code` FAKE_CODE. A wrong code answers 401 `error.code.invalid` (as the
 *   sign-in verify does) and keeps the change pending; nothing pending is a 400.
 * - `PUT /account/consents` form `marketing_emails` (`true` or `false`).
 * - `PUT /account/push_settings` JSON with both `networkOffline` and
 *   `nodeOffline` as bools; a missing key is a 400.
 * - `DELETE /account`: refused (400) while the account has networks; else the
 *   account is cleared and every session ends.
 */

import { fail, ok, type Route, type RouteContext } from "../server";
import { FAKE_CODE } from "../state";

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function verify(kind: "email" | "phone") {
  return ({ req, state }: RouteContext) => {
    const contact = state.account[kind];
    if (!contact?.value || contact.verified) return fail(400, `error.account.${kind}.not_pending`);
    if (text(req.body.code) !== FAKE_CODE) return fail(401, "error.code.invalid");
    contact.verified = true;
    return ok(null);
  };
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/account",
    handle: ({ state }) => ok(state.account),
  },
  {
    method: "PUT",
    path: "/account/name",
    handle: ({ req, state }) => {
      const name = text(req.body.name);
      if (req.encoding !== "form" || !name || name.length > 64) return fail(400, "error.params.invalid");
      state.account.name = name;
      return ok(state.account);
    },
  },
  {
    method: "PUT",
    path: "/account/email",
    handle: ({ req, state }) => {
      const email = text(req.body.email);
      if (req.encoding !== "form" || !EMAIL.test(email)) return fail(400, "error.params.invalid");
      state.account.email = { value: email, verified: false };
      return ok(null);
    },
  },
  { method: "POST", path: "/account/email/verify", handle: verify("email") },
  {
    method: "PUT",
    path: "/account/phone",
    handle: ({ req, state }) => {
      const phone = text(req.body.phone);
      if (req.encoding !== "form" || !E164.test(phone)) return fail(400, "error.params.invalid");
      state.account.phone = { value: phone, verified: false };
      return ok(null);
    },
  },
  { method: "POST", path: "/account/phone/verify", handle: verify("phone") },
  {
    method: "PUT",
    path: "/account/consents",
    handle: ({ req, state }) => {
      const v = req.body.marketing_emails;
      if (req.encoding !== "form" || (v !== "true" && v !== "false")) return fail(400, "error.params.invalid");
      state.account.consents = { ...state.account.consents, marketing_emails: v === "true" };
      return ok(null);
    },
  },
  {
    method: "PUT",
    path: "/account/push_settings",
    handle: ({ req, state }) => {
      const { networkOffline, nodeOffline } = req.body;
      if (req.encoding !== "json" || typeof networkOffline !== "boolean" || typeof nodeOffline !== "boolean") return fail(400, "error.params.invalid");
      state.account.push_settings = { networkOffline, nodeOffline };
      return ok(null);
    },
  },
  {
    method: "DELETE",
    path: "/account",
    handle: ({ state }) => {
      if (state.networks.size > 0) return fail(400, "error.account.networks.owned");
      state.account = {};
      state.sessions.clear();
      return ok(null);
    },
  },
];
