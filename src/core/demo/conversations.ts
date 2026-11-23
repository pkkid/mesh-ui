/**
 * The demo backend's assistant chat: canned replies streamed a few words at
 * a time, built from the network's fixtures. Asking about a slow network
 * shows steps, a device card with choices and a Markdown list; asking to
 * restart an eero shows a permission ask, and approving it really restarts
 * that eero in the demo. Two past chats per network fill the history.
 */

import type { ConversationBackend, ConversationRequest } from "../backend";
import { BackendError } from "../errors";
import type * as M from "../model";

type Chat = { id: M.Id; title: string; createdAt: M.Iso; events: M.ConversationEvent[] };

type Card = NonNullable<Extract<M.ConversationEvent, { type: "card" }>["card"]>;

export type DemoChatDeps = {
  now: () => number;
  /** Network facts the replies use. Throws not_signed_in or a missing network like any read. */
  facts: (net: M.Id) => { name: string; eeros: M.Eero[]; devices: M.Device[] };
  /** Restarts one demo eero (the approve path). */
  restartEero: (net: M.Id, eeroId: M.Id) => Promise<void>;
  /** Pause between streamed pieces, in ms. */
  delayMs: number;
};

/** A reply plan: what streams, in order. */
type Plan = { steps: M.ConversationStep[]; text: string; card?: { id: string; card: Card }; ask?: { question: string; tools: string[]; eeroId: M.Id } };

const SUGGESTIONS: M.ConversationSuggestion[] = [
  { label: "Why is my Wi-Fi slow?", prompt: "Why is my Wi-Fi slow?" },
  { label: "Is my internet working?", prompt: "Is my internet working right now?" },
  { label: "Which devices have a weak signal?", prompt: "Which devices have a weak signal?" },
  { label: "Restart an eero", prompt: "Can you restart the office eero?" },
];

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Words in pieces of three, keeping the spaces, so the stream reads like eero's. */
const pieces = (text: string): string[] => {
  const words = text.split(/(?<=\s)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 3) out.push(words.slice(i, i + 3).join(""));
  return out;
};

const deviceName = (d: M.Device) => d.nickname ?? d.name;

function weakest(devices: M.Device[]): M.Device | undefined {
  return devices.filter((d) => d.connected && d.signal?.bars != null).sort((a, b) => (a.signal?.bars ?? 5) - (b.signal?.bars ?? 5))[0];
}

function deviceCard(d: M.Device, eeros: M.Eero[], choices: string[]): { id: string; card: Card } {
  const eero = eeros.find((e) => e.id === d.eeroId);
  const rows: M.ConversationCardRow[] = [
    { label: "Status", value: d.connected ? "Online" : "Offline" },
    { label: "Connection type", value: d.band ? "Wireless" : "Wired" },
  ];
  if (eero) rows.push({ label: "eero", value: eero.location });
  if (d.signal?.bars != null) rows.push({ label: "Bars", value: `${d.signal.bars} of 5` });
  return { id: `card-device-${d.id}`, card: { title: deviceName(d), type: "device", rows, contacts: [], choices } };
}

