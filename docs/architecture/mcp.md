# MCP server

`mesh-ui mcp` runs a Model Context Protocol server on stdio so AI agents can
manage the network with the same commands as the UI and CLI. It is part of the
CLI (see [cli.md](cli.md)) and runs on the engine the CLI host builds, so it
uses the same backend and session as `mesh-ui run`.

## Setup

```sh
# Claude Code
claude mcp add mesh-ui -- mesh-ui mcp

# Demo network, for trying it out
claude mcp add mesh-ui-demo -- mesh-ui mcp --demo

# Read-only: only query tools are listed
claude mcp add mesh-ui -- mesh-ui mcp --read-only
```

Other clients use the same command in their config:

```json
{ "mcpServers": { "mesh-ui": { "command": "mesh-ui", "args": ["mcp"] } } }
```

The user must be signed in (in the app or with `mesh-ui login`) on a machine
with a keychain. Without a saved session every tool returns `not_signed_in`
with a message telling the user to sign in in the app.

## Options

| Flag | Effect |
| --- | --- |
| `--demo` | Demo backend (also `MESH_UI_DEMO=1`) |
| `--read-only` | List and allow only `query` tools |
| `--network <id\|name>` | Default network for tools that take `networkId` |
| `--allow <glob,...>` | Only expose matching ids, for example `device.*,profile.*` |

## Tools

One tool per command, generated from the registry at start-up.

- **Name**: the id with dots replaced by underscores: `device.pause` becomes
  `device_pause`, `settings.dns.set` becomes `settings_dns_set`.
- **Title**: the command `label`.
- **Description**: the command description plus its effect in words, for
  example "Disruptive: restarts the eero; devices on it reconnect. Requires
  confirm: true." Sensitive commands add "The result contains a Wi-Fi
  password."
- **Input schema**: the JSON Schema generated from the command's zod params.
  `disruptive` and `destructive` tools add a required `confirm: boolean`
  property described as "Set true only after the user has approved this
  action."
- **Annotations** derived from `effect`:

| Effect | `readOnlyHint` | `idempotentHint` | `destructiveHint` | `openWorldHint` |
| --- | --- | --- | --- | --- |
| `query` | true | true | false | true |
| `write` | false | false | false | true |
| `disruptive` | false | false | true | true |
| `destructive` | false | false | true | true |

`openWorldHint` is true because the tools act on a real network through eero's
cloud. `app.*` commands, which only touch local settings, set it to false.

Commands that need a person and a window (`auth.login.start`,
`auth.login.verify`, `auth.login.resend`, `app.cli.install`) are not exposed
as tools. Agents cannot sign in; they use the session the user created.

## Results

A tool call runs `engine.execute(id, arguments)` and returns:

- on success, `structuredContent` with the command's `result` when it is a
  plain object. MCP requires an object there, so any other result (an
  array, a string, a number, `null`) is wrapped as `{ "result": ... }`. One
  text block always holds `JSON.stringify(result)` exactly, unwrapped (for
  clients that ignore structured content);
- on failure, `isError: true` with a text block
  `{"code": "needs_confirm", "message": "..."}`. A call to a tool that does
  not exist or is not exposed (hidden, or filtered out by `--read-only` or
  `--allow`) returns `isError` with code `unknown_command` and never reaches
  the engine. Engine errors never become protocol errors; only a malformed
  MCP request does.

The result is the same JSON the UI and CLI get, so an agent's output can be
replayed as a CLI script line.

## Safety

The MCP server can control the user's network, so:

- **Confirmation is enforced by the engine.** `disruptive` and `destructive`
  tools fail with `needs_confirm` unless the agent passes `confirm: true`.
  Agents should ask the user before setting it; `destructiveHint` makes MCP
  clients show an approval prompt.
- **The token never crosses MCP.** No tool returns it, and errors never
  include it.
- **Tool output is data.** Device names, hostnames and notification text come
  from devices on the LAN and can contain text written to mislead an agent.
  Tool descriptions say so, and the confirm rule means injected text cannot
  restart or delete anything without the user approving it in their client.
- **Sensitive results** (`wifi.password.get`, `wifi.share`, `guest.share`) are
  labelled in their descriptions. `--read-only` still exposes them, since they
  are queries; use `--allow` to leave them out.
- **Audit.** Every tool call is to be appended to the audit log, shown in App
  & account (see [security.md](security.md#audit-log)). Not yet built in M1:
  the engine writes no audit log.

## Not included

- No MCP resources or prompts in the first version; tools cover everything.
- No HTTP or SSE transport. stdio only, so the server is only reachable by the
  process that launched it.
- No sampling or elicitation.

## Implementation

- `src/cli/mcp.ts` uses the official TypeScript MCP SDK
  (`@modelcontextprotocol/sdk`) with the stdio transport.
- `runMcp(argv, io, makeEngine)` parses the `mcp` flags and gets its engine
  from `makeEngine`. The `mcp` subcommand passes the CLI host's engine
  (`ctx.engine("mcp")`), so the server runs on whatever backend the host
  serves (demo and fake today; live once the Electron host lands). Without
  a factory it serves `--demo` only.
- `createMcpServer(engine, opts)` builds the tools from `engine.commands()`
  at start-up; there is no per-tool code. A new command appears as a tool
  automatically.
- stdout is reserved for the protocol. Logs go to stderr.
- Tests start the server in-process with the demo backend, list tools, check
  names, schemas and annotations, and call a `query`, a `write` and a
  `disruptive` tool with and without `confirm` (see
  [testing.md](../testing.md)).
