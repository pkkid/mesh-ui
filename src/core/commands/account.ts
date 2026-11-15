/**
 * account: the signed-in eero account and its writes (name, email, mobile,
 * email preferences, push alerts, delete). Each write answers with the
 * account read again. Against the real eero API the writes answer "not
 * available yet" until a live-tested source is found; demo and the fake eero
 * server apply them (docs/eero-api/endpoints.md#20). Verification codes are
 * params named `code`, which the audit log redacts and no result echoes.
 * See docs/architecture/commands.md#account.
 */

import { z } from "zod";
import { CommandError } from "../errors";
import type { Account } from "../model";
import { POLL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";
import { ALL_TOPICS } from "./auth";

/** E.164: a plus, a country code and up to 15 digits in all. */
const E164 = /^\+[1-9]\d{6,14}$/;

const code = z.string().trim().regex(/^\d{6}$/, "The code is 6 digits.").describe("The 6 digit code eero sent.");

/** Reads the account again, past the cache, for a write's result. */
const reread = (ctx: CommandContext): Promise<Account> => ctx.backend.account.get();

/**
 * Why the account cannot be deleted yet, or null. eero needs owned networks
 * transferred or deleted first. A network whose role eero did not send
 * (null) may be owned, so it refuses too: the delete cannot be undone.
 */
async function deleteRefusal(ctx: CommandContext): Promise<string | null> {
  const owned = (await ctx.backend.network.list()).filter((n) => n.role !== "admin");
  if (owned.length === 0) return null;
  const names = owned.map((n) => n.nickname ?? n.name).join(", ");
  const unknown = owned.some((n) => n.role === null) ? " or may own" : "";
  return `You own${unknown} ${owned.length === 1 ? "a network" : `${owned.length} networks`} (${names}). Transfer or delete ${owned.length === 1 ? "it" : "them"} before deleting the account.`;
}

/** Shared by every account write. */
const write = { effect: "write" as const, gate: { area: null }, scope: "account" as const, invalidates: ["account" as const] };

export const commands: AnyCommand[] = [
  defineCommand({
    id: "account.get",
    label: "Account",
    description: "The signed-in eero account: name, email, phone, sign-in type, push alert choices and how many networks it has.",
    icon: "circle-user",
    params: z.object({}),
    effect: "query",
    scope: "account",
    topic: "account",
    // Under the poll, so each poll reaches eero; network.list keeps the 10 min account TTL.
    ttl: POLL.account - 30,
    poll: POLL.account,
    run: (ctx): Promise<Account> => ctx.backend.account.get(),
  }),

  defineCommand({
    id: "account.name.set",
    label: "Edit name",
    description: "Changes the name on the eero account.",
    icon: "pencil",
    params: z.object({ name: z.string().trim().min(1).max(64).describe("The new name, 1 to 64 characters.") }),
    ...write,
    run: async (ctx, { name }): Promise<Account> => {
      await ctx.backend.account.setName(name);
      return reread(ctx);
    },
  }),

  defineCommand({
    id: "account.email.set",
    label: "Change email",
    description: "Changes the account email. eero sends a code to the new address; it stays unverified until account.email.verify.",
    icon: "mail",
    params: z.object({ email: z.email("Not an email address.").describe("The new email address.") }),
    ...write,
    run: async (ctx, { email }): Promise<Account> => {
      await ctx.backend.account.setEmail(email);
      return reread(ctx);
    },
  }),

  defineCommand({
    id: "account.email.verify",
    label: "Verify email",
    description: "Verifies the account email with the code eero sent to it.",
    icon: "mail-check",
    params: z.object({ code }),
    ...write,
    run: async (ctx, p): Promise<Account> => {
      await ctx.backend.account.verifyEmail(p.code);
      return reread(ctx);
    },
  }),

  defineCommand({
    id: "account.phone.set",
    label: "Change mobile",
    description: "Changes the account mobile number (E.164, e.g. +15550100142). eero texts a code; it stays unverified until account.phone.verify.",
    icon: "smartphone",
    params: z.object({ phone: z.string().trim().regex(E164, "Use the international form, e.g. +15550100142.").describe("The new number in E.164 form.") }),
    ...write,
    run: async (ctx, { phone }): Promise<Account> => {
      await ctx.backend.account.setPhone(phone);
      return reread(ctx);
    },
  }),

  defineCommand({
    id: "account.phone.verify",
    label: "Verify mobile",
    description: "Verifies the account mobile number with the code eero texted to it.",
    icon: "smartphone",
    params: z.object({ code }),
    ...write,
    run: async (ctx, p): Promise<Account> => {
      await ctx.backend.account.verifyPhone(p.code);
      return reread(ctx);
    },
  }),

  defineCommand({
    id: "account.consents.set",
    label: "Email preferences",
    description: "Turns eero's product news emails on or off.",
    icon: "mail",
    params: z.object({ marketingEmails: z.boolean().describe("true to get product news by email.") }),
    ...write,
    run: async (ctx, { marketingEmails }): Promise<Account> => {
      await ctx.backend.account.setConsents(marketingEmails);
      return reread(ctx);
    },
  }),

  defineCommand({
    id: "account.push.set",
    label: "Phone push alerts",
    description: "Turns the eero app's phone alerts for a network or an eero going offline on or off. Keys left out keep their current value.",
    icon: "bell",
    params: z.object({
      networkOffline: z.boolean().optional().describe("Alert when the network goes offline."),
      nodeOffline: z.boolean().optional().describe("Alert when an eero goes offline."),
    }),
    ...write,
    // The push choices also show in notifications.settings.get.
    invalidates: ["account", "notification_settings"],
    run: async (ctx, p): Promise<Account> => {
      if (p.networkOffline === undefined && p.nodeOffline === undefined) throw new CommandError("bad_params", "Give networkOffline, nodeOffline or both.");
      // eero wants every key, so the ones not given come from the account.
      const current = (await ctx.backend.account.get()).push;
      const networkOffline = p.networkOffline ?? current?.networkOffline;
      const nodeOffline = p.nodeOffline ?? current?.nodeOffline;
      if (networkOffline === undefined || nodeOffline === undefined) throw new CommandError("bad_params", "eero sent no push settings; give both networkOffline and nodeOffline.");
      await ctx.backend.account.setPush({ networkOffline, nodeOffline });
      return reread(ctx);
    },
  }),

  defineCommand({
    id: "account.delete",
    label: "Delete account and data",
    description:
      "Permanently closes the eero account and deletes its data, then signs out. Owned networks must be transferred or deleted first; access to shared networks is lost. Cannot be undone.",
    icon: "trash-2",
    params: z.object({
      acknowledge: z.literal(true, { error: "Set acknowledge to true: I want to permanently close my account and delete my data." }).describe(
        "Must be true: I want to permanently close my account and delete my data.",
      ),
    }),
    effect: "destructive",
    gate: { area: null },
    scope: "account",
    async confirmMessage(ctx) {
      const refused = await deleteRefusal(ctx);
      if (refused) throw new CommandError("bad_params", refused);
      const name = (await ctx.backend.account.get()).name;
      return `Permanently closes the eero account${name ? ` of ${name}` : ""} and deletes its data, then signs out. Shared networks are no longer reachable. This cannot be undone.`;
    },
    run: async (ctx): Promise<{ deleted: true }> => {
      const refused = await deleteRefusal(ctx);
      if (refused) throw new CommandError("bad_params", refused);
      await ctx.backend.account.remove();
      // The session is dead with the account; clear it here too. Best effort.
      await ctx.backend.auth.logout().catch(() => undefined);
      ctx.invalidate(ALL_TOPICS);
      const storage = (await ctx.backend.auth.status()).storage;
      ctx.emit({ type: "session.changed", state: "signed_out", storage });
      return { deleted: true };
    },
  }),
];
