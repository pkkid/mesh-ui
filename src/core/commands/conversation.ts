/**
 * Conversations: eero's assistant chat (the eero app's Support chat), on
 * `/2.2/conversations*`. Not an eero Plus feature. A reply streams: the
 * command runs until eero is done (or asks permission) and returns the
 * whole turn, while the window follows it through `conversation.progress`
 * host events tagged with the caller's `turnId`. The CLI and MCP just get
 * the result. See docs/architecture/commands.md (conversation) and
 * docs/ux/pages/conversations.md.
 *
 * eero's assistant can change the network itself, but it asks first (a
 * permission ask). Approving is `disruptive` and needs `confirm`, since
 * Mesh UI cannot know beforehand what eero will run.
 */

import { z } from "zod";
import type { ConversationRequest } from "../backend";
import { BackendError, CommandError } from "../errors";
import { buildItems, ConversationBuilder, MAX_MESSAGE, STARTER_PROMPTS, TURN_TIMEOUT_MS } from "../conversation";
import type * as M from "../model";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";

/** At most one progress event per this many ms; the result carries the final state. */
export const PROGRESS_EVERY_MS = 50;

const turnIdParam = z.string().min(1).max(64).optional().describe("Any id. The window passes one to follow the reply as it streams (conversation.progress events).");
const conversationIdParam = z.string().trim().min(1).describe("A conversation id from conversation.list or an earlier turn.");

/** Runs one turn against eero and builds its items. */
async function runTurn(ctx: CommandContext, request: ConversationRequest, turnId: string | undefined): Promise<M.ConversationTurn> {
  const net = ctx.net;
  const b = new ConversationBuilder(request.conversationId);
  if (request.message !== undefined) b.apply({ type: "user", id: null, text: request.message });
  if (request.answer) b.apply({ type: "answer", id: request.answer.id, approved: request.answer.approved });
  const userItems = b.items.length;

  let last = 0;
  const progress = (force = false) => {
    if (!turnId) return;
    const t = ctx.now();
    if (!force && t - last < PROGRESS_EVERY_MS) return;
    last = t;
    ctx.emit({ type: "conversation.progress", turn: turnId, networkId: net, conversationId: b.conversationId, items: b.items });
  };
  progress(true);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TURN_TIMEOUT_MS);
  try {
    await ctx.backend.conversation.send(
      net,
      request,
      (event) => {
        b.apply(event);
        progress();
      },
      controller.signal,
    );
  } catch (err) {
    const message = timedOut ? "eero took too long to answer, so Mesh UI stopped waiting." : err instanceof Error ? err.message : "The reply stopped.";
    // Nothing from eero yet: fail the command. Part of a reply already shown: keep it and note the break.
    if (b.items.length === userItems && !timedOut) throw err;
    if (err instanceof BackendError && err.code === "not_signed_in") throw err;
    b.apply({ type: "error", message: `${message} Open the conversation again to see where it stopped.` });
  } finally {
    clearTimeout(timer);
  }
  b.finish();
  ctx.invalidate(["conversations"]);
  let items = b.items;
  let waitingFor = b.waitingFor;
  // No reply text came through the stream (its event names are not fully known): eero's history has it.
  if (!items.some((i) => i.kind === "reply" && i.text.trim()) && b.conversationId) {
    const after = await replyFromHistory(ctx, b.conversationId, request).catch(() => null);
    if (after?.items.length) {
      items = [...items.slice(0, userItems), ...after.items];
      waitingFor = after.waitingFor;
    }
  }
  const turn: M.ConversationTurn = { conversationId: b.conversationId, items, waitingFor };
  if (turnId) ctx.emit({ type: "conversation.progress", turn: turnId, networkId: net, conversationId: turn.conversationId, items: turn.items });
  return turn;
}

/**
 * This turn's part of eero's history: what follows the last message from the
 * user (a message turn) or the answered ask (an answer turn).
 */
