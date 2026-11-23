/**
 * Builds a chat from eero's assistant events. The same builder runs for a
 * live reply (`conversation.send`) and for history (`conversation.get`), so
 * a chat reads the same either way. See docs/ux/pages/conversations.md.
 */

import type { ConversationEvent, ConversationItem, ConversationSuggestion, Id } from "./model";

/** The longest message eero takes. */
export const MAX_MESSAGE = 8000;

/** How long one turn may stream before Mesh UI stops reading. */
export const TURN_TIMEOUT_MS = 3 * 60_000;

/** Starter prompts for when eero suggests none. */
export const STARTER_PROMPTS: ConversationSuggestion[] = [
  { label: "Is my internet working right now?", prompt: "Is my internet working right now?" },
  { label: "Why is my Wi-Fi slow?", prompt: "Why is my Wi-Fi slow?" },
  { label: "Which devices use the most data?", prompt: "Which devices use the most data?" },
  { label: "How can I improve coverage?", prompt: "How can I improve coverage in my home?" },
];

type Reply = Extract<ConversationItem, { kind: "reply" }>;

/** Collects events into items. Mutable; `items` is copied on read. */
export class ConversationBuilder {
  conversationId: Id | null;
  waitingFor: string | null = null;
  private readonly list: ConversationItem[] = [];
  private seq = 0;
  /** The reply that text without a message id goes to. */
  private open: Reply | null = null;

  constructor(conversationId: Id | null = null) {
    this.conversationId = conversationId;
  }

  get items(): ConversationItem[] {
    return structuredClone(this.list);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private reply(messageId: string | null): Reply {
    if (messageId) {
      const found = this.list.find((i): i is Reply => i.kind === "reply" && i.id === messageId);
      if (found) return found;
    } else if (this.open && !this.open.done) return this.open;
    const created: Reply = { kind: "reply", id: messageId ?? this.nextId("reply"), text: "", done: false };
    this.list.push(created);
    this.open = created;
    return created;
  }

  apply(e: ConversationEvent): void {
    switch (e.type) {
      case "conversation":
        this.conversationId = e.id;
        return;
      case "user":
        this.list.push({ kind: "user", id: e.id ?? this.nextId("user"), text: e.text });
        this.open = null;
        return;
      case "text": {
        const r = this.reply(e.messageId);
        const append = e.merge ? !e.text.startsWith(r.text) || r.text === "" : e.append;
        r.text = append ? r.text + e.text : e.text;
        return;
      }
      case "finished": {
        const r = e.messageId ? this.list.find((i): i is Reply => i.kind === "reply" && i.id === e.messageId) : this.open;
        if (r) r.done = true;
        return;
      }
      case "step": {
        const last = this.list.at(-1);
        if (last?.kind === "steps") last.steps.push(e.step);
        else this.list.push({ kind: "steps", id: this.nextId("steps"), steps: [e.step] });
        return;
      }
      case "permission":
        if (!this.list.some((i) => i.kind === "permission" && i.id === e.id)) {
          this.list.push({ kind: "permission", id: e.id, question: e.question, tools: e.tools, answer: null });
        }
        this.waitingFor = e.id;
        this.open = null;
        return;
      case "answer": {
        const asks = this.list.filter((i) => i.kind === "permission");
        const ask = e.id ? asks.find((i) => i.id === e.id) : asks.findLast((i) => i.answer === null);
        if (ask?.kind === "permission") ask.answer = e.approved ? "approved" : "declined";
        if (!e.id || this.waitingFor === e.id) this.waitingFor = null;
        return;
      }
      case "card": {
        const at = this.list.findIndex((i) => i.kind === "card" && i.id === e.id);
        if (!e.card) {
          if (at >= 0) this.list.splice(at, 1);
          return;
        }
        const card: ConversationItem = { kind: "card", id: e.id, ...e.card };
        if (at >= 0) this.list[at] = card;
        else this.list.push(card);
        return;
      }
      case "error":
        this.list.push({ kind: "error", id: this.nextId("error"), message: e.message });
        this.open = null;
        return;
    }
  }

  /** The stream ended: every reply is complete. */
  finish(): void {
    for (const i of this.list) if (i.kind === "reply") i.done = true;
    this.open = null;
  }
}

/** Builds whole items from events (history). */
export function buildItems(events: ConversationEvent[], conversationId: Id | null = null): ConversationItem[] {
  const b = new ConversationBuilder(conversationId);
  for (const e of events) b.apply(e);
  b.finish();
  return b.items;
}

/** "connection_type" to "Connection type"; "eero" stays lower case. */
export function humanize(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  // The brand stays lower case ("eero", "eero count").
  if (!words || words.startsWith("eero")) return words;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
