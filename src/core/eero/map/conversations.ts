/**
 * eero's assistant chat shapes to model events. Live stream objects and
 * history rows both become `ConversationEvent`s, and core builds the chat
 * from them (src/core/conversation.ts). Field names come from the LD
 * client's reference (docs/eero-api/endpoints.md, Conversations).
 */

import { humanize } from "../../conversation";
import type * as M from "../../model";
import type {
  RawConversation,
  RawConversationEvent,
  RawConversationHistoryRow,
  RawConversationRecommendation,
  RawConversationSummary,
  RawPermissionRequest,
  RawWidgetEvent,
} from "../raw";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Card fields shown as rows, in this order. Others are left out (ids, links). */
const CARD_FIELDS = [
  "name",
  "location",
  "model",
  "status",
  "connected",
  "connection_type",
  "connection_state",
  "device_type",
  "is_guest",
  "is_private",
  "score_bars",
  "mesh_quality_bars",
  "wan_type",
  "eero",
  "port_number",
  "negotiated_speed",
  "total_devices",
  "paused_devices",
  "accessory_type",
  "bars",
  "cellular_backup_status",
  "configuration_status",
] as const;

const cardValue = (v: unknown): string | null => {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.includes("_") && !v.includes(" ") ? humanize(v) : v;
  if (v && typeof v === "object" && "name" in v) return str((v as { name?: unknown }).name);
  return null;
};

export function mapCard(w: RawWidgetEvent): M.ConversationEvent | null {
  const id = str(w.instance_id);
  if (!id) return null;
  if (/^(remove|delete)$/i.test(w.action ?? "")) return { type: "card", id, card: null };
  const p = w.properties ?? {};
  // A choice card asks a question: its prompt is the title (content_summary just lists the choices).
  const title = (w.widget_type === "choice" ? str(p.prompt_text) : null) ?? str(w.content_summary) ?? str(p.prompt_text) ?? str(p.title) ?? str(p.description) ?? (w.widget_type ? humanize(w.widget_type) : "Details");
  const rows: M.ConversationCardRow[] = [];
  for (const key of CARD_FIELDS) {
    const value = cardValue(p[key]);
    if (value !== null) rows.push({ label: humanize(key), value });
  }
  const contacts = (Array.isArray(p.contacts) ? p.contacts : []).flatMap((c) => {
    const t = str(c?.title);
    const v = str(c?.content);
    return t || v ? [{ label: t ?? "", value: v ?? "" }] : [];
  });
  const choices = (Array.isArray(p.choices) ? p.choices : []).flatMap((c) => (str(c) ? [String(c).trim()] : []));
  return { type: "card", id, card: { title, type: str(w.widget_type), rows, contacts, choices } };
}

function mapPermission(p: RawPermissionRequest): M.ConversationEvent | null {
  const id = str(p.interrupt_id);
  if (!id) return null;
  const tools = (Array.isArray(p.tool_descriptions) ? p.tool_descriptions : []).flatMap((t) => (str(t) ? [String(t)] : []));
  return { type: "permission", id, question: str(p.friendly_sentence) ?? str(p.content) ?? "eero wants to make a change.", tools };
}

/** One stream object to events, in order. Unknown types are skipped. */
export function mapStreamEvent(raw: unknown): M.ConversationEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as RawConversationEvent;
  const out: M.ConversationEvent[] = [];
  const conversationId = str(o.conversation_id);
  if (conversationId) out.push({ type: "conversation", id: conversationId });
  const messageId = str(o.message_id);
  const sender = o.message?.sender ?? o.sender;
  const text = [o.content, o.message?.content, o.delta, o.text].find((t): t is string => typeof t === "string") ?? "";
  // Type names vary: LD saw InitialMessage and MessageDelta, eero's history says message and toolUsage.
  switch ((o.type ?? "").replace(/[_\s-]/g, "").toLowerCase()) {
    case "initialmessage":
      out.push({ type: "text", messageId, text, append: false });
      break;
    case "messagedelta":
    case "delta":
    case "textdelta":
    case "contentdelta":
      out.push({ type: "text", messageId, text, append: true });
      break;
    case "message":
    case "":
      // eero may echo the user's own message; the turn already has it.
      if (sender !== "USER" && text) out.push({ type: "text", messageId, text, append: true, merge: true });
      break;
    case "tooluse":
    case "toolusage":
      out.push({ type: "step", step: { kind: "tool", text: str(o.tool_usage?.message) ?? str(text) } });
      break;
    case "reasoning":
      out.push({ type: "step", step: { kind: "reasoning", text: str(text) } });
      break;
    case "error":
      out.push({ type: "error", message: str(text) ?? "eero's assistant ran into a problem." });
      break;
  }
  if (o.widget_event) {
    const card = mapCard(o.widget_event);
    if (card) out.push(card);
  }
  if (o.permission_request) {
    const ask = mapPermission(o.permission_request);
    if (ask) out.push(ask);
  }
  if (o.finished === true) out.push({ type: "finished", messageId });
  return out;
}

function mapHistoryRow(row: RawConversationHistoryRow): M.ConversationEvent[] {
  const out: M.ConversationEvent[] = [];
  const id = str(row.message_id);
  if (/^tool_?usage$/i.test(row.type ?? "") && row.tool_usage) out.push({ type: "step", step: { kind: "tool", text: str(row.tool_usage.message) } });
  const content = row.message?.content ?? row.content;
  const text = typeof content === "string" ? content : null;
  if (text !== null) {
    if ((row.message?.sender ?? row.sender) === "USER") out.push({ type: "user", id, text });
    else out.push({ type: "text", messageId: id, text, append: false }, { type: "finished", messageId: id });
  }
  if (row.permission_request) {
    const ask = mapPermission(row.permission_request);
    if (ask) out.push(ask);
  }
  if (row.permission_grant && typeof row.permission_grant.approved === "boolean") {
    out.push({ type: "answer", id: str(row.permission_grant.interrupt_id), approved: row.permission_grant.approved });
  }
  if (row.widget_event) {
    const card = mapCard(row.widget_event);
    if (card) out.push(card);
  }
  return out;
}

export function mapConversation(raw: RawConversation | null, requested: M.Id): { id: M.Id; title: string | null; events: M.ConversationEvent[] } {
  const id = str(raw?.conversation_id) ?? requested;
  const events = (Array.isArray(raw?.message_history) ? raw.message_history : []).flatMap(mapHistoryRow);
  return { id, title: str(raw?.description), events };
}

export function mapConversationSummary(raw: RawConversationSummary): M.ConversationSummary | null {
  const id = str(raw.conversation_id);
  if (!id) return null;
  const created = str(raw.created);
  return { id, title: str(raw.description) ?? "Conversation", createdAt: created };
}

export function mapSuggestion(raw: RawConversationRecommendation): M.ConversationSuggestion | null {
  const prompt = str(raw.suggested_prompt);
  if (!prompt) return null;
  return { label: str(raw.title) ?? str(raw.cta_text) ?? prompt, prompt };
}
