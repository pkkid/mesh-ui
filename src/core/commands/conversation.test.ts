import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import { TOOL_TOKEN } from "../../../test/fake-eero/routes/conversations";
import type { AuthState, Backend, SecretStore } from "../backend";
import { buildItems, humanize, STARTER_PROMPTS } from "../conversation";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { streamShape } from "../eero/backend/conversations";
import { JsonObjectSplitter, readJsonObjects } from "../eero/jsonStream";
import { mapConversation, mapStreamEvent } from "../eero/map/conversations";
import { createEngine } from "../engine";
import type * as M from "../model";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";

type Result<R> = { ok: true; result: R } | { ok: false; error: { code: string; message: string } };
async function ok<R>(p: Promise<Result<R>>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}
const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

const demo = (scenario?: "signed_out") => {
  const backend = createDemoBackend({ clock: () => NOW, scenario, chatDelayMs: 0 });
  const engine = createEngine({ backend, clock: () => NOW });
  const events: M.HostEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return { backend, engine, events };
};

describe("conversation reads (demo)", () => {
  it("lists past chats newest first and opens one", async () => {
    const { engine } = demo();
    const list = await ok(engine.execute<M.ConversationSummary[]>("conversation.list", { networkId: MAPLE }));
    expect(list.length).toBe(2);
    expect(list.map((c) => c.createdAt)).toEqual([...list.map((c) => c.createdAt)].sort().reverse());
    const first = list[0] as M.ConversationSummary;
    const chat = await ok(engine.execute<M.Conversation>("conversation.get", { networkId: MAPLE, conversationId: first.id }));
    expect(chat.id).toBe(first.id);
    expect(chat.items.map((i) => i.kind)).toEqual(["user", "reply"]);
    expect(chat.items[1]).toMatchObject({ kind: "reply", done: true });
  });

  it("gives eero's suggestions, and fails bad params", async () => {
    const { engine } = demo();
    const s = await ok(engine.execute<M.ConversationSuggestion[]>("conversation.suggestions", { networkId: MAPLE }));
    expect(s.length).toBeGreaterThan(0);
    expect(await code(engine.execute("conversation.get", { networkId: MAPLE }))).toBe("bad_params");
    expect(await code(engine.execute("conversation.get", { networkId: MAPLE, conversationId: "nope" }))).toBe("eero_error");
  });

  it("needs a session", async () => {
    const { engine } = demo("signed_out");
    expect(await code(engine.execute("conversation.list"))).toBe("not_signed_in");
    expect(await code(engine.execute("conversation.send", { message: "hi" }))).toBe("not_signed_in");
  });
});

describe("conversation.send (demo)", () => {
  it("streams a reply with steps and a card, and tags progress with the turn id", async () => {
    const { engine, events } = demo();
    const turn = await ok(engine.execute<M.ConversationTurn>("conversation.send", { networkId: MAPLE, message: "Why is my Wi-Fi slow?", turnId: "t1" }));
    expect(turn.conversationId).toBeTruthy();
    expect(turn.waitingFor).toBeNull();
    expect(turn.items.map((i) => i.kind)).toEqual(["user", "steps", "reply", "card"]);
    const reply = turn.items.find((i) => i.kind === "reply");
    expect(reply).toMatchObject({ done: true });
    expect(reply?.kind === "reply" && reply.text).toContain("**Internet**");
    const progress = events.filter((e) => e.type === "conversation.progress");
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.every((e) => e.type === "conversation.progress" && e.turn === "t1" && e.networkId === MAPLE)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ items: turn.items, conversationId: turn.conversationId });
    // The new chat shows in the history, with the message as its title.
    const list = await ok(engine.execute<M.ConversationSummary[]>("conversation.list", { networkId: MAPLE }));
    expect(list.some((c) => c.id === turn.conversationId)).toBe(true);
  });

  it("emits nothing without a turn id", async () => {
    const { engine, events } = demo();
    await ok(engine.execute("conversation.send", { networkId: MAPLE, message: "Is my internet working?" }));
    expect(events.filter((e) => e.type === "conversation.progress")).toEqual([]);
  });

  it("continues a chat", async () => {
    const { engine } = demo();
    const a = await ok(engine.execute<M.ConversationTurn>("conversation.send", { networkId: MAPLE, message: "hello" }));
    const b = await ok(engine.execute<M.ConversationTurn>("conversation.send", { networkId: MAPLE, message: "Is my internet working?", conversationId: a.conversationId }));
    expect(b.conversationId).toBe(a.conversationId);
    const chat = await ok(engine.execute<M.Conversation>("conversation.get", { networkId: MAPLE, conversationId: a.conversationId }));
    expect(chat.items.filter((i) => i.kind === "user").map((i) => i.kind === "user" && i.text)).toEqual(["hello", "Is my internet working?"]);
  });

  it("checks params", async () => {
    const { engine } = demo();
    expect(await code(engine.execute("conversation.send", { networkId: MAPLE, message: "   " }))).toBe("bad_params");
    expect(await code(engine.execute("conversation.send", { networkId: MAPLE, message: "x".repeat(8001) }))).toBe("bad_params");
    expect(await code(engine.execute("conversation.send", { networkId: MAPLE, message: "hi", conversationId: "missing" }))).toBe("eero_error");
  });
});

