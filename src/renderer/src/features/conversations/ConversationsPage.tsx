/**
 * Conversations: a chat with eero's assistant (the eero app's Support chat).
 * The chat fills the page with the composer pinned to the bottom; History,
 * an optional panel on the right, lists past chats (`conversation.list`).
 * A reply streams in through `conversation.progress` host events while
 * `conversation.send` runs. A new chat shows eero's starter prompts
 * (`conversation.suggestions`). Approving a permission ask is disruptive and
 * goes through the confirm dialog. docs/ux/pages/conversations.md.
 */
import { ArrowUp, MessagesSquare, PanelRight, SquarePen } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { PageProps } from "~/app/routes";
import { affectedBy, execute, invalidate, onHostEvent, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { toast } from "~/components/ui/toast";
import { TopBarActions, TopBarTitle } from "~/features/shell/TopBar";
import { cn } from "~/lib/utils";
import { MAX_MESSAGE } from "../../../../core/conversation";
import type { Conversation, ConversationItem, ConversationSuggestion, ConversationTurn } from "../../../../core/model";

import { HistoryPanel } from "./HistoryPanel";
import { Thread } from "./Thread";

const HISTORY_KEY = "mesh-ui.conversations.history";

function readHistoryOpen(): boolean {
  try {
    return localStorage.getItem(HISTORY_KEY) !== "closed";
  } catch {
    return true;
  }
}

function saveHistoryOpen(open: boolean): void {
  try {
    localStorage.setItem(HISTORY_KEY, open ? "open" : "closed");
  } catch {
    // Only a convenience.
  }
}

const newTurnId = () => (typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `turn-${Date.now()}-${Math.random()}`);

/** The chat on screen: its id (null until eero names a new one), its items, and the permission ask it waits on. */
type ChatState = { id: string | null; items: ConversationItem[]; waitingFor: string | null };

const EMPTY: ChatState = { id: null, items: [], waitingFor: null };

export function ConversationsPage(_: PageProps) {
  const [chat, setChat] = useState<ChatState>(EMPTY);
  /** The turn streaming now: its id and its items so far. */
  const [live, setLive] = useState<{ turn: string; items: ConversationItem[] } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(readHistoryOpen);
  const suggestions = useQuery<ConversationSuggestion[]>("conversation.suggestions");
  const approve = useWrite<{ conversationId: string; permissionId: string; turnId: string }, ConversationTurn>("conversation.approve");
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(
    () =>
      onHostEvent((e) => {
        if (e.type === "conversation.progress" && e.turn === liveRef.current?.turn) setLive({ turn: e.turn, items: e.items });
      }),
    [],
  );

  const busy = live !== null || opening !== null;

  /** Runs one turn: shows it as it streams, then adds it to the chat. */
  const runTurn = useCallback(
    async (start: (turnId: string) => Promise<{ ok: true; result: ConversationTurn } | { ok: false; error: { message: string } } | null>, optimistic: ConversationItem[]) => {
      const turn = newTurnId();
      setLive({ turn, items: optimistic });
      const res = await start(turn);
      setLive(null);
      if (res === null) return; // The confirm was cancelled.
      if (res.ok) {
        setChat((c) => ({ id: res.result.conversationId ?? c.id, items: [...c.items, ...res.result.items], waitingFor: res.result.waitingFor }));
        invalidate(affectedBy("conversation.send"));
      } else {
        setChat((c) => ({ ...c, items: [...c.items, ...optimistic, { kind: "error", id: `error-${turn}`, message: res.error.message }] }));
      }
    },
    [],
  );

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      void runTurn(
        (turnId) => execute<ConversationTurn>("conversation.send", { message, ...(chat.id ? { conversationId: chat.id } : {}), turnId }),
        [{ kind: "user", id: "pending", text: message }],
      );
    },
    [busy, chat.id, runTurn],
  );

  const answer = useCallback(
    (permissionId: string, approved: boolean) => {
      const conversationId = chat.id;
      if (!conversationId || busy) return;
      const ask = chat.items.find((i) => i.kind === "permission" && i.id === permissionId);
      const markAnswered = (items: ConversationItem[]) =>
        items.map((i) => (i.kind === "permission" && i.id === permissionId ? { ...i, answer: approved ? ("approved" as const) : ("declined" as const) } : i));
      void runTurn(async (turnId) => {
        const res = approved
          ? await approve.run(
              { conversationId, permissionId, turnId },
              {
                confirm: {
                  title: ask?.kind === "permission" ? ask.question : "Let eero go ahead?",
                  message:
                    ask?.kind === "permission" && ask.tools.length
                      ? `eero runs this on your network itself: ${ask.tools.join("; ")}. Devices may go offline.`
                      : "eero makes this change on your network itself, and devices may go offline.",
                  confirmLabel: "Approve",
                },
                failure: "Couldn't approve eero's request",
              },
            )
          : await execute<ConversationTurn>("conversation.decline", { conversationId, permissionId, turnId });
        if (res?.ok) setChat((c) => ({ ...c, items: markAnswered(c.items) }));
        return res;
      }, []);
    },
    [approve, busy, chat.id, chat.items, runTurn],
  );

  const rate = useCallback(async (messageId: string, helpful: boolean) => {
    setRated((r) => ({ ...r, [messageId]: helpful }));
    const res = await execute("conversation.rate", { messageId, helpful });
    if (!res.ok) {
      setRated(({ [messageId]: _drop, ...r }) => r);
      toast.error("Couldn't send your rating", { detail: res.error.message });
    }
  }, []);

  const open = useCallback(
    async (id: string) => {
      if (busy || id === chat.id) return;
      setOpening(id);
      const res = await execute<Conversation>("conversation.get", { conversationId: id }, { fresh: true });
      setOpening(null);
      if (res.ok) {
        const pending = res.result.items.findLast((i) => i.kind === "permission" && i.answer === null);
        setChat({ id: res.result.id ?? id, items: res.result.items, waitingFor: pending?.id ?? null });
        setRated({});
      } else toast.error("Couldn't open that conversation", { detail: res.error.message });
    },
    [busy, chat.id],
  );

  const startNew = () => {
    if (busy) return;
    setChat(EMPTY);
    setRated({});
  };

  const toggleHistory = () => {
    setHistoryOpen((o) => {
      saveHistoryOpen(!o);
      return !o;
    });
  };

  const items = live ? [...chat.items, ...live.items] : chat.items;
  const empty = items.length === 0;

  return (
    <>
      <TopBarTitle>Conversations</TopBarTitle>
      <TopBarActions>
        <Button variant="ghost" size="tool" onClick={startNew} disabled={busy || (chat.id === null && chat.items.length === 0)}>
          <SquarePen />
          New chat
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={historyOpen ? "Hide history" : "Show history"} title={historyOpen ? "Hide history" : "Show history"} aria-pressed={historyOpen} onClick={toggleHistory}>
          <PanelRight />
        </Button>
      </TopBarActions>

      {/* Fills the pane: the page's bottom padding is taken back so the composer sits on the window's edge. */}
      <div className="-mb-[100px] flex min-h-[calc(100vh-var(--titlebar-height)-22px)] items-stretch gap-6">
        <div data-chat aria-busy={busy} className="flex min-w-0 flex-1 flex-col">
          <div className={cn("flex flex-1 flex-col pb-6", opening && "opacity-40 transition-opacity delay-150")}>
            {empty ? (
              <Welcome suggestions={suggestions.data ?? null} onPick={send} disabled={busy} />
            ) : (
              <Thread
                items={items}
                working={live !== null}
                actions={{
                  rated,
                  onChoice: busy ? undefined : send,
                  onApprove: busy ? undefined : (id) => answer(id, true),
                  onDecline: busy ? undefined : (id) => answer(id, false),
                  onRate: (id, helpful) => void rate(id, helpful),
                }}
              />
            )}
            <ScrollAnchor dep={items} />
          </div>
          <Composer onSend={send} busy={busy} waiting={chat.waitingFor !== null && !live} />
        </div>
        {historyOpen && <HistoryPanel selected={chat.id} opening={opening} onOpen={(id) => void open(id)} disabled={busy} />}
      </div>
    </>
  );
}

