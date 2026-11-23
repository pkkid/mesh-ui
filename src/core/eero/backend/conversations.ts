/**
 * eero backend, conversation area (eero's assistant chat):
 * `GET /2.2/conversations?networkId=&excludeEmpty=true`,
 * `GET /2.2/conversations/{id}`, `GET /2.2/conversations/recommended?networkId=`,
 * `POST /2.2/conversations/token` (a short-lived `mcp_token`, fetched before
 * every turn and never kept or returned), the streamed
 * `PUT /2.2/conversations/messages`, and `PUT /2.2/conversations/feedbacks`.
 * Shapes from the LD client's reference; not yet captured on a real network.
 * See docs/eero-api/endpoints.md (Conversations).
 */

import type { ConversationRequest } from "../../backend";
import { BackendError } from "../../errors";
import { readJsonObjects } from "../jsonStream";
import { mapConversation, mapConversationSummary, mapStreamEvent, mapSuggestion } from "../map/conversations";
import { asList, type RawConversation, type RawConversationRecommendation, type RawConversationSummary } from "../raw";
import type { EeroArea } from "./index";

/** The request body every turn shares (`warmup` takes it too). */
export function turnBody(net: string, req: ConversationRequest, mcpToken: string | null): Record<string, unknown> {
  const body: Record<string, unknown> = { context: { focused_network_id: net, client_capabilities: { opt_in_widgets: [] } } };
  if (req.conversationId) body.conversation_id = req.conversationId;
  if (req.message !== undefined) body.message = req.message;
  if (mcpToken) body.mcp_token = mcpToken;
  if (req.answer) body.permission_grant = { approved: req.answer.approved, interrupt_id: req.answer.id };
  return body;
}

/** Fields whose values are names, not text, so the shape print may show them. */
const ENUM_FIELDS = new Set(["type", "sender", "widget_type", "action", "status", "finished"]);

/**
 * A stream object with every string cut to its length, except enum-like fields:
 * `{"type":"message","content":"<42 chars>"}`. Never holds message text.
 */
export function streamShape(v: unknown, key = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => streamShape(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, streamShape(x, k)]));
  if (typeof v === "string") return ENUM_FIELDS.has(key) && v.length <= 40 ? v : `<${v.length} chars>`;
  return v;
}

export const conversation: EeroArea<"conversation"> = ({ client }) => {
  // Diagnostics while the live stream format is unconfirmed: MESH_UI_CHAT_SHAPES=1 prints each object's shape to stderr.
  const printShapes = typeof process !== "undefined" && process.env.MESH_UI_CHAT_SHAPES === "1";
  /** The assistant's tool token for one turn, or null when eero gives none (the turn still goes). */
  const toolToken = async (): Promise<string | null> => {
    try {
      const data = await client.request<{ access_token?: unknown } | null>({ method: "POST", path: "/2.2/conversations/token", body: { refresh_token: "" } });
      return typeof data?.access_token === "string" && data.access_token ? data.access_token : null;
    } catch (err) {
      if (err instanceof BackendError && (err.code === "not_signed_in" || err.code === "rate_limited")) throw err;
      return null;
    }
  };

  return {
    async list(net) {
      const data = await client.request<unknown>({ method: "GET", path: "/2.2/conversations", query: { networkId: net, excludeEmpty: true } });
      return asList<RawConversationSummary>(data, "conversations").flatMap((r) => mapConversationSummary(r) ?? []);
    },
    async get(_net, id) {
      const data = await client.request<RawConversation | null>({ method: "GET", path: `/2.2/conversations/${encodeURIComponent(id)}` });
      return mapConversation(data, id);
    },
    async suggestions(net) {
      const data = await client.request<unknown>({ method: "GET", path: "/2.2/conversations/recommended", query: { networkId: net } });
      return asList<RawConversationRecommendation>(data, "recommendations").flatMap((r) => mapSuggestion(r) ?? []);
    },
    async send(net, req, onEvent, signal) {
      const token = await toolToken();
      // Stops reading when eero asks permission (the rest comes after the answer) or the caller gives up.
      const stop = new AbortController();
      const abort = () => stop.abort();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await client.request<null>({
          method: "PUT",
          path: "/2.2/conversations/messages",
          body: turnBody(net, req, token),
          stream: (response) =>
            readJsonObjects(
              response.body,
              (raw) => {
                if (printShapes) process.stderr.write(`chat-shape ${JSON.stringify(streamShape(raw))}\n`);
                for (const event of mapStreamEvent(raw)) {
                  onEvent(event);
                  if (event.type === "permission") stop.abort();
                }
              },
              stop.signal,
            ),
        });
      } finally {
        signal?.removeEventListener("abort", abort);
      }
      if (signal?.aborted) throw new BackendError("network_error", "Stopped waiting for eero's reply.");
    },
    async rate(_net, messageId, helpful) {
      await client.request<unknown>({ method: "PUT", path: "/2.2/conversations/feedbacks", body: { message_id: messageId, positive: helpful } });
    },
  };
};
