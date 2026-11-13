/**
 * eero account area: `GET /2.2/account` mapped to the `Account` model.
 * See docs/architecture/data-model.md (Account).
 */

import type { Account } from "../../model";
import type { RawAccount } from "../raw";
import type { EeroArea } from "./index";

const AUTH_TYPES = new Set(["email", "phone", "amazon"]);

export function mapAccount(raw: RawAccount): Account {
  const contact = (c: { value?: string; verified?: boolean } | undefined) =>
    c?.value ? { value: c.value, verified: c.verified === true } : null;
  const type = raw.auth?.type;
  const push = raw.push_settings;
  return {
    id: raw.log_id ?? "",
    name: raw.name?.trim() || null,
    email: contact(raw.email),
    phone: contact(raw.phone),
    authType: type && AUTH_TYPES.has(type) ? (type as Account["authType"]) : null,
    marketingEmails: null,
    push: push ? { networkOffline: push.networkOffline === true, nodeOffline: push.nodeOffline === true } : null,
    canTransfer: raw.can_transfer === true,
    networkCount: raw.networks?.count ?? raw.networks?.data?.length ?? 0,
  };
}

export const account: EeroArea<"account"> = ({ client }) => ({
  get: async () => mapAccount(await client.request<RawAccount>({ method: "GET", path: "/2.2/account" })),
});
