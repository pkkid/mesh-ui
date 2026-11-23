# Conversations (prototype)

A chat with eero's assistant, the same one the eero app shows as Support. You ask about the network; eero checks it with its own tools, answers, and asks before it changes anything. A prototype: the eero side comes from another client's reference and read-only checks (see [Manual checks](#manual-checks)).

This is eero's `/2.2/conversations` assistant. The eero app's newer **Support** chat with the Alexa badge is a separate feature (`alexa_chat`), so chats from the phone do not show in History here, and chats from here may not show on the phone.

No mockup. Shared patterns (section cards, confirm dialogs) are in [../overview.md](../overview.md).

## Layout

Sidebar: in Settings, right under Troubleshooting (`messages-square`). Breadcrumb `Maple Street / Conversations`. In the top bar: **New chat** (ghost, `square-pen`) and a history toggle (`panel-right`, pressed while the panel shows).

The page fills the pane: the chat column on the left, the optional **History** panel (15rem) on the right. The composer is pinned to the bottom of the pane; the chat scrolls above it and keeps the newest message in view while a reply streams, unless the person scrolled up.

1. **New chat** (nothing sent yet): a dim `messages-square` icon, `Ask eero about your network`, one muted line on what the assistant does and that it asks first, then eero's starter prompts as outline chips (`conversation.suggestions`; Mesh UI's own four when eero sends none). A chip sends its prompt.
2. **The chat**, in order:
   - **Your messages**: right-aligned, in a quiet `bg-secondary` bubble.
   - **eero's replies**: plain text across the column, light Markdown (bold, italic, lists, inline and fenced code, https links that open outside the app; never raw HTML). Under a finished reply, thumbs up and down (`ghost-muted`, icon only); they show on hover except under the latest reply, and stay showing once used.
   - **Steps**: what eero did while answering, a small muted line each (`wrench` for a tool, `brain` for reasoning) with what eero said about it ("Checked the internet connection"; "Checked your network" when eero says nothing). The newest step has a spinner while the reply runs. Before anything arrives: `eero is checking your network…` with a spinner.
   - **Permission asks**: a card with a `shield-question` icon, eero's question and the list of what it will run, then **Approve…** (outline) and **Decline** (ghost). Approve opens the confirm dialog (title: the question; message: what eero runs, and that devices may go offline; confirm button `Approve`, warning tone). Once answered, the buttons give way to `You approved this.` or `You declined this.`
   - **Cards**: eero's inline cards (a device, an eero, support contacts): a title, then label and value rows, at most `max-w-md`. When the card is the last thing eero said, its choices show as small outline buttons that send their text.
   - **Errors**: a muted line with a warning triangle (eero's own `Error` event, a reply that broke off, or a failed send).
3. **Composer**: a rounded card holding a growing textarea (up to about eight lines, 8000 characters) and a round **Send** button (primary, `arrow-up`). Enter sends, Shift+Enter adds a line. While eero waits on a permission ask the placeholder reads `Answer eero's question above, or ask something else`. Under it, a dim footnote: `eero's assistant can make mistakes. Check before you act on what it says.`
4. **History** (right, optional, remembered per computer in `localStorage`): the title `History` and one card listing past chats newest first, each its title and relative date (`2d ago`, `Nov 14`). The open chat is highlighted. Clicking one opens it in the chat (the chat dims while it loads). It stays in view while the chat scrolls. Empty: `No past conversations.`

While a reply runs, sending, the chips, the choices and opening another chat are off; the chat column has `aria-busy`.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Starter prompts | `conversation.suggestions` | on load, cached 10 min |
| History | `conversation.list` | on load, after every turn |
| Opening a past chat | `conversation.get` | on click (fresh) |
| Sending | `conversation.send` with a `turnId`; the reply streams in through `conversation.progress` events for that turn | on demand |
| Approve, Decline | `conversation.approve` (disruptive, confirmed) and `conversation.decline` | on demand |
| Thumbs | `conversation.rate` | on demand, once per reply |

## What a chat can hold

From the LD client's reference, eero's assistant sends more than text, and the page shows all of it:

- Text with Markdown-like formatting (assumed; LD shows it as plain text). If the live stream carries no text, the reply is read from history when the turn ends, so it appears at once instead of streaming.
- Steps: `ToolUse` and `Reasoning` events while it works.
- Cards (`widget_event`): device, eero, port, cellular and contact details, with reply choices. Seen for real: `internet` (connection rows) and `choice` (a follow-up question, titled with its prompt, and three choices). A later card with the same id replaces one; a `remove` action drops it.
- Permission asks before it changes anything, with the list of tools it will run.
- Feedback on each reply.

Not shown yet: `opt_in_widgets` (eero may have richer widgets a client can opt in to; Mesh UI opts in to none, as LD does), the `ui_event` request field (shape unknown), and the warm-up call.

## Manual checks

Only the maintainer can check these on the real network:

- Send a harmless question (`Is my internet working?`): the reply streams in, steps show, the chat appears in History, and reopening it shows the same messages. Risk: none.
- Ask something that makes eero ask permission, then **Decline**. eero says it will not go ahead and nothing changes. Risk: none.
- Check whether replies use Markdown, and what cards eero sends, against this doc.
