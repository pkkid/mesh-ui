/**
 * eero auth area: sign-in with a one-time code, resend, sign-out and the
 * session state. The client holds the pending and session tokens; this area
 * only forwards, so no token ever reaches a command.
 * See docs/eero-api/endpoints.md#1-auth-and-session.
 */

import type { EeroArea } from "./index";

export const auth: EeroArea<"auth"> = ({ client }) => ({
  status: () => client.status(),
  start: (login) => client.startLogin(login),
  verify: (code) => client.verifyLogin(code),
  resend: () => client.resendLogin(),
  logout: () => client.logout(),
});
