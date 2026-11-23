/**
 * Fake assistant chat (`/2.2/conversations*`), in the shapes of the LD
 * client's reference (docs/eero-api/endpoints.md, Conversations):
 * `GET /conversations?networkId=&excludeEmpty=`, `GET /conversations/recommended`,
 * `GET /conversations/:id`, `POST /conversations/token`, the streamed
 * `PUT /conversations/messages` (JSON objects back to back, some with a
 * newline between them and some without, as eero sends them), and
 * `PUT /conversations/feedbacks`. A message that mentions "restart" gets a
 * permission ask; the answer comes as a turn with `permission_grant`.
 * Chats live in `state.extra.conversations`.
 */

import type { RawConversationHistoryRow } from "../../../src/core/eero/raw";
import { fail, ok, type Route } from "../server";
import type { FakeState } from "../state";

type FakeChat = { id: string; net: string; description: string; created: string; history: RawConversationHistoryRow[] };

/** The tokens handed out by `POST /conversations/token`, for tests to check they were sent. */
export const TOOL_TOKEN = "fake-mcp-token";

const chats = (state: FakeState): Map<string, FakeChat> => ((state.extra.conversations as Map<string, FakeChat> | undefined) ??= new Map());

export const routes: Route[] = [
  {
    method: "GET",
    path: "/conversations",
    versions: ["2.2"],
    handle: ({ req, state }) => {
      const net = req.query.get("networkId");
      if (!net) return fail(400, "error.params.invalid");
      const rows = [...chats(state).values()].filter((c) => c.net === net && (req.query.get("excludeEmpty") !== "true" || c.history.length > 0));
      return ok({ conversations: rows.map((c) => ({ conversation_id: c.id, description: c.description, created: c.created })) });
    },
  },
  {
    method: "GET",
    path: "/conversations/recommended",
    versions: ["2.2"],
    handle: ({ req }) =>
      req.query.get("networkId")
        ? ok({ recommendations: [{ suggested_prompt: "Why is my Wi-Fi slow today?", title: "Slow Wi-Fi" }, { suggested_prompt: "Is anything offline?", cta_text: "Check status" }, { title: "No prompt" }] })
        : fail(400, "error.params.invalid"),
  },
  {
    method: "POST",
    path: "/conversations/token",
    versions: ["2.2"],
    handle: () => ok({ access_token: TOOL_TOKEN }),
  },
  {
    method: "PUT",
    path: "/conversations/feedbacks",
    versions: ["2.2"],
    handle: ({ req }) => (typeof req.body.message_id === "string" && typeof req.body.positive === "boolean" ? ok(null) : fail(400, "error.params.invalid")),
  },
  {
    method: "PUT",
    path: "/conversations/messages",
    versions: ["2.2"],
    handle: ({ req, state }) => {
      const body = req.body as { context?: { focused_network_id?: string }; conversation_id?: string; message?: string; permission_grant?: { approved?: boolean; interrupt_id?: string } };
      const net = body.context?.focused_network_id;
      if (!net || !state.networks.has(net)) return fail(400, "error.params.invalid");
      const all = chats(state);
      let chat = body.conversation_id ? all.get(body.conversation_id) : undefined;
      if (body.conversation_id && !chat) return fail(404, "error.not.found");
      if (!chat) {
        const id = `conv-${state.nextId()}`;
        chat = { id, net, description: (body.message ?? "").slice(0, 40), created: new Date(state.now()).toISOString(), history: [] };
        all.set(id, chat);
      }
      const id = chat.id;
      const msg = `msg-${state.nextId()}`;
      const events: Record<string, unknown>[] = [];
      if (body.permission_grant) {
        chat.history.push({ permission_grant: { approved: body.permission_grant.approved, interrupt_id: body.permission_grant.interrupt_id } });
        const text = body.permission_grant.approved ? "Restarting it now." : "Okay, I will leave it.";
        events.push({ conversation_id: id, type: "InitialMessage", message_id: msg, content: text, finished: true });
        chat.history.push({ message_id: msg, message: { sender: "ASSISTANT", content: text } });
      } else {
        const text = body.message ?? "";
        chat.history.push({ message_id: `user-${state.nextId()}`, message: { sender: "USER", content: text } });
        events.push({ conversation_id: id, type: "ToolUse", content: "network_status" });
        events.push({ conversation_id: id, type: "InitialMessage", message_id: msg, content: "Your network {is} " });
        events.push({ conversation_id: id, type: "MessageDelta", message_id: msg, content: 'online and "healthy".' });
        events.push({ conversation_id: id, type: "MessageDelta", message_id: msg, content: "", finished: true });
        chat.history.push({ message_id: msg, message: { sender: "ASSISTANT", content: 'Your network {is} online and "healthy".' } });
        const card = { instance_id: "w1", widget_type: "eero_status", content_summary: "Living Room", properties: { status: "online", connected: true, choices: ["Restart it"] } };
        events.push({ conversation_id: id, widget_event: card });
        chat.history.push({ widget_event: card });
        if (/restart/i.test(text)) {
          const ask = { interrupt_id: `int-${state.nextId()}`, friendly_sentence: "Restart Living Room?", tool_descriptions: ["Reboot eero Living Room"] };
          events.push({ conversation_id: id, permission_request: ask });
          chat.history.push({ permission_request: ask });
          // eero keeps the stream open after an ask; the client must stop reading on its own.
          events.push({ conversation_id: id, type: "MessageDelta", message_id: "after-ask", content: "never read" });
        }
      }
      // Back to back: newlines between some objects, none between others.
      const raw = events.map((e, i) => JSON.stringify(e) + (i % 2 ? "" : "\n")).join("");
      return { status: 200, raw };
    },
  },
  {
    method: "GET",
    path: "/conversations/:id",
    versions: ["2.2"],
    handle: ({ params, state }) => {
      const chat = chats(state).get(params.id ?? "");
      if (!chat) return fail(404, "error.not.found");
      return ok({ conversation_id: chat.id, description: chat.description, message_history: chat.history });
    },
  },
];
