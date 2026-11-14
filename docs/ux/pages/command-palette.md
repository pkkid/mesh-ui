# Command palette

One search box for every command, device and profile, which also shows how to run the same command from the CLI or an agent.

Mockup: [../../mockups/19-command-palette.html](../../mockups/19-command-palette.html)

Shared patterns (dialogs, keyboard shortcuts, confirms, the command model) are described in [../overview.md](../overview.md).

## Layout

Opens over any page (the mockup shows it over Overview) with a dimmed backdrop. Trigger: the titlebar search ("Search or run a command") or `Ctrl K` (`Cmd K` on macOS).

1. **Input row**: search icon, the query, a result count (`10 results`), scope chips **All**, **Commands** (6), **Pages** (0), **Devices** (2), **Profiles** (2), and an `Esc` key hint. In `>` mode only **All** and **Commands** show.
2. **Body**, two panes:
   - **Result list**, grouped:
     - **Commands**: icon, label with the match highlighted ("Pause profile..."), the command id under it (`profile.pause`, or with preset params such as `device.list {"status":"online"}`), an effect tag (`query`, `write`, `disruptive`, `destructive`) and a shortcut if one exists (`Ctrl Shift P`). Presets are renderer-only shortcuts listed in `features/palette/search.ts` (`PRESETS`), like keyboard shortcuts.
     - **Pages**: every page in `ROUTES` that has no id in its path (Overview, Devices, Wi-Fi, ...), with its icon and path. Detail pages are reached through device and profile rows.
     - **Devices**: icon, name, state (`Paused`), context (profile, eero, usage today), and the contextual action it would run (`Resume`, `Pause`) with its effect.
     - **Profiles**: avatar, name, state (`Paused`, `Scheduled`), context (time left, device count, schedule), and the action (`Resume`, `Pause now`).
     - A hint row: type `>` to search all commands by id (e.g. `>eero.restart`).
   - **Preview** of the selected result:
     - Icon, label, effect tag and id (`profile.pause`). The source file is not shown: the registry does not carry it, and guessing it from the area is wrong for some commands (`speedtest.history` lives in `internet.ts`).
     - One line description, including whether it needs confirm.
     - **Params** form generated from the zod schema ("Tab to edit"): required fields marked, selects for entity params (profile picker with a context hint "scheduled, Bedtime at 9 PM"), segmented choices for small enums (none on `profile.pause`, which takes only `profile`).
     - **CLI** block with the equivalent `mesh-ui run <id> --params '{...}'` and **Copy**.
     - **MCP tool** block: tool name (`profile_pause`), hint badges (`readOnly: false`, `destructive: false`), the tool call JSON and, after a run, the result envelope (`{"ok": true, "result": ...}`) the UI and CLI also get. The CLI and MCP lines show only params that differ from the schema defaults.
     - Surfaces strip: UI (`window.mesh`), CLI (`mesh-ui run`), MCP (`mesh-ui mcp`), and a line that every surface uses one `engine.execute` and that disruptive and destructive commands need `confirm: true`.
     - Buttons: primary run button (`Run`, or `Open <name>` for pages, devices and profiles, `Enter`) and **Add to script.jsonl** (disabled, coming soon). When the run button is disabled the reason sits beside it ("Set device first", "Coming soon").
     - Long forms show required fields, filled-in fields and the first four optional ones, then "N more params".
3. **Footer**: key hints (`Up/Down` navigate, `Enter` run, `Tab` edit params, `Ctrl C` copy as CLI) and an effect legend.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Command list, labels, ids, effects, param schemas, descriptions | `window.mesh.commands()` (the registry) | once per app start |
| Device results and context | `device.list` | cached from the app's normal poll; refetched if older than 60 s when the palette opens |
| Profile results and context | `profile.list` | same |
| Context hints in the params form | the same cached lists | live as params change |
| Result count, scope counts | computed in the renderer from the above | per keystroke |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Type | none (view state) | | | Filters and ranks results: exact, then prefix, word start, substring and fuzzy (in order) label matches; every word must match. Device rows also match their profile and eero |
| Scope chip | none | | | Limits to one group |
| `>` prefix | none | | | Command only mode, matches ids as well as labels |
| Up / Down | none | | | Moves selection; preview follows |
| Tab | none | | | Moves focus into the params form |
| Enter or run button on a page, device or profile | none (navigation) | | | Palette closes and the page, device or profile page opens |
| Enter or run button (query) | `window.mesh.execute(id, params)` | query | no | The result (or error) JSON shows in the preview; the palette stays open |
| Enter or run button (write) | `window.mesh.execute(id, params)` through `useWrite` | write | no | Success toast ("Done: Pause device, Leo's iPad"), or an error toast with Retry; the result envelope shows in the preview and the palette stays open |
| Enter or run button (disruptive) | `useWrite`: runs once without `confirm`, then `{...params, confirm: true}` after the confirm | disruptive | inline confirm in place of the run button, with the engine's `needs_confirm` message | Progress toast, then success or error toast |
| Enter or run button (destructive) | as disruptive | destructive | the confirm dialog over the palette; type the target's name when the command has an entity param | Success or error toast |
| Device or profile row action (preview Actions button) | `device.pause`, `device.resume`, `profile.pause`, `profile.resume`, the entity in the command's picker param | write | no | Toast "Paused Leo's iPad" with Undo (the opposite action). "Coming soon" until the command is in the registry |
| Command shortcut (e.g. `Ctrl Shift P`) | opens the palette on that command with params focused | | | |
| Copy (CLI block) or `Ctrl C` | none | | | Copies the CLI line |
| Add to script.jsonl | none (app local) | | | Appends `{"id", "params"}` to a script file chosen once with a save dialog |
| Esc or backdrop | none | | | Closes |

