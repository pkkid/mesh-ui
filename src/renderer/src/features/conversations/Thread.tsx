/**
 * The items of one chat with eero's assistant, in order: the user's messages
 * (right, in a quiet bubble), eero's replies (plain text with light
 * Markdown, thumbs under finished ones), the steps eero took while working,
 * permission asks with Approve and Decline, and cards (rows, contacts and
 * reply choices). docs/ux/pages/conversations.md.
 */
import { Brain, Check, ShieldQuestion, ThumbsDown, ThumbsUp, TriangleAlert, Wrench, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Spinner } from "~/components/ui/spinner";
import { Markdown } from "~/lib/markdown";
import { cn } from "~/lib/utils";
import type { ConversationItem, ConversationStep } from "../../../../core/model";

export type ThreadActions = {
  /** Sends text as the user's next message (a card choice). Absent while a reply runs. */
  onChoice?: (text: string) => void;
  onApprove?: (permissionId: string) => void;
  onDecline?: (permissionId: string) => void;
  onRate?: (messageId: string, helpful: boolean) => void;
  /** Replies already rated here, by id. */
  rated: Readonly<Record<string, boolean>>;
};

/** eero's own reply ids can be rated; ids Mesh UI made up (reply-3) cannot. */
const rateable = (id: string) => !/^reply-\d+$/.test(id);

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-secondary px-3.5 py-2 text-secondary-foreground">{text}</div>
    </div>
  );
}

function Reply({ item, actions, last }: { item: Extract<ConversationItem, { kind: "reply" }>; actions: ThreadActions; last: boolean }) {
  const rating = actions.rated[item.id];
  const canRate = item.done && rateable(item.id) && actions.onRate;
  return (
    <div className="group/reply flex flex-col gap-1.5">
      <div className="flex flex-col gap-2.5 leading-relaxed">
        {item.text ? <Markdown text={item.text} /> : <span className="text-muted-foreground">…</span>}
      </div>
      {canRate && (
        <div className={cn("flex items-center gap-0.5 transition-opacity", rating === undefined && !last && "opacity-0 group-hover/reply:opacity-100 focus-within:opacity-100")}>
          {([true, false] as const).map((helpful) => {
            const Icon = helpful ? ThumbsUp : ThumbsDown;
            const chosen = rating === helpful;
            return (
              <Button
                key={String(helpful)}
                variant="ghost-muted"
                size="icon-xs"
                aria-label={helpful ? "Helpful" : "Not helpful"}
                title={helpful ? "Helpful" : "Not helpful"}
                aria-pressed={chosen}
                disabled={rating !== undefined}
                className={cn(chosen && "text-foreground")}
                onClick={() => actions.onRate?.(item.id, helpful)}
              >
                <Icon className={cn(chosen && "fill-current")} />
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const stepLabel = (s: ConversationStep) => s.text ?? (s.kind === "tool" ? "Checked your network" : "Thought it over");

function Steps({ steps, working }: { steps: ConversationStep[]; working: boolean }) {
  return (
    <ul className="flex flex-col gap-1 text-muted-foreground text-xs">
      {steps.map((s, i) => {
        const Icon = s.kind === "tool" ? Wrench : Brain;
        const current = working && i === steps.length - 1;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps only ever grow at the end.
          <li key={i} className="flex items-center gap-2">
            {current ? <Spinner className="size-3.5" /> : <Icon className="size-3.5 shrink-0 text-icon-muted" />}
            <span className={cn(current && "text-foreground/80")}>{stepLabel(s)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Permission({ item, actions }: { item: Extract<ConversationItem, { kind: "permission" }>; actions: ThreadActions }) {
  const open = item.answer === null;
  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">{item.question}</p>
          {item.tools.length > 0 && (
            <ul className="list-disc ps-4 text-muted-foreground text-xs">
              {item.tools.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {open ? (
        <div className="flex gap-2 ps-6.5">
          <Button size="sm" variant="outline" disabled={!actions.onApprove} onClick={() => actions.onApprove?.(item.id)}>
            <Check />
            Approve…
          </Button>
          <Button size="sm" variant="ghost" disabled={!actions.onDecline} onClick={() => actions.onDecline?.(item.id)}>
            <X />
            Decline
          </Button>
        </div>
      ) : (
        <p className="ps-6.5 text-muted-foreground text-xs">{item.answer === "approved" ? "You approved this." : "You declined this."}</p>
      )}
    </Card>
  );
}

function CardItem({ item, actions, live }: { item: Extract<ConversationItem, { kind: "card" }>; actions: ThreadActions; live: boolean }) {
  const lines = [...item.rows, ...item.contacts];
  return (
    <Card padded className="flex max-w-md flex-col gap-2.5">
      <p className="font-medium">{item.title}</p>
      {lines.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[13px]">
          {lines.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are fixed once the card arrives.
            <div key={i} className="contents">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 break-words tabular-nums">{r.value || "-"}</dd>
            </div>
          ))}
        </dl>
      )}
      {live && item.choices.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {item.choices.map((c) => (
            <Button key={c} size="xs" variant="outline" disabled={!actions.onChoice} onClick={() => actions.onChoice?.(c)}>
              {c}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

function ErrorItem({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
      {message}
    </p>
  );
}

/** The chat. `working`: a reply is streaming, so the last steps show a spinner (or a lone one shows before anything arrives). */
export function Thread({ items, working, actions }: { items: ConversationItem[]; working: boolean; actions: ThreadActions }) {
  const lastReply = items.findLast((i) => i.kind === "reply")?.id;
  const lastCard = items.findLast((i) => i.kind === "card")?.id;
  const tail = items.at(-1);
  // Something to show while eero has not said anything yet in this turn.
  const thinking = working && (tail?.kind === "user" || tail?.kind === "permission");
  return (
    <div className="flex flex-col gap-5 text-sm">
      {items.map((item) => {
        switch (item.kind) {
          case "user":
            return <UserMessage key={item.id} text={item.text} />;
          case "reply":
            return <Reply key={item.id} item={item} actions={actions} last={item.id === lastReply} />;
          case "steps":
            return <Steps key={item.id} steps={item.steps} working={working && item === tail} />;
          case "permission":
            return <Permission key={item.id} item={item} actions={actions} />;
          case "card":
            return <CardItem key={item.id} item={item} actions={actions} live={item.id === lastCard && item === tail} />;
          case "error":
            return <ErrorItem key={item.id} message={item.message} />;
        }
      })}
      {thinking && (
        <p className="flex items-center gap-2 text-muted-foreground text-xs">
          <Spinner className="size-3.5" />
          eero is checking your network…
        </p>
      )}
    </div>
  );
}