function plan(message: string, facts: ReturnType<DemoChatDeps["facts"]>): Plan {
  const m = message.toLowerCase();
  const { eeros, devices, name } = facts;
  const gateway = eeros.find((e) => e.isGateway) ?? eeros[0];
  const online = devices.filter((d) => d.connected).length;

  if (/restart|reboot/.test(m)) {
    const target = eeros.find((e) => m.includes(e.location.toLowerCase())) ?? eeros.find((e) => !e.isGateway) ?? gateway;
    if (!target) return { steps: [], text: "This network has no eeros I can restart." };
    return {
      steps: [{ kind: "tool", text: "Looked up the eeros on this network" }],
      text: `I can restart **${target.location}**. Its devices will drop off for a minute or two and then reconnect on their own.`,
      ask: { question: `Restart the ${target.location} eero?`, tools: [`Restart eero "${target.location}"`], eeroId: target.id },
    };
  }
  if (/slow|speed|lag|buffer/.test(m)) {
    const weak = weakest(devices);
    const lines = [
      "Here is what I found:",
      "",
      `- **Internet** looks healthy. ${gateway ? `${gateway.location} is online and` : "The gateway is"} getting your full plan speed.`,
      `- **${online} devices** are online right now.`,
      weak ? `- **${deviceName(weak)}** has the weakest signal (${weak.signal?.bars ?? "-"} of 5 bars), which can make it feel slow.` : "- Every device has a good signal.",
      "",
      "Moving the device closer to an eero, or adding an eero between them, usually helps. Want me to run a speed test?",
    ];
    return {
      steps: [
        { kind: "tool", text: "Checked the internet connection" },
        { kind: "reasoning", text: "Comparing signal strength across devices" },
        { kind: "tool", text: "Read Wi-Fi signal for each device" },
      ],
      text: lines.join("\n"),
      card: weak ? deviceCard(weak, eeros, ["Run a speed test", "How do I improve coverage?"]) : undefined,
    };
  }
  if (/weak|signal|coverage/.test(m)) {
    const weak = devices.filter((d) => d.connected && (d.signal?.bars ?? 5) <= 2);
    const text = weak.length
      ? `${weak.length} device${weak.length === 1 ? " has" : "s have"} a weak signal:\n\n${weak.map((d) => `- ${deviceName(d)}: ${d.signal?.bars} of 5 bars`).join("\n")}\n\nThey are usually far from an eero or behind thick walls.`
      : "Every connected device has a good signal right now.";
    return { steps: [{ kind: "tool", text: "Read Wi-Fi signal for each device" }], text, card: weak[0] ? deviceCard(weak[0], eeros, []) : undefined };
  }
  if (/internet|online|down|working/.test(m)) {
    return {
      steps: [{ kind: "tool", text: "Checked the internet connection" }],
      text: `Yes, ${name} is online. ${eeros.length} eero${eeros.length === 1 ? " is" : "s are"} connected and ${online} devices are online. I see no outages in the last 24 hours.`,
    };
  }
  if (/help|support|contact|call/.test(m)) {
    return {
      steps: [],
      text: "You can reach eero support any of these ways:",
      card: {
        id: "card-support",
        card: { title: "Contact eero support", type: "support_contacts", rows: [], contacts: [{ label: "Phone", value: "+1 555 0100" }, { label: "Help center", value: "support.example.com" }], choices: [] },
      },
    };
  }
  return {
    steps: [{ kind: "reasoning", text: null }],
    text: `I can help with ${name}: checking your internet, finding devices with a weak signal, or restarting an eero. What would you like to look at?`,
  };
}

