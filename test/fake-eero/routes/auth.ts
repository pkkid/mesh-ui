/**
 * Fake auth routes: login, verify, resend, refresh, logout. Any email or
 * phone is accepted and the code is always 123456 (FAKE_CODE). See
 * docs/eero-api/endpoints.md#1-auth-and-session.
 */

import { fail, ok, type Route } from "../server";
import { FAKE_CODE } from "../state";

const RESEND_COOLDOWN_MS = 60_000;

export const routes: Route[] = [
  {
    method: "POST",
    path: "/login",
    auth: "none",
    handle: ({ req, state }) => {
      const login = typeof req.body.login === "string" ? req.body.login.trim() : "";
      if (!login) return fail(400, "error.login.invalid");
      const token = state.nextToken("pending");
      state.sessions.set(token, { token, kind: "pending", login, resentAt: null });
      return ok({ user_token: token });
    },
  },
  {
    method: "POST",
    path: "/login/verify",
    auth: "pending",
    handle: ({ req, session, state }) => {
      if (!session) return fail(401, "error.session.invalid");
      if (String(req.body.code ?? "") !== FAKE_CODE) return fail(401, "error.code.invalid");
      session.kind = "session";
      return ok({ name: state.account.name, log_id: state.account.log_id });
    },
  },
  {
    method: "POST",
    path: "/login/resend",
    auth: "pending",
    handle: ({ session, state }) => {
      if (!session) return fail(401, "error.session.invalid");
      const now = state.now();
      if (session.resentAt !== null && now - session.resentAt < RESEND_COOLDOWN_MS) return fail(429, "error.too.many.resends");
      session.resentAt = now;
      return ok(null);
    },
  },
  {
    method: "POST",
    path: "/login/refresh",
    handle: ({ session, state }) => {
      if (!session) return fail(401, "error.session.invalid");
      const token = state.nextToken("session");
      state.sessions.set(token, { ...session, token });
      return ok({ user_token: token });
    },
  },
  {
    method: "POST",
    path: "/logout",
    handle: ({ req, state }) => {
      if (req.token) state.sessions.delete(req.token);
      return ok(null);
    },
  },
];
