/**
 * Admin commands: `admin.list`, invites (`admin.invite.create`,
 * `admin.invite.cancel`), `admin.remove` and `network.transfer` (both
 * destructive, owner only). Seats, ordering, who "you" are and the checks
 * before a write are decided here, so every backend answers the same way.
 * There is no `admin.nickname.set`: eero has no endpoint that renames a
 * member (only invite nicknames). See
 * docs/architecture/commands.md#admins-commandsadminsts.
 */

import { z } from "zod";
import type { InviteCreated } from "../backend";
import { CommandError } from "../errors";
import type * as M from "../model";
import { type AnyCommand, type CommandContext, defineCommand, ref } from "../spec";

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

/** Invite nicknames: 1 to 32 characters, trimmed (eero's name rule in the clients). */
const nicknameSchema = z.string().trim().min(1).max(32);

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

  defineCommand({
    id: "admin.invite.create",
    label: "Invite an admin",
    description:
      "Creates a single-use admin invite and returns its link (`inviteUrl`) for a QR code or to send. The invitee accepts it in the eero app within about 48 hours. Owner only; fails when all 10 seats are in use. eero sends no email: share the link yourself.",
    icon: "user-plus",
    params: z.object({ nickname: nicknameSchema.optional().describe("Who the invite is for, shown on the pending row (1 to 32 characters).") }),
    effect: "write",
    gate: { area: "network.admin_invites", op: "create" },
    // The link makes whoever opens it an admin: never cached, masked by the CLI, kept out of the audit log.
    sensitive: true,
    invalidates: ["admins"],
    async run(ctx, { nickname }): Promise<InviteCreated> {
      const list = await ctx.backend.admins.list(ctx.net);
      // Pending invites hold a seat once accepted, so count them too.
      if (list.admins.length + list.invites.length >= ADMIN_SEATS) throw new CommandError("bad_params", "All admin seats are in use.");
      return ctx.backend.admins.createInvite(ctx.net, { nickname: nickname ?? null, email: null });
    },
  }),

  defineCommand({
    id: "admin.invite.cancel",
    label: "Cancel invite",
    description: "Cancels a pending admin invite so its link no longer works. The invite is an id or its nickname. Owner only.",
    icon: "user-x",
    params: z.object({ invite: ref("invite") }),
    effect: "write",
    gate: { area: "network.admin_invites", op: "delete" },
    invalidates: ["admins"],
    async run(ctx, p): Promise<{ inviteId: M.Id }> {
      const { invites } = await ctx.backend.admins.list(ctx.net);
      const id = ctx.match(p.invite, invites.map((i) => ({ id: i.id, names: [i.nickname] })), "invite");
      await ctx.backend.admins.cancelInvite(ctx.net, id);
      return { inviteId: id };
    },
  }),

  defineCommand({
    id: "admin.remove",
    label: "Remove admin",
    description: "Removes an admin's access to the network at once. They need a new invite to come back. The owner cannot be removed. Owner only; cannot be undone.",
    icon: "user-minus",
    params: z.object({ admin: ref("admin") }),
    effect: "destructive",
    gate: { area: "network.standard_admins", op: "delete" },
    invalidates: ["admins"],
    async confirmMessage(ctx, p) {
      const a = await adminFor(ctx, p.admin);
      return `${a.name ?? "This admin"} loses access to the network at once and needs a new invite to come back.`;
    },
    async run(ctx, p): Promise<{ adminId: M.Id }> {
      const a = await adminFor(ctx, p.admin);
      await ctx.backend.admins.remove(ctx.net, a.id);
      return { adminId: a.id };
    },
  }),

  defineCommand({
    id: "network.transfer",
    label: "Transfer network",
    description:
      "Hands the network to someone else: eero sends them the transfer by email or text (give exactly one), and they become the owner when they accept. Admins and settings move with it; subscriptions do not. You stay on as an admin. `networkName` must equal the network's name (or its nickname), the type-to-confirm step. Owner only; cannot be undone.",
    icon: "arrow-right-left",
    params: z.object({
        name: z.string().trim().min(1).max(64).describe("The recipient's name."),
        email: z.email().optional().describe("Where eero sends the transfer. Give this or phone."),
        phone: z
          .string()
          .trim()
          .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a phone number, like +1 555 010 0199.")
          .optional()
          .describe("Where eero texts the transfer. Give this or email."),
        networkName: z.string().describe("The network's name, typed to confirm."),
      }),
    effect: "destructive",
    gate: { area: "network.ownership_transfer", op: "create", capability: "ownership_transfer" },
    invalidates: ["admins", "permissions", "network"],
    async confirmMessage(ctx, p) {
      checkRecipient(p);
      const name = await checkNetworkName(ctx, p.networkName);
      return `${p.name} becomes the owner of ${name} once they accept. You stay on as an admin. This cannot be undone.`;
    },
    async run(ctx, p): Promise<{ recipient: string; sentTo: string }> {
      checkRecipient(p);
      await checkNetworkName(ctx, p.networkName);
      await ctx.backend.admins.transfer(ctx.net, { name: p.name, email: p.email ?? null, phone: p.phone ?? null });
      return { recipient: p.name, sentTo: (p.email ?? p.phone)! };
    },
  }),
];

/** The admin a ref names (id or name), never the owner. */
async function adminFor(ctx: CommandContext, admin: string): Promise<M.Admin> {
  const { admins } = await ctx.backend.admins.list(ctx.net);
  const id = ctx.match(admin, admins.map((a) => ({ id: a.id, names: [a.name] })), "admin");
  const a = admins.find((x) => x.id === id)!;
  if (a.role === "owner") throw new CommandError("bad_params", "The owner cannot be removed. Transfer the network instead.");
  return a;
}

/**
 * The type-to-confirm step: the typed name must equal the network's name as
 * the app shows it (the nickname when set) or eero's name, exactly, ends
 * trimmed. Returns the shown name.
 */
async function checkNetworkName(ctx: CommandContext, typed: string): Promise<string> {
  const n = await ctx.backend.network.get(ctx.net);
  const shown = n.nickname ?? n.name;
  const names = [n.name, n.nickname].filter((x): x is string => !!x).map((x) => x.trim());
  if (!names.includes(typed.trim())) throw new CommandError("bad_params", `Type the network name "${shown}" exactly to confirm.`);
  return shown;
}

/** eero sends the transfer to exactly one of an email or a phone number. */
function checkRecipient(p: { email?: string; phone?: string }): void {
  if ((p.email === undefined) === (p.phone === undefined)) throw new CommandError("bad_params", "Give an email or a phone number, not both.", { issues: [{ path: "email", message: "Give an email or a phone number, not both." }] });
}
