/**
 * auth: the session. Sign in with a one-time code sent to an email or phone,
 * resend it, sign out, and report the state. The token stays inside the
 * backend; these commands only ever return `AuthStatus`.
 * See docs/architecture/commands.md#auth and docs/ux/sign-in.md.
 */

import { z } from "zod";
import type { Backend } from "../backend";
import { CommandError } from "../errors";
import type { AuthStatus } from "../model";
import { TTL, type Topic } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";

/** eero sends a new code about once a minute; the engine refuses sooner. */
export const RESEND_INTERVAL_MS = 60_000;

/** Every cache topic: signing in or out changes whose data it all is. */
export const ALL_TOPICS = Object.keys(TTL) as Topic[];

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * An email (trimmed) or a phone number in E.164 (`+15550100142`). Spaces,
 * dashes, dots and brackets are dropped from phone numbers and a leading
 * `00` becomes `+`. A number without a country code is refused, since
 * guessing one could send the code to someone else.
 */
export function normaliseLogin(input: string): string {
  const value = input.trim();
  if (value.includes("@")) {
    if (!EMAIL.test(value)) throw new CommandError("bad_params", "Enter a full email address, like name@example.com.");
    return value;
  }
  const phone = value.replace(/[\s().-]/g, "").replace(/^00/, "+");
  if (E164.test(phone)) return phone;
  if (/^\d{7,15}$/.test(phone)) throw new CommandError("bad_params", "Include the country code, like +1 555 010 0142.");
  throw new CommandError("bad_params", "Enter an email address or a phone number with its country code.");
}

/** When each backend last sent a code (start or resend), for the resend limit. */
const lastSent = new WeakMap<Backend, number>();

async function status(ctx: CommandContext): Promise<AuthStatus> {
  return { ...(await ctx.backend.auth.status()), backend: ctx.backend.kind };
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "auth.status",
    label: "Session status",
    description: "Whether Mesh UI is signed in to eero, where the session is kept, and which backend is active. Never returns the token.",
    icon: "key-round",
    params: z.object({}),
    effect: "query",
    scope: "account",
    run: (ctx) => status(ctx),
  }),

  defineCommand({
    id: "auth.login.start",
    label: "Send sign-in code",
    description: "Sends a one-time sign-in code to the email or phone number of an eero account.",
    icon: "mail",
    params: z.object({
      login: z.string().trim().min(1).max(254).describe("Email address, or phone number in E.164 form (+15550100142)."),
    }),
    effect: "write",
    scope: "account",
    run: async (ctx, { login }) => {
      await ctx.backend.auth.start(normaliseLogin(login));
      lastSent.set(ctx.backend, ctx.now());
      return status(ctx);
    },
  }),

  defineCommand({
    id: "auth.login.verify",
    label: "Verify code",
    description: "Checks the one-time code and signs in. A wrong code keeps the sign-in pending so it can be retried or resent.",
    icon: "shield-check",
    params: z.object({
      code: z
        .string()
        .trim()
        .regex(/^\d{4,10}$/, "The code is 4 to 10 digits.")
        .describe("The code eero sent."),
    }),
    effect: "write",
    scope: "account",
    run: async (ctx, { code }) => {
      if (!(await ctx.backend.auth.status()).pending) {
        throw new CommandError("bad_params", "No code was sent yet. Run auth.login.start first.");
      }
      await ctx.backend.auth.verify(code);
      lastSent.delete(ctx.backend);
      ctx.invalidate(ALL_TOPICS);
      const result = await status(ctx);
      ctx.emit({ type: "session.changed", state: "signed_in", storage: result.storage });
      return result;
    },
  }),

  defineCommand({
    id: "auth.login.resend",
    label: "Resend code",
    description: "Sends the sign-in code again. eero allows this about once a minute.",
    icon: "rotate-cw",
    params: z.object({}),
    effect: "write",
    scope: "account",
    run: async (ctx) => {
      if (!(await ctx.backend.auth.status()).pending) {
        throw new CommandError("bad_params", "No code was sent yet. Run auth.login.start first.");
      }
      const since = ctx.now() - (lastSent.get(ctx.backend) ?? Number.NEGATIVE_INFINITY);
      if (since < RESEND_INTERVAL_MS) {
        const retryAfterSec = Math.ceil((RESEND_INTERVAL_MS - since) / 1000);
        throw new CommandError("rate_limited", `A new code can be sent in ${retryAfterSec} s.`, { retryAfterSec });
      }
      await ctx.backend.auth.resend();
      lastSent.set(ctx.backend, ctx.now());
      return status(ctx);
    },
  }),

  defineCommand({
    id: "auth.logout",
    label: "Sign out",
    description: "Signs out of eero on this computer, for the app and the CLI. The saved session is deleted even when eero cannot be reached.",
    icon: "log-out",
    params: z.object({}),
    effect: "write",
    scope: "account",
    run: async (ctx) => {
      await ctx.backend.auth.logout();
      lastSent.delete(ctx.backend);
      ctx.invalidate(ALL_TOPICS);
      const result = await status(ctx);
      ctx.emit({ type: "session.changed", state: "signed_out", storage: result.storage });
      return result;
    },
  }),
];
