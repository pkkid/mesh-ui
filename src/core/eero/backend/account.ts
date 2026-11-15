/**
 * eero account area: `GET /2.2/account` mapped to the `Account` model, and
 * the account writes. See docs/architecture/data-model.md (Account) and
 * docs/eero-api/endpoints.md (sections 2 and 20).
 *
 * No live-tested client sends any account write (endpoints.md section 20:
 * FF sends them but marks them unverified, Eeronaut has none), so the writes
 * are built only for the local fake eero server (`dev:fake`, tests). Against
 * the real eero API the area has `get` only and the writes answer "not
 * available yet" (partialArea). Wire them for live only once a live-tested
 * source or a capture proves each request.
 */

import type { AccountBackend } from "../../backend";
import type { Account } from "../../model";
import type { RawAccount } from "../raw";
import type { EeroArea } from "./index";

const AUTH_TYPES = new Set(["email", "phone", "amazon"]);
const ACCOUNT = "/2.2/account";

export function mapAccount(raw: RawAccount): Account {
  const contact = (c: { value?: string; verified?: boolean } | undefined) =>
    c?.value ? { value: c.value, verified: c.verified === true } : null;
  const type = raw.auth?.type;
  const push = raw.push_settings;
  const marketing = raw.consents?.marketing_emails;
  return {
    id: raw.log_id ?? "",
    name: raw.name?.trim() || null,
    email: contact(raw.email),
    phone: contact(raw.phone),
    authType: type && AUTH_TYPES.has(type) ? (type as Account["authType"]) : null,
    marketingEmails: typeof marketing === "boolean" ? marketing : null,
    push: push ? { networkOffline: push.networkOffline === true, nodeOffline: push.nodeOffline === true } : null,
    canTransfer: raw.can_transfer === true,
    networkCount: raw.networks?.count ?? raw.networks?.data?.length ?? 0,
  };
}

export const account: EeroArea<"account"> = ({ client, options }) => {
  const get = async () => mapAccount(await client.request<RawAccount>({ method: "GET", path: ACCOUNT }));
  // Live eero: reads only (see the header). An injected origin is always the loopback fake server.
  if (options.origin === undefined) return { get };

  const form = async (method: "PUT" | "POST", path: string, body: Record<string, unknown>) => {
    await client.request({ method, path: `${ACCOUNT}${path}`, body, encoding: "form" });
  };
  const writes: Omit<AccountBackend, "get"> = {
    setName: (name) => form("PUT", "/name", { name }),
    setEmail: (email) => form("PUT", "/email", { email }),
    verifyEmail: (code) => form("POST", "/email/verify", { code }),
    setPhone: (phone) => form("PUT", "/phone", { phone }),
    verifyPhone: (code) => form("POST", "/phone/verify", { code }),
    setConsents: (marketingEmails) => form("PUT", "/consents", { marketing_emails: marketingEmails }),
    // eero wants both keys on every write; core merges the one not given from the account.
    setPush: async (push) => {
      await client.request({ method: "PUT", path: `${ACCOUNT}/push_settings`, body: { networkOffline: push.networkOffline, nodeOffline: push.nodeOffline }, encoding: "json" });
    },
    remove: async () => {
      await client.request({ method: "DELETE", path: ACCOUNT });
    },
  };
  return { get, ...writes };
};
