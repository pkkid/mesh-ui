/**
 * account: the signed-in eero account. Writes to it (name, email, phone,
 * preferences, delete) come in a later milestone.
 * See docs/architecture/commands.md#account.
 */

import { z } from "zod";
import type { Account } from "../model";
import { type AnyCommand, defineCommand } from "../spec";

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
    run: (ctx): Promise<Account> => ctx.backend.account.get(),
  }),
];
