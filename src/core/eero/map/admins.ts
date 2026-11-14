/**
 * Maps `GET {net}/members` and `GET {net}/invites` to the model. Pure: no
 * requests. `isYou` is decided in core (commands/admins.ts) from the
 * account, so it is false here. Shapes: docs/eero-api/endpoints.md section 17.
 */

import type * as M from "../../model";
import type { RawInvite, RawMember } from "../raw";
import { mapRole, toIso } from "./network";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Members without a user id are dropped; any role that is not owner is an admin. eero sends no email. */
export function mapMembers(raw: RawMember[]): M.Admin[] {
  return raw.flatMap((m) => {
    if (typeof m.user_id !== "number" && typeof m.user_id !== "string") return [];
    return [{ id: String(m.user_id), name: text(m.user_name), role: mapRole(m.user_role) ?? "admin", isYou: false }];
  });
}

/** Invites without an id are dropped. */
export function mapInvites(raw: RawInvite[]): M.Invite[] {
  return raw.flatMap((i) => {
    if (i.invite_id === undefined || i.invite_id === null || i.invite_id === "") return [];
    return [{ id: String(i.invite_id), nickname: text(i.invite_nickname), createdAt: toIso(i.created ?? null), expiresAt: toIso(i.expires ?? null) }];
  });
}