Commands shown in the mockup: `profile.pause`, `device.pause`, `wifi.hide5g.set`, `profile.schedule.add`, `profile.unassigned.pause`, `device.list` with preset params.

## States

- **Empty query:** commands run from the palette in this session first, then every command and every page. The palette reopens on the last query, scope and selection (the query selected, so typing replaces it).
- **No results:** "No commands, devices or profiles match." plus the `>` hint.
- **Loading entities:** command results show at once; device and profile groups show a muted "Loading..." row.
- **Invalid params:** the run button is disabled and the field shows the zod message (the same text `bad_params` returns).
- **Not signed in:** only app and auth commands are listed (no pages, devices or profiles). The sign-in commands themselves (`auth.login.*`) are never listed; they need the sign-in screen.
- **No permission:** writes the user cannot run (per `network.permissions`) are listed dimmed with the reason beside the effect tag and the run button, and Enter does nothing: "Owner only" for an admin (and for every `destructive` command when the user is not the owner), "You don't have permission to change this" otherwise. The permission area comes from the id's area (`device` is `devices`, `wifi` and `guest` are `settings`, ...) and the operation from the verb (`create`/`add`, `delete`/`remove` or destructive, else `update`); see `commandGate` in `features/palette/search.ts`.
- **Capability missing or bridge mode:** writes unavailable on this network are dimmed with "Not available on this network" (a `network.get` capability such as `device_blacklist` for block, `led_action` for the status light) or "Off in bridge mode" (pause, block, profiles, reservations, forwards, SQM). The same `gateFor` check the pages use (`app/useWrite.ts`). The engine still has the last word when a command runs.
- **Confirm pending:** moving to another result cancels it; nothing has run.
- **Error after run:** toast with the error code message and Retry; the result envelope shows in the preview.

## Notes

- The palette is a surface like any other. Writes go through the write kit (`useWrite`, `writeRequest` in `search.ts`) built from the registry entry alone: no command has palette-specific code. Generic toast copy is "Done: <label>[, <target>]", where the target is the first entity picker's value.
- The palette must not hold its own copy of what a command does; everything comes from the registry (`id`, `label`, `effect`, `params` JSON Schema). `description` and `icon` are optional spec fields defined in [commands.md](../../architecture/commands.md#the-spec); shortcuts stay in the renderer.
- The params form reads the JSON Schema from the registry: a string param whose description says "A device id or exact name" (or "this eero (id ...)") is an entity picker filled from the cached lists, sending the name as the CLI would; enums of up to four short options and optional booleans are segmented controls; larger enums are selects; arrays are comma separated. Messages come from zod (`z.fromJSONSchema`, jitless for the CSP), the same text `bad_params` returns; a required field nobody has filled in yet is marked instead.
- MCP tool names come from the id with dots replaced by underscores; hints come from `effect` exactly as in AGENTS.md. The renderer cannot import `src/cli/mcp.ts` (it pulls in the MCP SDK), so `search.ts` has its own copy and a test checks it against `toTool` for every command.
- "Pause unassigned devices" is `profile.unassigned.pause` (write; the UI asks first because it includes TVs and smart home gear).
- "Pause 5 and 6 GHz for 2.4 GHz setup" is `wifi.hide5g.set` `{enabled: true}` (eero ends it on its own; disruptive, so it goes through the confirm dialog).
- Device and profile rows both say **Resume**, matching `device.resume` and `profile.resume`.
- `Ctrl C` as "copy as CLI" conflicts with copying selected text in the input. Only take it when the input has no selection.
- The mockup says 64 commands; the count comes from the registry, never hard coded.