async function replyFromHistory(ctx: CommandContext, id: M.Id, request: ConversationRequest): Promise<{ items: M.ConversationItem[]; waitingFor: string | null }> {
  const raw = await ctx.backend.conversation.get(ctx.net, id);
  const all = buildItems(raw.events, raw.id);
  const from = request.answer ? all.findIndex((i) => i.kind === "permission" && i.id === request.answer?.id) : all.findLastIndex((i) => i.kind === "user");
  if (from < 0) return { items: [], waitingFor: null };
  const items = all.slice(from + 1);
  const open = items.findLast((i) => i.kind === "permission" && i.answer === null);
  return { items, waitingFor: open?.id ?? null };
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "conversation.list",
    label: "Conversations",
    description: "Past chats with eero's assistant on this network, newest first.",
    icon: "messages-square",
    params: z.object({}),
    effect: "query",
    topic: "conversations",
    async run(ctx): Promise<M.ConversationSummary[]> {
      const list = await ctx.backend.conversation.list(ctx.net);
      return [...list].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    },
  }),
  defineCommand({
    id: "conversation.get",
    label: "Open conversation",
    description: "One chat with eero's assistant: messages, steps eero took, permission asks and cards, in order.",
    icon: "message-square",
    params: z.object({ conversationId: conversationIdParam }),
    effect: "query",
    topic: "conversations",
    async run(ctx, p): Promise<M.Conversation> {
      const raw = await ctx.backend.conversation.get(ctx.net, p.conversationId);
      return { id: raw.id, title: raw.title, items: buildItems(raw.events, raw.id) };
    },
  }),
  defineCommand({
    id: "conversation.suggestions",
    label: "Conversation suggestions",
    description: "Starter prompts for a new chat: eero's own for this network, or a few general ones when eero has none.",
    icon: "lightbulb",
    params: z.object({}),
    effect: "query",
    topic: "conversations",
    ttl: 10 * 60,
    async run(ctx): Promise<M.ConversationSuggestion[]> {
      const list = await ctx.backend.conversation.suggestions(ctx.net);
      return list.length ? list.slice(0, 6) : STARTER_PROMPTS;
    },
  }),
  defineCommand({
    id: "conversation.send",
    label: "Ask eero",
    description:
      "Sends a message to eero's assistant and returns its reply once it ends. Leave out conversationId to start a new chat. eero may stop to ask permission before changing something (waitingFor); answer with conversation.approve or conversation.decline.",
    icon: "send",
    params: z.object({
      message: z.string().trim().min(1).max(MAX_MESSAGE).describe(`What to ask, up to ${MAX_MESSAGE} characters.`),
      conversationId: conversationIdParam.optional(),
      turnId: turnIdParam,
    }),
    effect: "write",
    // Asking changes nothing on the network; eero asks before it does.
    gate: { area: null },
    invalidates: ["conversations"],
    run: (ctx, p) => runTurn(ctx, { conversationId: p.conversationId ?? null, message: p.message }, p.turnId),
  }),
  defineCommand({
    id: "conversation.approve",
    label: "Approve eero's request",
    description:
      "Lets eero's assistant go ahead with what it asked permission for (a permission ask from conversation.send). eero then changes the network itself, which may take devices offline, so this needs confirm. Returns the rest of the reply.",
    icon: "check",
    params: z.object({
      conversationId: conversationIdParam,
      permissionId: z.string().min(1).describe("The permission ask's id (waitingFor, or a permission item's id)."),
      turnId: turnIdParam,
    }),
    effect: "disruptive",
    gate: { area: "network" },
    invalidates: ["conversations", "network", "eeros", "devices", "profiles", "settings", "wifi", "guest"],
    async confirmMessage(ctx, p) {
      const chat = await ctx.backend.conversation.get(ctx.net, p.conversationId).catch(() => null);
      const ask = chat ? buildItems(chat.events).find((i) => i.kind === "permission" && i.id === p.permissionId) : undefined;
      const what = ask?.kind === "permission" ? [ask.question, ...ask.tools.map((t) => `- ${t}`)].join("\n") : "eero will change your network.";
      return `${what}\n\neero runs this on your network itself, and devices may go offline.`;
    },
    run: (ctx, p) => runTurn(ctx, { conversationId: p.conversationId, answer: { id: p.permissionId, approved: true } }, p.turnId),
  }),
  defineCommand({
    id: "conversation.decline",
    label: "Decline eero's request",
    description: "Tells eero's assistant not to go ahead with what it asked permission for. Nothing changes on the network. Returns the rest of the reply.",
    icon: "x",
    params: z.object({
      conversationId: conversationIdParam,
      permissionId: z.string().min(1).describe("The permission ask's id (waitingFor, or a permission item's id)."),
      turnId: turnIdParam,
    }),
    effect: "write",
    gate: { area: null },
    invalidates: ["conversations"],
    run: (ctx, p) => runTurn(ctx, { conversationId: p.conversationId, answer: { id: p.permissionId, approved: false } }, p.turnId),
  }),
  defineCommand({
    id: "conversation.rate",
    label: "Rate eero's reply",
    description: "Tells eero whether one of its replies helped. One rating per reply.",
    icon: "thumbs-up",
    params: z.object({
      messageId: z.string().min(1).describe("The reply's id (a reply item's id)."),
      helpful: z.boolean().describe("true: helpful, false: not helpful."),
    }),
    effect: "write",
    gate: { area: null },
    async run(ctx, p): Promise<{ messageId: string; helpful: boolean }> {
      if (/^reply-\d+$/.test(p.messageId)) throw new CommandError("bad_params", "eero gave this reply no id, so it cannot be rated.");
      await ctx.backend.conversation.rate(ctx.net, p.messageId, p.helpful);
      return { messageId: p.messageId, helpful: p.helpful };
    },
  }),
];
