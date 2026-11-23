/**
 * History: the optional right-hand panel of Conversations listing past chats
 * (`conversation.list`), newest first. It stays in view while the chat
 * scrolls. Clicking one opens it in the chat. docs/ux/pages/conversations.md.
 */
import { useQuery } from "~/app/useCommand";
import { Card } from "~/components/ui/card";
import { SectionError, useNow } from "~/components/ui/page";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { formatRelative } from "../../../../core/format";
import type { ConversationSummary } from "../../../../core/model";

export function HistoryPanel({ selected, opening, onOpen, disabled }: { selected: string | null; opening: string | null; onOpen: (id: string) => void; disabled: boolean }) {
  const list = useQuery<ConversationSummary[]>("conversation.list");
  const now = useNow();
  const rows = list.data;

  return (
    <aside aria-label="Conversation history" className="sticky top-0 flex max-h-[calc(100vh-var(--titlebar-height)-44px)] w-60 shrink-0 flex-col gap-3 self-start">
      <h2 className="font-semibold text-base text-foreground leading-7">History</h2>
      {list.error && !rows ? (
        <SectionError what="history" error={list.error} onRetry={list.refetch} />
      ) : (
        <Card className="min-h-0 overflow-y-auto">
          {!rows ? (
            <ul className="flex flex-col opacity-40 transition-opacity delay-150">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex flex-col gap-1.5 border-border/50 border-b px-3.5 py-2.5 last:border-b-0">
                  <span className="h-3 w-32 rounded bg-muted" />
                  <span className="h-2.5 w-12 rounded bg-muted" />
                </li>
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">No past conversations.</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((c) => (
                <li key={c.id} className="border-border/50 border-b last:border-b-0">
                  <button
                    type="button"
                    disabled={disabled && c.id !== selected}
                    aria-current={c.id === selected ? "true" : undefined}
                    onClick={() => onOpen(c.id)}
                    className={cn(
                      "flex w-full cursor-pointer flex-col gap-0.5 px-3.5 py-2.5 text-start outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 disabled:cursor-default disabled:opacity-64",
                      c.id === selected && "bg-accent hover:bg-accent",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={c.title}>
                        {c.title}
                      </span>
                      {opening === c.id && <Spinner className="size-3 shrink-0" />}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">{formatRelative(c.createdAt, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </aside>
  );
}