describe("permission asks (demo)", () => {
  const ask = async () => {
    const d = demo();
    const turn = await ok(d.engine.execute<M.ConversationTurn>("conversation.send", { networkId: MAPLE, message: "Can you restart the office eero?" }));
    return { ...d, turn };
  };

  it("stops at the ask and waits for it", async () => {
    const { turn } = await ask();
    expect(turn.waitingFor).toBeTruthy();
    expect(turn.items.at(-1)).toMatchObject({ kind: "permission", id: turn.waitingFor, answer: null });
  });

  it("approve needs confirm, then eero restarts the eero", async () => {
    const { engine, turn } = await ask();
    const params = { networkId: MAPLE, conversationId: turn.conversationId, permissionId: turn.waitingFor };
    const refused = await engine.execute("conversation.approve", params);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.code).toBe("needs_confirm");
    expect(!refused.ok && refused.error.message).toContain("Restart the Office eero?");
    const done = await ok(engine.execute<M.ConversationTurn>("conversation.approve", { ...params, confirm: true }));
    expect(done.waitingFor).toBeNull();
    expect(done.items.some((i) => i.kind === "reply" && i.text.includes("restarting"))).toBe(true);
    const eeros = await ok(engine.execute<M.Eero[]>("eero.list", { networkId: MAPLE }));
    expect(eeros.find((e) => e.location === "Office")?.status).toBe("updating");
    // The ask is answered in history, and cannot be answered twice.
    const chat = await ok(engine.execute<M.Conversation>("conversation.get", { networkId: MAPLE, conversationId: turn.conversationId }));
    expect(chat.items.find((i) => i.kind === "permission")).toMatchObject({ answer: "approved" });
    expect(await code(engine.execute("conversation.approve", { ...params, confirm: true }))).toBe("bad_params");
  });

  it("decline needs no confirm and changes nothing", async () => {
    const { engine, turn } = await ask();
    const done = await ok(engine.execute<M.ConversationTurn>("conversation.decline", { networkId: MAPLE, conversationId: turn.conversationId, permissionId: turn.waitingFor }));
    expect(done.items.some((i) => i.kind === "reply" && i.text.includes("won't"))).toBe(true);
    const eeros = await ok(engine.execute<M.Eero[]>("eero.list", { networkId: MAPLE }));
    expect(eeros.find((e) => e.location === "Office")?.status).not.toBe("updating");
    expect(await code(engine.execute("conversation.decline", { networkId: MAPLE, conversationId: turn.conversationId }))).toBe("bad_params");
  });
});