/** Keeps the newest message in view as a reply streams, unless the person scrolled up to read. */
function ScrollAnchor({ dep }: { dep: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest<HTMLElement>("[data-page-scroll]");
    if (!el || !scroller) return;
    const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (fromBottom < 240) scroller.scrollTop = scroller.scrollHeight;
  }, [dep]);
  return <div ref={ref} />;
}

function Welcome({ suggestions, onPick, disabled }: { suggestions: ConversationSuggestion[] | null; onPick: (prompt: string) => void; disabled: boolean }) {
  return (
    <div className="my-auto flex flex-col items-center gap-5 py-10 text-center">
      <MessagesSquare className="size-8 text-icon-muted" />
      <div className="flex flex-col gap-1.5">
        <h2 className="font-semibold text-base">Ask eero about your network</h2>
        <p className="max-w-md text-muted-foreground text-sm">
          eero's assistant can check your internet, eeros and devices, explain what it finds and suggest fixes. It asks before it changes anything.
        </p>
      </div>
      <div className={cn("flex max-w-xl flex-wrap justify-center gap-2 transition-opacity", suggestions === null && "opacity-40 delay-150")}>
        {(suggestions ?? []).map((s) => (
          <Button key={s.prompt} variant="outline" size="sm" disabled={disabled} title={s.prompt !== s.label ? s.prompt : undefined} onClick={() => onPick(s.prompt)}>
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Composer({ onSend, busy, waiting }: { onSend: (text: string) => void; busy: boolean; waiting: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grows with the text up to about eight lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="sticky bottom-0 z-10 bg-background pb-5">
      <div className="flex items-end gap-2 rounded-xl border border-input bg-card px-3 py-2 shadow-xs/5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/24">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={MAX_MESSAGE}
          // biome-ignore lint/a11y/noAutofocus: the page exists to type here.
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Message eero"
          placeholder={waiting ? "Answer eero's question above, or ask something else" : "Ask eero about your network"}
          className="max-h-[200px] min-h-6 flex-1 resize-none bg-transparent py-0.5 text-sm text-foreground leading-6 outline-none placeholder:text-placeholder"
        />
        <Button size="icon-sm" aria-label="Send" title="Send (Enter)" disabled={busy || !text.trim()} onClick={submit}>
          <ArrowUp />
        </Button>
      </div>
      <p className="mt-1.5 text-center text-muted-foreground/50 text-xs">eero's assistant can make mistakes. Check before you act on what it says.</p>
    </div>
  );
}
