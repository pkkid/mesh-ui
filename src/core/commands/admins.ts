/**
 * Admin commands (read side): `admin.list`. Seats, ordering and who "you"
 * are are decided here, so every backend answers the same way. See
 * docs/architecture/commands.md#admins-commandsadminsts.
 */

import { z } from "zod";
import type * as M from "../model";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";

/** eero allows ten people (owner included) per network. */
export const ADMIN_SEATS = 10 as const;

/**
 * Marks the signed-in person. eero's members carry no account id, so the
 * match is the account name, narrowed by this network's role when two
 * members share it. When that is not decisive the backend's flags stay.
 */
export function markYou(admins: M.Admin[], name: string | null, role: M.Role | null): M.Admin[] {
  const key = name?.trim().toLowerCase();
  if (!key) return admins;
  let matches = admins.filter((a) => a.name?.trim().toLowerCase() === key);
  if (matches.length > 1 && role) matches = matches.filter((a) => a.role === role);
  const you = matches.length === 1 ? matches[0] : undefined;
  if (!you) return admins;
  return admins.map((a) => ({ ...a, isYou: a === you }));
}

/** Owner first, then admins by name. */
export function sortAdmins(admins: M.Admin[]): M.Admin[] {
  return [...admins].sort((a, b) => (a.role === b.role ? (a.name ?? "").localeCompare(b.name ?? "") : a.role === "owner" ? -1 : 1));
}

async function whoAmI(ctx: CommandContext): Promise<{ name: string | null; role: M.Role | null }> {
  const [account, perms] = await Promise.all([ctx.backend.account.get().catch(() => null), ctx.backend.network.permissions(ctx.net).catch(() => null)]);
  return { name: account?.name ?? null, role: perms?.role ?? null };
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "admin.list",
    label: "User permissions",
    description:
      "The people who can manage the network (owner and admins) and pending invites, with seats used of 10. An admin cannot read invites; for them the invites list is empty.",
    icon: "users",
    params: z.object({}),
    effect: "query",
    topic: "admins",
    async run(ctx): Promise<M.AdminList> {
      const [list, me] = await Promise.all([ctx.backend.admins.list(ctx.net), whoAmI(ctx)]);
      const admins = sortAdmins(markYou(list.admins, me.name, me.role));
      const invites = [...list.invites].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      return { admins, invites, seatsUsed: admins.length, seatsMax: ADMIN_SEATS };
    },
  }),
];
