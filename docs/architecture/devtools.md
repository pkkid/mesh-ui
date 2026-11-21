# Dev tools panel

`F12` (as in browsers) opens and closes a panel docked across the bottom of
the window that lists the app's eero requests: method, path, the command
that caused each one, status, size and time, with headers, the response
body and a timing breakdown for the one selected. It works in every build
and is not mentioned anywhere in the UI. Sign-in requests show too, since
the panel sits above both the sign-in screen and the shell. Its top edge
is a 2px border (1px everywhere else in the app), to set it apart as a
developer view.

The request list stays scrolled to the bottom as new requests arrive, unless
you have scrolled up. In the details, header labels are 140px wide (a longer
one ends in an ellipsis, full name in its tooltip). JSON request and response
bodies show as a collapsible tree (`JsonTree.tsx`, ported from the JSON
Formatter extension, BSD-3-Clause): click an arrow to collapse or expand a
block, Ctrl or Cmd+click for its siblings too. It is built with plain DOM
calls, not React elements, so a 256 KB body renders fast. Syntax colours come
from the theme's series palette (strings green; numbers, booleans and null
blue), the one place outside charts and status that uses them. A body that
is not a JSON object or array, or was cut at 256 KB, shows as plain text.

The toolbar, left to right: the title with its recording dot, the filter
box, **Show errors only** (it reads **Show all** while the list shows only errors), Pause (Record while paused) and Clear as icon
buttons with tooltips, the request count and total size, then **DevTools**
(Electron's own tools) and Close on the right.

Drag the panel's top edge to change its height and the details pane's left
edge to change its width; both are remembered (view state in localStorage,
`mesh-ui:devtools:v1`). The request list always keeps at least 320px.

Code: `src/core/eero/inspect.ts` (capture and redaction),
`src/core/eero/client.ts` (`attempt`), `src/main/ipc.ts` (the
`mesh:devtools-*` channels), `src/renderer/src/features/devtools/`.

## Off means off

- Nothing is captured unless the panel is open and recording. With no
  inspector set, each eero request pays one null check, and the engine runs
  commands without the AsyncLocalStorage context that names them.
- Opening the panel calls `window.mesh.devtools.capture(true)`; Pause,
  closing the panel, a reload, a closed window or a crashed renderer stop
  it. Closing the panel also drops every record.
- Main keeps nothing: each record is sent to the window when its request
  starts and again as it completes, and the panel keeps at most 300 (older
  ones drop off).

## What a record holds, and never holds

- Holds: the full URL with its query, the method, the command id (or none,
  for a session refresh), the attempt number (replays after a retry or
  refresh), request headers and body, status, response headers, the
  response body (cut at 256 KB), the bytes eero sent, the client's outcome
  (`ok`, `retry`, `refresh`, `error`) with eero's `meta.error`, and timing:
  queued for a rate limit slot, waiting for eero's headers, reading the
  body.
- Never holds: the session token or the pending sign-in token (scrubbed from
  every header, body and URL), the `Cookie` and `X-User-Token` values,
  `Set-Cookie` session values, any body key named like a token, the
  sign-in verification code or a password in a request body. They show as
  `(hidden)`.
- Responses do hold real network data (names, MACs, IPs), the same the
  app already shows. Records live in memory only: never written to disk, the
  request log or a log file. Do not put screenshots of the panel with real
  data in bug reports or PRs; use the [request log](security.md#eero-request-log)
  for those.

## Not a command

The panel talks to main over its own channels, not `engine.execute`, so the
CLI and MCP cannot reach it: headers and response bodies stay in the app
window. Only the app's own pages may call them (the same sender check as
every channel). In demo mode there are no eero requests and `capture`
answers `{ available: false }`; the panel says so. With `pnpm dev:fake` it
shows the fake server's traffic.

## Electron's developer tools

The panel's DevTools button opens Electron's own developer tools docked to
the right of the window (`openDevTools({ mode: "right" })`). A detached
window is avoided on purpose: on GNOME under Wayland, Electron draws its
frame with an opaque black shadow area.
