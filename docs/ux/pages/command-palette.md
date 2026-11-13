# Command palette

One search box for every command, device and profile, which also shows how to run the same command from the CLI or an agent.

Mockup: [../../mockups/19-command-palette.html](../../mockups/19-command-palette.html)

Shared patterns (dialogs, keyboard shortcuts, confirms, the command model) are described in [../overview.md](../overview.md).

## Layout

Opens over any page (the mockup shows it over Overview) with a dimmed backdrop. Trigger: the titlebar search ("Search or run a command") or `Ctrl K` (`Cmd K` on macOS).

1. **Input row**: search icon, the query, a result count (`10 results`), scope chips **All**, **Commands** (6), **Devices** (2), **Profiles** (2), and an `Esc` key hint.
2. **Body**, two panes:
   - **Result list**, grouped:
     - **Commands**: icon, label with the match highlighted ("Pause profile..."), the command id under it (`profile.pause`, or with preset params such as `device.list {"paused":true}`), an effect tag (`query`, `write`, `disruptive`, `destructive`) and a shortcut if one exists (`Ctrl Shift P`) or `-`.
     - **Devices**: icon, name, state (`Paused`), context (profile, eero, usage today), and the contextual action it would run (`Resume`, `Pause`) with its effect.
     - **Profiles**: avatar, name, state (`Paused`, `Scheduled`), context (time left, device count, schedule), and the action (`Resume`, `Pause now`).
     - A hint row: type `>` to search all commands by id (e.g. `>eero.restart`).
   - **Preview** of the selected result:
     - Icon, label, effect tag, id and source file (`profile.pause · src/core/commands/profile.ts`).
     - One line description, including whether it needs confirm.
     - **Params** form generated from the zod schema ("Tab to edit"): required fields marked, selects for entity params (profile picker with a context hint "scheduled, Bedtime at 9 PM"), segmented choices for small enums (none on `profile.pause`, which takes only `profile`).
     - **CLI** block with the equivalent `mesh-ui run <id> --params '{...}'` and **Copy**.
     - **MCP tool** block: tool name (`profile_pause`), hint badges (`readOnly: false`, `destructive: false`), the tool call JSON and the result JSON the UI and CLI also get.
     - Surfaces strip: UI (`window.mesh`), CLI (`mesh-ui run`), MCP (`mesh-ui mcp`), and a line that every surface uses one `engine.execute` and that disruptive and destructive commands need `confirm: true`.
     - Buttons: primary run button labelled with the concrete action ("Pause Mia", `Enter`) and **Add to script.jsonl**.
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
| Type | none (view state) | | | Filters and ranks results |
| Scope chip | none | | | Limits to one group |
| `>` prefix | none | | | Command only mode, matches ids as well as labels |
| Up / Down | none | | | Moves selection; preview follows |
| Tab | none | | | Moves focus into the params form |
| Enter or run button (query or write) | `window.mesh.execute(id, params)` | per command | no | Palette closes; toast with the result or error; the page refreshes its data |
| Enter or run button (disruptive or destructive) | `window.mesh.execute(id, {...params, confirm: true})` after the confirm | per command | the shared confirm dialog first | |
| Device or profile row action | `device.pause`, `device.resume`, `profile.pause`, `profile.resume` | write | no | |
| Command shortcut (e.g. `Ctrl Shift P`) | opens the palette on that command with params focused | | | |
| Copy (CLI block) or `Ctrl C` | none | | | Copies the CLI line |
| Add to script.jsonl | none (app local) | | | Appends `{"id", "params"}` to a script file chosen once with a save dialog |
| Esc or backdrop | none | | | Closes |

Commands shown in the mockup: `profile.pause`, `device.pause`, `wifi.hide5g.set`, `profile.schedule.add`, `profile.unassigned.pause`, `device.list` with preset params.

## States

- **Empty query:** shows recent commands and the current page's most used actions.
- **No results:** "No commands, devices or profiles match." plus the `>` hint.
- **Loading entities:** command results show at once; device and profile groups show a muted "Loading..." row.
- **Invalid params:** the run button is disabled and the field shows the zod message (the same text `bad_params` returns).
- **Not signed in:** only app and auth commands are listed.
- **No permission:** commands the user cannot run (per `network.permissions`) are listed dimmed with "Owner only" or "Not allowed", and Enter does nothing.
- **Capability missing or bridge mode:** commands unavailable on this network are dimmed with the reason.
- **Error after run:** toast with the error code message; the palette reopens on the same command if the user presses `Ctrl K` again.

## Notes

- The palette is a surface like any other. It must not hold its own copy of what a command does; everything comes from the registry (`id`, `label`, `effect`, `params` JSON Schema). `description` and `icon` are optional spec fields defined in [commands.md](../../architecture/commands.md#the-spec); shortcuts stay in the renderer.
- The source file path in the preview is useful in dev builds; hide it in release builds (open question).
- MCP tool names come from the id with dots replaced by underscores; hints come from `effect` exactly as in AGENTS.md.
- "Pause unassigned devices" is `profile.unassigned.pause` (write; the UI asks first because it includes TVs and smart home gear).
- "Pause 5 and 6 GHz for 2.4 GHz setup" is `wifi.hide5g.set` `{enabled: true}` (eero ends it on its own; disruptive, so it goes through the confirm dialog).
- Device and profile rows both say **Resume**, matching `device.resume` and `profile.resume`.
- `Ctrl C` as "copy as CLI" conflicts with copying selected text in the input. Only take it when the input has no selection.
- The mockup says 64 commands; the count comes from the registry, never hard coded.