export function createDemoConversations(deps: DemoChatDeps): ConversationBackend {
  const chats = new Map<M.Id, Map<M.Id, Chat>>();
  /** Open permission asks: interrupt id to what approving does. */
  const asks = new Map<string, { net: M.Id; chat: M.Id; eeroId: M.Id }>();
  let seq = 0;
  const next = (p: string) => `${p}-${(++seq).toString(36)}`;

  const chatsFor = (net: M.Id): Map<M.Id, Chat> => {
    deps.facts(net);
    let m = chats.get(net);
    if (!m) {
      m = new Map();
      const day = 86_400_000;
      const t = deps.now();
      m.set(`demo-${net}-1`, {
        id: `demo-${net}-1`,
        title: "Is my internet working?",
        createdAt: new Date(t - 2 * day).toISOString(),
        events: [
          { type: "user", id: "h1", text: "Is my internet working right now?" },
          { type: "text", messageId: "h2", text: "Yes. Your network is online and I see no outages in the last 24 hours.", append: false },
          { type: "finished", messageId: "h2" },
        ],
      });
      m.set(`demo-${net}-2`, {
        id: `demo-${net}-2`,
        title: "Slow Wi-Fi in the office",
        createdAt: new Date(t - 9 * day).toISOString(),
        events: [
          { type: "user", id: "h3", text: "The Wi-Fi in my office is slow." },
          { type: "text", messageId: "h4", text: "Your office devices connect through a wireless eero with **2 of 5** bars to the gateway. Moving it a little closer should help.", append: false },
          { type: "finished", messageId: "h4" },
        ],
      });
      chats.set(net, m);
    }
    return m;
  };

  return {
    async list(net) {
      return [...chatsFor(net).values()].map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt }));
    },
    async get(net, id) {
      const c = chatsFor(net).get(id);
      if (!c) throw new BackendError("eero_error", "This isn't available on this network or eero model.", { status: 404 });
      return { id: c.id, title: c.title, events: structuredClone(c.events) };
    },
    async suggestions(net) {
      deps.facts(net);
      return SUGGESTIONS;
    },
    async send(net, req: ConversationRequest, onEvent, signal) {
      const all = chatsFor(net);
      let chat = req.conversationId ? all.get(req.conversationId) : undefined;
      if (req.conversationId && !chat) throw new BackendError("eero_error", "This isn't available on this network or eero model.", { status: 404 });
      if (!chat) {
        const id = next(`chat-${net}`);
        chat = { id, title: req.message?.slice(0, 60) ?? "Conversation", createdAt: new Date(deps.now()).toISOString(), events: [] };
        all.set(id, chat);
      }
      const c = chat;
      const emit = (e: M.ConversationEvent) => {
        c.events.push(e);
        onEvent(e);
      };
      const wait = async () => {
        await sleep(deps.delayMs);
        if (signal?.aborted) throw new BackendError("network_error", "Stopped waiting for eero's reply.");
      };
      const stream = async (text: string) => {
        const messageId = next("msg");
        let first = true;
        for (const piece of pieces(text)) {
          await wait();
          emit({ type: "text", messageId, text: piece, append: !first });
          first = false;
        }
        emit({ type: "finished", messageId });
      };

      onEvent({ type: "conversation", id: c.id });
      if (req.message !== undefined) c.events.push({ type: "user", id: next("user"), text: req.message });

      if (req.answer) {
        const ask = asks.get(req.answer.id);
        if (!ask || ask.chat !== c.id) throw new BackendError("bad_params", "That permission ask is not open.");
        asks.delete(req.answer.id);
        c.events.push({ type: "answer", id: req.answer.id, approved: req.answer.approved });
        if (!req.answer.approved) {
          await stream("Okay, I won't change anything.");
          return;
        }
        await wait();
        onEvent({ type: "step", step: { kind: "tool", text: "Restarted the eero" } });
        await deps.restartEero(net, ask.eeroId);
        const eero = deps.facts(net).eeros.find((e) => e.id === ask.eeroId);
        await stream(`Done. **${eero?.location ?? "The eero"}** is restarting and should be back in about two minutes.`);
        return;
      }

      const p = plan(req.message ?? "", deps.facts(net));
      for (const step of p.steps) {
        await wait();
        onEvent({ type: "step", step });
      }
      await stream(p.text);
      if (p.card) {
        await wait();
        emit({ type: "card", id: p.card.id, card: p.card.card });
      }
      if (p.ask) {
        await wait();
        const id = next("ask");
        asks.set(id, { net, chat: c.id, eeroId: p.ask.eeroId });
        emit({ type: "permission", id, question: p.ask.question, tools: p.ask.tools });
      }
    },
    async rate(net, messageId) {
      const known = [...chatsFor(net).values()].some((c) => c.events.some((e) => (e.type === "text" || e.type === "finished") && e.messageId === messageId));
      if (!known) throw new BackendError("bad_params", "No reply has that id.");
    },
  };
}