describe("conversation.rate (demo)", () => {
  it("rates eero's replies only", async () => {
    const { engine } = demo();
    const turn = await ok(engine.execute<M.ConversationTurn>("conversation.send", { networkId: MAPLE, message: "Is my internet working?" }));
    const reply = turn.items.find((i) => i.kind === "reply");
    expect(await ok(engine.execute("conversation.rate", { networkId: MAPLE, messageId: reply?.id, helpful: true }))).toEqual({ messageId: reply?.id, helpful: true });
    expect(await code(engine.execute("conversation.rate", { networkId: MAPLE, messageId: "reply-3", helpful: true }))).toBe("bad_params");
    expect(await code(engine.execute("conversation.rate", { networkId: MAPLE, messageId: "x" }))).toBe("bad_params");
  });
});

// ---------------------------------------------------------------------------
// The eero client against the fake server

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
const secrets = (token: string): SecretStore => ({ load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" });

function fakeEngine(prepare?: (fake: FakeEero) => void) {
  const fake = createFakeEero({ now: () => NOW });
  prepare?.(fake);
  const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, engine: createEngine({ backend, clock: () => NOW }) };
}

describe("conversations (fake eero server)", () => {
  it("falls back to history when the stream carries no reply text", async () => {
    const fake = createFakeEero({
      now: () => NOW,
      routes: [{ method: "PUT", path: "/conversations/messages", handle: () => ({ status: 200, raw: '{"conversation_id":"conv-x","type":"somethingNew","payload":{}}' }) }, {
        method: "GET",
        path: "/conversations/conv-x",
        handle: () => ({ data: { conversation_id: "conv-x", message_history: [
          { type: "message", message_id: "u0", sender: "USER", content: "older" },
          { type: "message", message_id: "r0", sender: "ASSISTANT", content: "older answer" },
          { type: "message", message_id: "u1", sender: "USER", content: "status?" },
          { type: "message", message_id: "r1", sender: "ASSISTANT", content: "All fine." },
        ] } }),
      }],
    });
    const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
    const engine = createEngine({ backend: { ...eero, auth: { ...eero.auth, status: async () => signedIn } }, clock: () => NOW });
    const turn = await ok(engine.execute<M.ConversationTurn>("conversation.send", { networkId: "100001", message: "status?" }));
    expect(turn.items.map((i) => i.kind)).toEqual(["user", "reply"]);
    expect(turn.items[1]).toMatchObject({ id: "r1", text: "All fine." });
  });

  it("sends the turn body with a tool token and reads the stream", async () => {
    const { fake, engine } = fakeEngine();
    const turn = await ok(engine.execute<M.ConversationTurn>("conversation.send", { networkId: "100001", message: "status?" }));
    const put = fake.writes.find((w) => w.route === "/conversations/messages");
    expect(put).toMatchObject({ method: "PUT", version: "2.2", encoding: "json" });
    expect(put?.body).toEqual({ context: { focused_network_id: "100001", client_capabilities: { opt_in_widgets: [] } }, message: "status?", mcp_token: TOOL_TOKEN });
    expect(turn.conversationId).toMatch(/^conv-/);
    expect(turn.items.map((i) => i.kind)).toEqual(["user", "steps", "reply", "card"]);
    expect(turn.items[2]).toMatchObject({ text: 'Your network {is} online and "healthy".', done: true });
    expect(turn.items[3]).toMatchObject({ title: "Living Room", rows: [{ label: "Status", value: "online" }, { label: "Connected", value: "Yes" }], choices: ["Restart it"] });
  });

  it("stops reading at a permission ask and answers it", async () => {
    const { fake, engine } = fakeEngine();
    const turn = await ok(engine.execute<M.ConversationTurn>("conversation.send", { networkId: "100001", message: "restart the living room" }));
    expect(turn.waitingFor).toMatch(/^int-/);
    expect(turn.items.some((i) => i.kind === "reply" && i.id === "after-ask")).toBe(false);
    const done = await ok(
      engine.execute<M.ConversationTurn>("conversation.approve", { networkId: "100001", conversationId: turn.conversationId, permissionId: turn.waitingFor, confirm: true }),
    );
    expect(done.items.at(-1)).toMatchObject({ kind: "reply", text: "Restarting it now." });
    expect(fake.writes.at(-1)?.body).toMatchObject({ conversation_id: turn.conversationId, permission_grant: { approved: true, interrupt_id: turn.waitingFor } });
    expect(fake.writes.at(-1)?.body).not.toHaveProperty("message");
    // History reads back the same chat, the ask answered.
    const chat = await ok(engine.execute<M.Conversation>("conversation.get", { networkId: "100001", conversationId: turn.conversationId }));
    expect(chat.items.map((i) => i.kind)).toEqual(["user", "reply", "card", "permission", "reply"]);
    expect(chat.items[3]).toMatchObject({ answer: "approved", tools: ["Reboot eero Living Room"] });
    const list = await ok(engine.execute<M.ConversationSummary[]>("conversation.list", { networkId: "100001" }));
    expect(list.map((c) => c.id)).toEqual([turn.conversationId]);
  });

  it("maps suggestions and feedback", async () => {
    const { fake, engine } = fakeEngine();
    const s = await ok(engine.execute<M.ConversationSuggestion[]>("conversation.suggestions", { networkId: "100001" }));
    expect(s).toEqual([
      { label: "Slow Wi-Fi", prompt: "Why is my Wi-Fi slow today?" },
      { label: "Check status", prompt: "Is anything offline?" },
    ]);
    await ok(engine.execute("conversation.rate", { networkId: "100001", messageId: "msg-1", helpful: false }));
    expect(fake.writes.at(-1)).toMatchObject({ route: "/conversations/feedbacks", body: { message_id: "msg-1", positive: false } });
  });

  it("says plainly when eero has the assistant off", async () => {
    const { engine } = fakeEngine((fake) => fake.scenarios.fail(403, "error.conversations.not_available", { method: "PUT", path: "/conversations/messages" }));
    const r = await engine.execute("conversation.send", { networkId: "100001", message: "hi" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toBe("eero has not turned on its assistant for this account or network.");
  });

  it("falls back to starter prompts when eero suggests none", async () => {
    const fake = createFakeEero({ now: () => NOW, routes: [{ method: "GET", path: "/conversations/recommended", handle: () => ({ data: { recommendations: [] } }) }] });
    const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
    const engine = createEngine({ backend: { ...eero, auth: { ...eero.auth, status: async () => signedIn } }, clock: () => NOW });
    expect(await ok(engine.execute("conversation.suggestions", { networkId: "100001" }))).toEqual(STARTER_PROMPTS);
  });
});

// ---------------------------------------------------------------------------
// Pieces

describe("JsonObjectSplitter", () => {
  it("splits back to back objects fed in any pieces", () => {
    const text = '{"a":"}{"}\n{"b":[1,{"c":"\\"}"}]}  {"d":1}';
    for (const size of [1, 2, 5, text.length]) {
      const s = new JsonObjectSplitter();
      const out: unknown[] = [];
      for (let i = 0; i < text.length; i += size) out.push(...s.feed(text.slice(i, i + size)));
      s.finish();
      expect(out).toEqual([{ a: "}{" }, { b: [1, { c: '"}' }] }, { d: 1 }]);
    }
  });

  it("refuses what is not a stream of objects, and a cut off end", () => {
    expect(() => new JsonObjectSplitter().feed("<html>")).toThrow(/could not read/);
    const s = new JsonObjectSplitter();
    s.feed('{"a":');
    expect(() => s.finish()).toThrow(/cut off/);
  });

  it("reads a body split mid character", async () => {
    const bytes = new TextEncoder().encode('{"t":"café ✓"}{"t":"two"}');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const got: unknown[] = [];
    await readJsonObjects(body, (o) => got.push(o));
    expect(got).toEqual([{ t: "café ✓" }, { t: "two" }]);
  });
});

describe("mapping and building", () => {
  it("maps stream events, skipping unknown types", () => {
    expect(mapStreamEvent({ conversation_id: "c", type: "Mystery", content: "x" })).toEqual([{ type: "conversation", id: "c" }]);
    expect(mapStreamEvent({ type: "Error", content: "" })).toEqual([{ type: "error", message: "eero's assistant ran into a problem." }]);
    expect(mapStreamEvent({ widget_event: { instance_id: "w", action: "REMOVE" } })).toEqual([{ type: "card", id: "w", card: null }]);
    expect(mapStreamEvent("nope")).toEqual([]);
  });

  it("reads eero's real event names: message (whole or in pieces), toolUsage, and skips the user's echo", () => {
    const events = [
      { type: "message", sender: "USER", content: "hi" },
      { type: "toolUsage", tool_usage: { name: "net", message: "Checking your internet" } },
      { type: "toolResult", tool_result: { status: "success" } },
      { type: "message", message_id: "a", message: { sender: "ASSISTANT", content: "Your " } },
      { type: "message", message_id: "a", message: { sender: "ASSISTANT", content: "network is fine." } },
      { type: "message", message_id: "b", sender: "ASSISTANT", content: "All good" },
      { type: "message", message_id: "b", sender: "ASSISTANT", content: "All good here." },
    ].flatMap(mapStreamEvent);
    const items = buildItems(events);
    expect(items.map((i) => i.kind)).toEqual(["steps", "reply", "reply"]);
    expect(items[0]).toMatchObject({ steps: [{ kind: "tool", text: "Checking your internet" }] });
    expect(items[1]).toMatchObject({ text: "Your network is fine." });
    expect(items[2]).toMatchObject({ text: "All good here." });
  });

  it("maps real history rows (2026-11-22 shape)", () => {
    const chat = mapConversation(
      {
        conversation_id: "c",
        message_history: [
          { type: "message", message_id: "1", sender: "USER", content: "hi", message: { sender: "USER", content: "hi" } },
          { type: "toolUsage", message_id: "2", tool_usage: { name: "x", message: "Looked at the internet" } },
          { type: "toolResult", message_id: "3" },
          { type: "message", message_id: "4", sender: "ASSISTANT", content: "Fine.", message: { sender: "ASSISTANT", content: "Fine." } },
          { type: "widgetEvent", message_id: "5", widget_event: { action: "CREATE", instance_id: "w", widget_type: "choice", content_summary: "A, B", properties: { prompt_text: "Anything else?", choices: ["A", "B"] } } },
        ],
      },
      "c",
    );
    const items = buildItems(chat.events);
    expect(items.map((i) => i.kind)).toEqual(["user", "steps", "reply", "card"]);
    expect(items[3]).toMatchObject({ title: "Anything else?", choices: ["A", "B"] });
  });

  it("prints stream shapes without text", () => {
    expect(streamShape({ type: "message", content: "secret words", message: { sender: "ASSISTANT" }, n: 2, list: ["x"] })).toEqual({
      type: "message",
      content: "<12 chars>",
      message: { sender: "ASSISTANT" },
      n: 2,
      list: ["<1 chars>"],
    });
  });

  it("builds items: deltas join, cards replace and go, steps group", () => {
    const items = buildItems([
      { type: "user", id: null, text: "hi" },
      { type: "step", step: { kind: "tool", text: null } },
      { type: "step", step: { kind: "reasoning", text: "hmm" } },
      { type: "text", messageId: "m", text: "Hel", append: false },
      { type: "text", messageId: "m", text: "lo", append: true },
      { type: "card", id: "w", card: { title: "A", type: null, rows: [], contacts: [], choices: [] } },
      { type: "card", id: "w", card: { title: "B", type: null, rows: [], contacts: [], choices: [] } },
      { type: "card", id: "x", card: { title: "C", type: null, rows: [], contacts: [], choices: [] } },
      { type: "card", id: "x", card: null },
      { type: "error", message: "oops" },
    ]);
    expect(items.map((i) => i.kind)).toEqual(["user", "steps", "reply", "card", "error"]);
    expect(items[1]).toMatchObject({ steps: [{ kind: "tool" }, { kind: "reasoning", text: "hmm" }] });
    expect(items[2]).toMatchObject({ text: "Hello", done: true });
    expect(items[3]).toMatchObject({ title: "B" });
  });

  it("humanizes keys, keeping eero lower case", () => {
    expect(humanize("connection_type")).toBe("Connection type");
    expect(humanize("eero")).toBe("eero");
    expect(humanize("meshQualityBars")).toBe("Mesh quality bars");
  });
});
